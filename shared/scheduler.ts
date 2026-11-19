import type { ScheduleResult, Task } from './types';
import { localDayBounds, localToInstant } from './time';

export interface ScheduleOptions {
  date: string;
  timezone: string;
  dayStart: string;
  dayEnd: string;
  /** Supply the server's current instant to avoid planning into the past. */
  now?: string;
}

interface Interval {
  start: number;
  end: number;
}
const MINUTE = 60_000;
const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function instant(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new RangeError('Invalid timestamp.');
  return result;
}

/** Earliest contiguous fit; touching boundaries do not overlap. */
function earliestFit(
  intervals: Interval[],
  start: number,
  end: number,
  duration: number,
): number | null {
  let cursor = start;
  for (const interval of [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (interval.end <= cursor) continue;
    if (cursor + duration <= Math.min(interval.start, end)) return cursor;
    cursor = Math.max(cursor, interval.end);
    if (cursor + duration > end) return null;
  }
  return cursor + duration <= end ? cursor : null;
}

/**
 * Deterministic, side-effect-free first-fit planner. The caller persists the
 * returned placements in one transaction. There is no implicit clock or random
 * value: identical tasks/options produce identical placements and explanations.
 *
 * Each attention lane has capacity one. Passive work may share an active slot,
 * but two passive activities do not overlap automatically. Fixed appointments
 * occupy both lanes. Existing placements are never changed, even on a rerun.
 */
export function organizeDay(tasks: Task[], options: ScheduleOptions): ScheduleResult {
  const bounds = localDayBounds(options.date, options.timezone);
  const start = instant(localToInstant(options.date, options.dayStart, options.timezone));
  const end = instant(localToInstant(options.date, options.dayEnd, options.timezone));
  if (start < bounds.start.getTime() || end > bounds.end.getTime() || end <= start) {
    throw new RangeError('Daily availability must end after it starts, within the same day.');
  }
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    throw new RangeError('Task IDs must be unique.');
  }
  for (const task of tasks) {
    if (!Number.isInteger(task.duration) || task.duration <= 0) {
      throw new RangeError('Task durations must be positive whole minutes.');
    }
  }
  const result: ScheduleResult = { scheduled: [], unscheduled: [] };
  const lanes: Record<'ACTIVE' | 'PASSIVE', Interval[]> = { ACTIVE: [], PASSIVE: [] };

  for (const task of tasks) {
    if (!task.scheduledAt || task.archived) continue;
    const interval = {
      start: instant(task.scheduledAt),
      end: instant(task.scheduledAt) + task.duration * MINUTE,
    };
    if (interval.end <= start || interval.start >= end) continue;
    if (task.placement === 'FIXED') {
      lanes.ACTIVE.push(interval);
      lanes.PASSIVE.push(interval);
    } else {
      lanes[task.kind].push(interval);
    }
  }

  const earliest = options.now
    ? Math.max(start, Math.ceil(instant(options.now) / MINUTE) * MINUTE)
    : start;
  const eligible = tasks.filter(
    (task) => !task.scheduledAt && !task.completed && !task.archived && task.placement !== 'FIXED',
  );
  eligible.sort(
    (a, b) =>
      (a.deadline ? instant(a.deadline) : Infinity) -
        (b.deadline ? instant(b.deadline) : Infinity) ||
      priorityRank[a.priority] - priorityRank[b.priority] ||
      compareText(a.createdAt, b.createdAt) ||
      compareText(a.id, b.id),
  );

  for (const task of eligible) {
    const deadline = task.deadline ? instant(task.deadline) : end;
    const latest = Math.min(end, deadline);
    const duration = task.duration * MINUTE;
    let reason: string | undefined;
    if (earliest >= end) {
      reason = 'Today’s availability has ended. Choose another day or extend your availability.';
    } else if (deadline <= earliest) {
      reason =
        'The deadline is before the next available time. Choose an earlier day or update the deadline.';
    } else if (duration > end - start) {
      reason =
        'This task is longer than your daily availability. Shorten it or extend your availability.';
    }
    const scheduledAt = reason ? null : earliestFit(lanes[task.kind], earliest, latest, duration);
    if (scheduledAt === null) {
      result.unscheduled.push({
        id: task.id,
        reason:
          reason ??
          (deadline < end
            ? 'There is no uninterrupted slot before the deadline. Choose an earlier day or adjust the duration.'
            : 'There is no uninterrupted slot long enough. Choose another day or adjust your availability.'),
      });
      continue;
    }
    lanes[task.kind].push({ start: scheduledAt, end: scheduledAt + duration });
    result.scheduled.push({ id: task.id, scheduledAt: new Date(scheduledAt).toISOString() });
  }
  return result;
}
