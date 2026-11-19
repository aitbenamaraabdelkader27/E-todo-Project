import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { Prisma, type PrismaClient, type User, type Session } from '@prisma/client';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { hash, compare } from 'bcryptjs';
import { z } from 'zod';
import { db as defaultDb } from './db.js';
import { createDemoUser } from './demo.js';
import { serializeTask, serializeUser } from './serialize.js';
import { organizeDay } from '../shared/scheduler.js';
import {
  registerSchema,
  loginSchema,
  demoSchema,
  projectSchema,
  settingsSchema,
  taskSchema,
  patchTaskSchema,
  versionSchema,
  dateSchema,
} from './validation.js';

const COOKIE_NAME = 'flow_session';
const DAY = 24 * 60 * 60 * 1000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Auth {
  user: User;
  session: Session;
}
function auth(res: Response): Auth {
  return res.locals.auth as Auth;
}

/** Every mutation to a user's planning data takes this lock, including manual edits. */
async function userTransaction<T>(
  db: PrismaClient,
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))::text AS locked`;
          return operation(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034' &&
        attempt < 4
      )
        continue;
      throw error;
    }
  }
  throw new HttpError(409, 'Your day changed in another window. Refresh and try again.');
}

export function createApp(db: PrismaClient = defaultDb) {
  const app = express();
  app.disable('x-powered-by');
  const production = process.env.NODE_ENV === 'production';
  const onRender = process.env.RENDER === 'true';
  if (onRender) app.set('trust proxy', 1);

  const configuredOrigins =
    process.env.APP_ORIGIN ?? (onRender ? process.env.RENDER_EXTERNAL_URL : undefined);
  if (production && !configuredOrigins)
    throw new Error('Set APP_ORIGIN or use the Render service URL in production.');
  const secureCookie = production && process.env.COOKIE_SECURE !== 'false';
  const allowedOrigins = new Set<string>();
  for (const entry of (
    configuredOrigins ??
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001'
  ).split(',')) {
    const url = URL.parse(entry.trim());
    if (
      !url ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Each APP_ORIGIN entry must be an HTTP(S) origin.');
    const localHttp =
      !onRender &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (production && !localHttp && (url.protocol !== 'https:' || !secureCookie))
      throw new Error('Public production origins require HTTPS and secure cookies.');
    allowedOrigins.add(url.origin);
  }
  app.use(
    helmet({
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'"],
              styleSrcAttr: ["'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              fontSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              upgradeInsecureRequests: null,
            },
          }
        : false,
    }),
  );
  app.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok' });
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1200,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please take a moment and try again.' },
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  // A cross-origin form cannot set this header; JSON requests must pass the Origin check.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('Origin');
    if (req.get('X-Requested-With') !== 'E-Todo-Flow' || (origin && !allowedOrigins.has(origin))) {
      return next(new HttpError(403, 'This request could not be verified. Please reload the app.'));
    }
    next();
  });

  async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token: unknown = req.cookies[COOKIE_NAME];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      throw new HttpError(401, 'Please sign in to continue.');
    const session = await db.session.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.expiresAt.getTime() <= Date.now() ||
      (session.user.expiresAt && session.user.expiresAt.getTime() <= Date.now())
    ) {
      res.clearCookie(COOKIE_NAME, {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        secure: secureCookie,
      });
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = req.get('X-CSRF-Token');
      if (
        !csrf ||
        !/^[a-f0-9]{64}$/.test(csrf) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrfToken))
      ) {
        throw new HttpError(403, 'Your session could not be verified. Please reload the app.');
      }
    }
    res.locals.auth = { user: session.user, session } satisfies Auth;
    next();
  }

  async function bootstrap(user: User, csrfToken: string) {
    const [tasks, projects] = await Promise.all([
      db.task.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      db.project.findMany({
        where: { userId: user.id },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, color: true },
      }),
    ]);
    return { user: serializeUser(user), csrfToken, tasks: tasks.map(serializeTask), projects };
  }

  async function issueSession(req: Request, res: Response, user: User) {
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (user.isDemo ? DAY : 7 * DAY));
    const oldToken: unknown = req.cookies[COOKIE_NAME];
    await db.$transaction(async (tx) => {
      if (typeof oldToken === 'string' && /^[a-f0-9]{64}$/.test(oldToken)) {
        await tx.session.deleteMany({ where: { tokenHash: digest(oldToken) } });
      }
      await tx.session.create({
        data: { userId: user.id, tokenHash: digest(token), csrfToken, expiresAt },
      });
    });
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
    return bootstrap(user, csrfToken);
  }

  let nextCleanup = 0;
  async function cleanupExpired() {
    if (Date.now() < nextCleanup) return;
    nextCleanup = Date.now() + 60 * 60 * 1000;
    await db.$transaction([
      db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
      db.user.deleteMany({ where: { isDemo: true, expiresAt: { lte: new Date() } } }),
    ]);
  }

  app.get('/api/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' },
  });
  app.use('/api/auth', authLimiter);

  app.post('/api/auth/register', async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await hash(input.password, 12);
    const user = await db.user.create({
      data: { name: input.name, email: input.email, passwordHash, timezone: input.timezone },
    });
    res.status(201).json(await issueSession(req, res, user));
  });

  // Comparing an absent account against a real hash avoids a fast user-enumeration path.
  const dummyHash = hash(randomBytes(32).toString('hex'), 12);
  app.post('/api/auth/login', async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    const valid = await compare(input.password, user?.passwordHash ?? (await dummyHash));
    if (!user || !user.passwordHash || user.isDemo || !valid)
      throw new HttpError(401, 'The email or password is incorrect.');
    await cleanupExpired();
    res.json(await issueSession(req, res, user));
  });

  const demoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'You have opened several demos. Please try again in an hour or create an account.',
    },
  });
  app.post('/api/auth/demo', demoLimiter, async (req, res) => {
    const input = demoSchema.parse(req.body ?? {});
    await cleanupExpired();
    const user = await db.$transaction((tx) => createDemoUser(tx, input.timezone));
    res.status(201).json(await issueSession(req, res, user));
  });

  app.get('/api/session', requireAuth, async (_req, res) => {
    const { user, session } = auth(res);
    res.json(await bootstrap(user, session.csrfToken));
  });

  app.post('/api/auth/logout', requireAuth, async (_req, res) => {
    await db.session.deleteMany({ where: { id: auth(res).session.id } });
    res.clearCookie(COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie,
    });
    res.status(204).end();
  });

  app.use('/api/tasks', requireAuth);
  app.post('/api/tasks', async (req, res) => {
    const input = taskSchema.parse(req.body);
    const userId = auth(res).user.id;
    if (input.placement === 'FIXED' && !input.scheduledAt)
      throw new HttpError(400, 'A fixed event needs a date and time.');
    const task = await userTransaction(db, userId, async (tx) => {
      if ((await tx.task.count({ where: { userId } })) >= 1000)
        throw new HttpError(
          400,
          'Your workspace has reached its 1,000-task limit. Delete old tasks to make room.',
        );
      if (
        input.projectId &&
        !(await tx.project.findFirst({ where: { id: input.projectId, userId } }))
      )
        throw new HttpError(404, 'Project not found.');
      return tx.task.create({
        data: {
          ...input,
          userId,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          deadline: input.deadline ? new Date(input.deadline) : null,
        },
      });
    });
    res.status(201).json(serializeTask(task));
  });

  app.patch('/api/tasks/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { version, ...input } = patchTaskSchema.parse(req.body);
    const userId = auth(res).user.id;
    const task = await userTransaction(db, userId, async (tx) => {
      const existing = await tx.task.findFirst({ where: { id, userId } });
      if (!existing) throw new HttpError(404, 'Task not found.');
      if (existing.version !== version)
        throw new HttpError(409, 'This task changed in another window. Refresh and try again.');
      if (
        input.projectId &&
        !(await tx.project.findFirst({ where: { id: input.projectId, userId } }))
      )
        throw new HttpError(404, 'Project not found.');
      const placement = input.placement ?? existing.placement;
      const scheduledAt =
        input.scheduledAt === undefined ? existing.scheduledAt : input.scheduledAt;
      if (placement === 'FIXED' && !scheduledAt)
        throw new HttpError(400, 'A fixed event needs a date and time.');
      const { scheduledAt: scheduleInput, deadline: deadlineInput, ...rest } = input;
      return tx.task.update({
        where: { id },
        data: {
          ...rest,
          ...(scheduleInput !== undefined
            ? { scheduledAt: scheduleInput ? new Date(scheduleInput) : null }
            : {}),
          ...(deadlineInput !== undefined
            ? { deadline: deadlineInput ? new Date(deadlineInput) : null }
            : {}),
          version: { increment: 1 },
        },
      });
    });
    res.json(serializeTask(task));
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { version } = versionSchema.parse(req.body);
    const userId = auth(res).user.id;
    await userTransaction(db, userId, async (tx) => {
      const task = await tx.task.findFirst({ where: { id, userId } });
      if (!task) throw new HttpError(404, 'Task not found.');
      if (task.version !== version)
        throw new HttpError(409, 'This task changed in another window. Refresh and try again.');
      await tx.task.delete({ where: { id } });
    });
    res.status(204).end();
  });

  app.use('/api/projects', requireAuth);
  app.post('/api/projects', async (req, res) => {
    const input = projectSchema.parse(req.body);
    const userId = auth(res).user.id;
    const project = await userTransaction(db, userId, async (tx) => {
      if ((await tx.project.count({ where: { userId } })) >= 50)
        throw new HttpError(400, 'Your workspace has reached its 50-project limit.');
      return tx.project.create({
        data: { ...input, userId },
        select: { id: true, name: true, color: true },
      });
    });
    res.status(201).json(project);
  });

  app.delete('/api/projects/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const userId = auth(res).user.id;
    await userTransaction(db, userId, async (tx) => {
      if (!(await tx.project.findFirst({ where: { id, userId } })))
        throw new HttpError(404, 'Project not found.');
      // Versions advance when deleting a project changes tasks, protecting editors in other tabs.
      await tx.task.updateMany({
        where: { userId, projectId: id },
        data: { projectId: null, version: { increment: 1 } },
      });
      await tx.project.delete({ where: { id } });
    });
    res.status(204).end();
  });

  app.patch('/api/settings', requireAuth, async (req, res) => {
    const input = settingsSchema.parse(req.body);
    const userId = auth(res).user.id;
    const user = await userTransaction(db, userId, async (tx) => {
      const existing = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if ((input.dayEnd ?? existing.dayEnd) <= (input.dayStart ?? existing.dayStart))
        throw new HttpError(
          400,
          'Your day must end after it starts. Overnight availability is not supported.',
        );
      return tx.user.update({ where: { id: userId }, data: input });
    });
    res.json(serializeUser(user));
  });

  app.post('/api/organize', requireAuth, async (req, res) => {
    const { date } = dateSchema.parse(req.body);
    const userId = auth(res).user.id;
    const result = await userTransaction(db, userId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const tasks = await tx.task.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      let plan;
      try {
        plan = organizeDay(tasks.map(serializeTask), {
          date,
          timezone: user.timezone,
          dayStart: user.dayStart,
          dayEnd: user.dayEnd,
          now: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof RangeError)
          throw new HttpError(
            400,
            'Your availability includes an unavailable or ambiguous clock time on this day. Adjust the start or end time in Settings.',
          );
        throw error;
      }
      for (const placement of plan.scheduled) {
        await tx.task.update({
          where: { id: placement.id },
          data: {
            scheduledAt: new Date(placement.scheduledAt),
            placement: 'AUTO',
            version: { increment: 1 },
          },
        });
      }
      return plan;
    });
    res.json(result);
  });

  app.use('/api', (_req, _res, next) => {
    next(new HttpError(404, 'This endpoint does not exist.'));
  });
  if (production) {
    app.use('/assets', express.static(resolve('dist/assets'), { immutable: true, maxAge: '1y' }));
    app.use('/assets', (_req, res) => {
      res.sendStatus(404);
    });
    app.use(express.static(resolve('dist'), { index: false }));
    app.get('/{*path}', (req, res) => {
      if (!req.accepts('html')) {
        res.sendStatus(404);
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve('dist/index.html'));
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: error.issues[0]?.message ?? 'Please check the form.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    } else if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'An account with this email already exists. Try signing in.' });
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      res.status(409).json({ error: 'Your day changed in another window. Refresh and try again.' });
    } else if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'The request contains invalid JSON.' });
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 413
    ) {
      res.status(413).json({ error: 'This request is too large.' });
    } else {
      // Avoid logging request bodies, credentials, tokens, or SQL bind parameters.
      console.error('API request failed:', error instanceof Error ? error.name : 'UnknownError');
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });
  return app;
}
