import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../server/app.js';
import { addDays, localToInstant, todayInZone } from '../shared/time.js';
import type { Bootstrap, Task, TaskInput } from '../shared/types.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const safeDatabase = databaseUrl && /(?:^|\/)\w*_test(?:\?|$)/.test(new URL(databaseUrl).pathname);
const prisma = new PrismaClient({ ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}) });
const app = createApp(prisma);
const ids = new Set<string>();
const prefix = `flow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let serial = 0;
type Agent = ReturnType<typeof request.agent>;
interface Account {
  agent: Agent;
  data: Bootstrap;
  email: string;
}

function mutation(agent: Agent, method: 'post' | 'patch' | 'delete', path: string, csrf?: string) {
  const call = agent[method](path).set('X-Requested-With', 'E-Todo-Flow');
  return csrf ? call.set('X-CSRF-Token', csrf) : call;
}

async function account(): Promise<Account> {
  const agent = request.agent(app);
  const email = `${prefix}-${++serial}@example.com`;
  const response = await mutation(agent, 'post', '/api/auth/register').send({
    name: 'Test Person',
    email,
    password: 'a sufficiently strong password',
    timezone: 'UTC',
  });
  expect(response.status).toBe(201);
  const data = response.body as Bootstrap;
  ids.add(data.user.id);
  return { agent, data, email };
}

async function task(account: Account, input: TaskInput): Promise<Task> {
  const response = await mutation(account.agent, 'post', '/api/tasks', account.data.csrfToken).send(
    input,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as Task;
}

beforeAll(async () => {
  if (!safeDatabase)
    throw new Error(
      'API tests require TEST_DATABASE_URL (or DATABASE_URL) pointing to a dedicated database whose name ends with _test.',
    );
  await prisma.$connect();
});

afterAll(async () => {
  if (safeDatabase && ids.size) await prisma.user.deleteMany({ where: { id: { in: [...ids] } } });
  await prisma.$disconnect();
});

describe('production configuration', () => {
  it('uses the Render HTTPS origin and keeps production session cookies secure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', undefined);
    vi.stubEnv('RENDER', 'true');
    vi.stubEnv('RENDER_EXTERNAL_URL', 'https://flow.example');
    vi.stubEnv('COOKIE_SECURE', undefined);
    try {
      const deployed = createApp(prisma);
      expect(deployed.get('trust proxy')).toBe(1);
      expect((await request(deployed).get('/healthz')).body).toEqual({ status: 'ok' });
      expect((await request(deployed).get('/api/health')).body).toEqual({ status: 'ok' });
      expect((await request(deployed).get('/api/unknown')).type).toBe('application/json');
      const agent = request.agent(deployed);
      expect(
        (
          await mutation(agent, 'post', '/api/auth/demo')
            .set('Origin', 'https://elsewhere.example')
            .send({})
        ).status,
      ).toBe(403);
      const response = await mutation(agent, 'post', '/api/auth/demo')
        .set('Origin', 'https://flow.example')
        .send({});
      expect(response.status).toBe(201);
      ids.add(response.body.user.id);
      expect(response.headers['set-cookie'][0]).toMatch(/; Secure(?:;|$)/);
      vi.stubEnv('COOKIE_SECURE', 'false');
      expect(() => createApp(prisma)).toThrow('secure cookies');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('authentication and secure sessions', () => {
  it('rejects anonymous access and requires the application mutation header', async () => {
    expect((await request(app).get('/api/session')).status).toBe(401);
    expect((await request(app).post('/api/auth/demo').send({})).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/tasks')
          .set('X-Requested-With', 'E-Todo-Flow')
          .send({ title: 'No access' })
      ).status,
    ).toBe(401);
  });

  it('registers, hashes credentials, persists a session, logs out and signs back in', async () => {
    const user = await account();
    expect(user.data.tasks).toEqual([]);
    expect(user.data.projects).toEqual([]);
    expect(user.data.user.email).toBe(user.email);
    expect(user.data).not.toHaveProperty('passwordHash');
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.data.user.id } });
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(saved.passwordHash).not.toContain('sufficiently');
    const session = await user.agent.get('/api/session');
    expect(session.status).toBe(200);
    expect(session.headers['cache-control']).toBe('no-store');
    expect(session.body.user.id).toBe(user.data.user.id);
    const logout = await mutation(user.agent, 'post', '/api/auth/logout', user.data.csrfToken).send(
      {},
    );
    expect(logout.status).toBe(204);
    expect((await user.agent.get('/api/session')).status).toBe(401);
    const login = await mutation(user.agent, 'post', '/api/auth/login').send({
      email: user.email,
      password: 'a sufficiently strong password',
    });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(user.data.user.id);
    expect(login.body.csrfToken).not.toBe(user.data.csrfToken);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toContain('HttpOnly');
    expect(cookies.join(';')).toContain('SameSite=Lax');
    const token = cookies[0].match(/flow_session=([a-f0-9]+)/)?.[1];
    const savedSession = await prisma.session.findFirstOrThrow({
      where: { userId: user.data.user.id },
    });
    expect(savedSession.tokenHash).not.toBe(token);
  });

  it('rejects wrong passwords, invalid accounts, duplicate emails and invalid input', async () => {
    const user = await account();
    const wrong = await mutation(user.agent, 'post', '/api/auth/login').send({
      email: user.email,
      password: 'incorrect password',
    });
    expect(wrong.status).toBe(401);
    const absent = await mutation(user.agent, 'post', '/api/auth/login').send({
      email: 'nobody@example.com',
      password: 'incorrect password',
    });
    expect(absent.body.error).toBe(wrong.body.error);
    const duplicate = await mutation(user.agent, 'post', '/api/auth/register').send({
      name: 'Someone',
      email: user.email.toUpperCase(),
      password: 'another strong password',
      timezone: 'UTC',
    });
    expect(duplicate.status).toBe(409);
    expect(
      (
        await mutation(user.agent, 'post', '/api/auth/register').send({
          name: 'Short',
          email: 'invalid',
          password: '123',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutation(user.agent, 'post', '/api/auth/register').send({
          name: 'Long',
          email: 'long@example.com',
          password: '🔑'.repeat(30),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutation(user.agent, 'post', '/api/auth/register').send({
          name: 'Zone',
          email: 'zone@example.com',
          password: 'another strong password',
          timezone: 'Unknown/Zone',
        })
      ).status,
    ).toBe(400);
  });

  it('rejects forged Origin and CSRF tokens, and malformed JSON', async () => {
    const user = await account();
    expect(
      (await mutation(user.agent, 'post', '/api/tasks').send({ title: 'Blocked' })).status,
    ).toBe(403);
    expect(
      (await mutation(user.agent, 'post', '/api/tasks', '0'.repeat(64)).send({ title: 'Blocked' }))
        .status,
    ).toBe(403);
    expect(
      (
        await mutation(user.agent, 'post', '/api/tasks', user.data.csrfToken)
          .set('Origin', 'https://hostile.example')
          .send({ title: 'Blocked' })
      ).status,
    ).toBe(403);
    expect(
      (
        await mutation(user.agent, 'post', '/api/auth/demo')
          .set('Origin', 'https://hostile.example')
          .send({})
      ).status,
    ).toBe(403);
    const malformed = await mutation(user.agent, 'post', '/api/tasks', user.data.csrfToken)
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(malformed.status).toBe(400);
    expect(malformed.body).not.toHaveProperty('stack');
    expect(await prisma.task.count({ where: { userId: user.data.user.id } })).toBe(0);
  });

  it('expires sessions without exposing user data', async () => {
    const user = await account();
    await prisma.session.updateMany({
      where: { userId: user.data.user.id },
      data: { expiresAt: new Date(0) },
    });
    const response = await user.agent.get('/api/session');
    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('tasks');
  });
});

describe('task and project persistence', () => {
  it('creates, updates, completes, archives, reloads and deletes a task with version checks', async () => {
    const user = await account();
    const created = await task(user, {
      title: 'Write the case study',
      description: 'Explain the decisions.',
      duration: 45,
      priority: 'HIGH',
      kind: 'ACTIVE',
    });
    expect(created.scheduledAt).toBeNull();
    expect(created.version).toBe(0);
    const scheduledAt = '2030-05-15T23:45:00Z';
    const edited = await mutation(
      user.agent,
      'patch',
      `/api/tasks/${created.id}`,
      user.data.csrfToken,
    ).send({
      title: 'Review the case study',
      duration: 60,
      scheduledAt,
      placement: 'MANUAL',
      version: created.version,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.scheduledAt).toBe('2030-05-15T23:45:00.000Z');
    expect(edited.body.version).toBe(1);
    const stale = await mutation(
      user.agent,
      'patch',
      `/api/tasks/${created.id}`,
      user.data.csrfToken,
    ).send({ title: 'Stale write', version: created.version });
    expect(stale.status).toBe(409);
    const completed = await mutation(
      user.agent,
      'patch',
      `/api/tasks/${created.id}`,
      user.data.csrfToken,
    ).send({ completed: true, archived: true, version: edited.body.version });
    expect(completed.status).toBe(200);
    const reload = await user.agent.get('/api/session');
    expect(reload.body.tasks).toContainEqual(
      expect.objectContaining({
        id: created.id,
        completed: true,
        archived: true,
        scheduledAt: '2030-05-15T23:45:00.000Z',
        duration: 60,
      }),
    );
    expect(
      (
        await mutation(user.agent, 'delete', `/api/tasks/${created.id}`, user.data.csrfToken).send({
          version: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await mutation(user.agent, 'delete', `/api/tasks/${created.id}`, user.data.csrfToken).send({
          version: completed.body.version,
        })
      ).status,
    ).toBe(204);
    expect((await user.agent.get('/api/session')).body.tasks).toEqual([]);
  });

  it('strictly validates task input and fixed-event scheduling', async () => {
    const user = await account();
    for (const input of [
      { title: '' },
      { title: 'Bad duration', duration: -1 },
      { title: 'Bad priority', priority: 'URGENT' },
      { title: 'Injection', userId: 'other' },
      { title: 'No date', placement: 'FIXED' },
      { title: 'Bad date', scheduledAt: 'yesterday' },
    ]) {
      expect(
        (await mutation(user.agent, 'post', '/api/tasks', user.data.csrfToken).send(input)).status,
      ).toBe(400);
    }
    const fixed = await task(user, {
      title: 'Meeting',
      placement: 'FIXED',
      scheduledAt: '2030-05-15T09:00:00Z',
    });
    expect(
      (
        await mutation(user.agent, 'patch', `/api/tasks/${fixed.id}`, user.data.csrfToken).send({
          scheduledAt: null,
          version: fixed.version,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutation(user.agent, 'patch', '/api/tasks/not-a-uuid', user.data.csrfToken).send({
          version: 0,
        })
      ).status,
    ).toBe(400);
  });

  it('isolates tasks, projects and sessions between users, including project assignment', async () => {
    const first = await account();
    const second = await account();
    const projectResponse = await mutation(
      first.agent,
      'post',
      '/api/projects',
      first.data.csrfToken,
    ).send({ name: 'Private project', color: '#6284d6' });
    expect(projectResponse.status).toBe(201);
    const project = projectResponse.body;
    const privateTask = await task(first, { title: 'Private task', projectId: project.id });
    const secondData = await second.agent.get('/api/session');
    expect(secondData.body.tasks).toEqual([]);
    expect(secondData.body.projects).toEqual([]);
    expect(
      (
        await mutation(
          second.agent,
          'patch',
          `/api/tasks/${privateTask.id}`,
          second.data.csrfToken,
        ).send({ title: 'Steal', version: privateTask.version })
      ).status,
    ).toBe(404);
    expect(
      (
        await mutation(
          second.agent,
          'delete',
          `/api/tasks/${privateTask.id}`,
          second.data.csrfToken,
        ).send({ version: privateTask.version })
      ).status,
    ).toBe(404);
    expect(
      (
        await mutation(second.agent, 'post', '/api/tasks', second.data.csrfToken).send({
          title: 'Foreign project',
          projectId: project.id,
        })
      ).status,
    ).toBe(404);
    const ownTask = await task(second, { title: 'Own task' });
    expect(
      (
        await mutation(
          second.agent,
          'patch',
          `/api/tasks/${ownTask.id}`,
          second.data.csrfToken,
        ).send({ projectId: project.id, version: ownTask.version })
      ).status,
    ).toBe(404);
    expect(
      (
        await mutation(
          second.agent,
          'delete',
          `/api/projects/${project.id}`,
          second.data.csrfToken,
        ).send({})
      ).status,
    ).toBe(404);
    expect(
      (
        await mutation(second.agent, 'post', '/api/tasks', first.data.csrfToken).send({
          title: 'Foreign CSRF',
        })
      ).status,
    ).toBe(403);
    const stillPrivate = await prisma.task.findUniqueOrThrow({ where: { id: privateTask.id } });
    expect(stillPrivate.title).toBe('Private task');
  });

  it('removes a project without deleting its tasks and advances task versions', async () => {
    const user = await account();
    const project = await mutation(user.agent, 'post', '/api/projects', user.data.csrfToken).send({
      name: 'Temporary project',
      color: '#72a78b',
    });
    const created = await task(user, { title: 'Keep this task', projectId: project.body.id });
    expect(
      (
        await mutation(
          user.agent,
          'delete',
          `/api/projects/${project.body.id}`,
          user.data.csrfToken,
        ).send({})
      ).status,
    ).toBe(204);
    const saved = await prisma.task.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.projectId).toBeNull();
    expect(saved.version).toBe(created.version + 1);
  });

  it('validates and persists availability and timezone settings', async () => {
    const user = await account();
    expect(
      (
        await mutation(user.agent, 'patch', '/api/settings', user.data.csrfToken).send({
          dayStart: '18:00',
          dayEnd: '08:00',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutation(user.agent, 'patch', '/api/settings', user.data.csrfToken).send({
          timezone: 'Invalid',
        })
      ).status,
    ).toBe(400);
    const changed = await mutation(user.agent, 'patch', '/api/settings', user.data.csrfToken).send({
      name: 'Updated Person',
      dayStart: '09:00',
      dayEnd: '17:30',
      timezone: 'America/New_York',
    });
    expect(changed.status).toBe(200);
    expect((await user.agent.get('/api/session')).body.user).toMatchObject({
      name: 'Updated Person',
      dayStart: '09:00',
      dayEnd: '17:30',
      timezone: 'America/New_York',
    });
  });

  it('rejects a concurrent stale edit instead of overwriting the first saved change', async () => {
    const user = await account();
    const created = await task(user, { title: 'Original title' });
    const responses = await Promise.all([
      mutation(user.agent, 'patch', `/api/tasks/${created.id}`, user.data.csrfToken).send({
        title: 'First proposed title',
        version: 0,
      }),
      mutation(user.agent, 'patch', `/api/tasks/${created.id}`, user.data.csrfToken).send({
        title: 'Second proposed title',
        version: 0,
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses.find((response) => response.status === 200)!;
    const saved = await prisma.task.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.title).toBe(winner.body.title);
    expect(saved.version).toBe(1);
  });
});

describe('transactional automatic planning', () => {
  it('respects fixed/manual tasks, deadlines, capacities and passive activities; persists and is idempotent', async () => {
    const user = await account();
    const date = addDays(todayInZone('UTC'), 1);
    const at = (time: string) => new Date(localToInstant(date, time, 'UTC')).toISOString();
    await mutation(user.agent, 'patch', '/api/settings', user.data.csrfToken).send({
      dayStart: '09:00',
      dayEnd: '12:00',
    });
    const fixed = await task(user, {
      title: 'Fixed event',
      duration: 60,
      placement: 'FIXED',
      scheduledAt: at('09:00'),
    });
    const manual = await task(user, {
      title: 'Manual work',
      duration: 60,
      placement: 'MANUAL',
      scheduledAt: at('10:00'),
    });
    const active = await task(user, { title: 'Active work', duration: 45, priority: 'HIGH' });
    const passive = await task(user, { title: 'Passive download', duration: 60, kind: 'PASSIVE' });
    const oversized = await task(user, { title: 'Too long', duration: 90, priority: 'LOW' });
    const expired = await task(user, {
      title: 'Deadline already passed',
      duration: 30,
      deadline: at('09:00'),
    });
    const response = await mutation(user.agent, 'post', '/api/organize', user.data.csrfToken).send({
      date,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.scheduled).toEqual(
      expect.arrayContaining([
        { id: active.id, scheduledAt: at('11:00') },
        { id: passive.id, scheduledAt: at('10:00') },
      ]),
    );
    expect(response.body.unscheduled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: oversized.id, reason: expect.any(String) }),
        expect.objectContaining({ id: expired.id, reason: expect.any(String) }),
      ]),
    );
    const savedFixed = await prisma.task.findUniqueOrThrow({ where: { id: fixed.id } });
    const savedManual = await prisma.task.findUniqueOrThrow({ where: { id: manual.id } });
    expect(savedFixed.scheduledAt?.toISOString()).toBe(at('09:00'));
    expect(savedManual.scheduledAt?.toISOString()).toBe(at('10:00'));
    expect(savedFixed.version).toBe(0);
    expect(savedManual.version).toBe(0);
    const savedActive = await prisma.task.findUniqueOrThrow({ where: { id: active.id } });
    expect(savedActive.placement).toBe('AUTO');
    expect(savedActive.version).toBe(1);
    const again = await mutation(user.agent, 'post', '/api/organize', user.data.csrfToken).send({
      date,
    });
    expect(again.status).toBe(200);
    expect(again.body.scheduled).toEqual([]);
    expect(await prisma.task.count({ where: { userId: user.data.user.id } })).toBe(6);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: active.id } })).version).toBe(1);
  });

  it('serializes simultaneous planning runs without duplicate placements or active collisions', async () => {
    const user = await account();
    const date = addDays(todayInZone('UTC'), 2);
    for (let i = 0; i < 5; i++) await task(user, { title: `Concurrent task ${i}`, duration: 45 });
    const responses = await Promise.all([
      mutation(user.agent, 'post', '/api/organize', user.data.csrfToken).send({ date }),
      mutation(user.agent, 'post', '/api/organize', user.data.csrfToken).send({ date }),
      mutation(user.agent, 'post', '/api/organize', user.data.csrfToken).send({ date }),
    ]);
    responses.forEach((response) =>
      expect(response.status, JSON.stringify(response.body)).toBe(200),
    );
    expect(responses.reduce((sum, response) => sum + response.body.scheduled.length, 0)).toBe(5);
    const saved = await prisma.task.findMany({
      where: { userId: user.data.user.id },
      orderBy: { scheduledAt: 'asc' },
    });
    expect(saved.every((item) => item.version === 1 && item.scheduledAt)).toBe(true);
    for (let i = 1; i < saved.length; i++)
      expect(saved[i].scheduledAt!.getTime()).toBeGreaterThanOrEqual(
        saved[i - 1].scheduledAt!.getTime() + saved[i - 1].duration * 60000,
      );
  });

  it('keeps unschedulable tasks in the Inbox, handles another day and rejects invalid dates', async () => {
    const user = await account();
    const created = await task(user, { title: 'Long focus', duration: 90 });
    await mutation(user.agent, 'patch', '/api/settings', user.data.csrfToken).send({
      dayStart: '09:00',
      dayEnd: '10:00',
    });
    const date = addDays(todayInZone('UTC'), 3);
    const impossible = await mutation(
      user.agent,
      'post',
      '/api/organize',
      user.data.csrfToken,
    ).send({ date });
    expect(impossible.status).toBe(200);
    expect(impossible.body.scheduled).toEqual([]);
    expect(impossible.body.unscheduled).toHaveLength(1);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: created.id } })).scheduledAt,
    ).toBeNull();
    expect(
      (
        await mutation(user.agent, 'post', '/api/organize', user.data.csrfToken).send({
          date: '2030-02-31',
        })
      ).status,
    ).toBe(400);
    await mutation(user.agent, 'patch', '/api/settings', user.data.csrfToken).send({
      dayEnd: '12:00',
    });
    const anotherDay = addDays(date, 1);
    const placed = await mutation(user.agent, 'post', '/api/organize', user.data.csrfToken).send({
      date: anotherDay,
    });
    expect(placed.body.scheduled).toEqual([
      {
        id: created.id,
        scheduledAt: new Date(localToInstant(anotherDay, '09:00', 'UTC')).toISOString(),
      },
    ]);
  });

  it('reports a daylight-saving availability error and leaves every task unchanged', async () => {
    const user = await account();
    const created = await task(user, { title: 'Keep unscheduled', duration: 30 });
    await mutation(user.agent, 'patch', '/api/settings', user.data.csrfToken).send({
      timezone: 'Europe/Paris',
      dayStart: '02:30',
      dayEnd: '05:00',
    });
    const response = await mutation(user.agent, 'post', '/api/organize', user.data.csrfToken).send({
      date: '2030-03-31',
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('clock time');
    const saved = await prisma.task.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.scheduledAt).toBeNull();
    expect(saved.version).toBe(0);
  });
});

describe('isolated portfolio demo', () => {
  it('creates distinct private workspaces with realistic tasks and no real account credentials', async () => {
    const first = request.agent(app);
    const second = request.agent(app);
    const a = await mutation(first, 'post', '/api/auth/demo').send({ timezone: 'Europe/Paris' });
    const b = await mutation(second, 'post', '/api/auth/demo').send({ timezone: 'Europe/Paris' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    ids.add(a.body.user.id);
    ids.add(b.body.user.id);
    expect(a.body.user.isDemo).toBe(true);
    expect(a.body.user.email).toBeNull();
    expect(a.body.user.id).not.toBe(b.body.user.id);
    expect(a.body.projects).toHaveLength(3);
    expect(a.body.tasks.some((item: Task) => item.placement === 'FIXED')).toBe(true);
    expect(a.body.tasks.some((item: Task) => item.kind === 'PASSIVE')).toBe(true);
    expect(a.body.tasks.filter((item: Task) => !item.scheduledAt)).toHaveLength(4);
    const privateTask = a.body.tasks[0] as Task;
    expect(
      (
        await mutation(second, 'patch', `/api/tasks/${privateTask.id}`, b.body.csrfToken).send({
          title: 'Cannot edit another demo',
          version: privateTask.version,
        })
      ).status,
    ).toBe(404);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: a.body.user.id } });
    expect(saved.passwordHash).toBeNull();
    expect(saved.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
  });
});
