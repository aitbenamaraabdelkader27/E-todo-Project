import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';

const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      Temporal.Now.instant().toZonedDateTimeISO(value);
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid IANA time zone.');
const name = z.string().trim().min(1).max(80);
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Use at most 72 UTF-8 bytes for your password.',
  );
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const instant = z.iso.datetime({ offset: true }).refine((value) => {
  const year = new Date(value).getUTCFullYear();
  return year >= 2000 && year <= 2100;
}, 'Choose a date between 2000 and 2100.');

export const registerSchema = z.strictObject({
  name,
  email,
  password,
  timezone: timezone.default('Europe/Paris'),
});
export const loginSchema = z.strictObject({
  email,
  password: z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password is too long.'),
});
export const demoSchema = z.strictObject({ timezone: timezone.default('Europe/Paris') });
export const projectSchema = z.strictObject({
  name: name.max(60),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
});
export const settingsSchema = z.strictObject({
  name: name.optional(),
  timezone: timezone.optional(),
  dayStart: clock.optional(),
  dayEnd: clock.optional(),
});
export const taskSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  duration: z.number().int().min(5).max(1440).optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  kind: z.enum(['ACTIVE', 'PASSIVE']).optional(),
  projectId: z.uuid().nullable().optional(),
  scheduledAt: instant.nullable().optional(),
  deadline: instant.nullable().optional(),
  placement: z.enum(['MANUAL', 'AUTO', 'FIXED']).optional(),
  completed: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export const patchTaskSchema = taskSchema
  .partial()
  .extend({ version: z.number().int().min(0) })
  .strict();
export const versionSchema = z.strictObject({ version: z.number().int().min(0) });
export const dateSchema = z.strictObject({
  date: z
    .string()
    .regex(/^20\d\d-\d{2}-\d{2}$/)
    .refine((value) => {
      try {
        Temporal.PlainDate.from(value);
        return true;
      } catch {
        return false;
      }
    }, 'Choose a valid date.'),
});
