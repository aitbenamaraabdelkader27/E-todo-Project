import { describe, expect, it } from 'vitest';
import { organizeDay, type ScheduleOptions } from '../shared/scheduler';
import type { Task } from '../shared/types';

const options: ScheduleOptions = {
  date: '2026-11-04',
  timezone: 'UTC',
  dayStart: '09:00',
  dayEnd: '17:00',
};
function task(id: string, changes: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    duration: 60,
    priority: 'MEDIUM',
    kind: 'ACTIVE',
    projectId: null,
    scheduledAt: null,
    deadline: null,
    placement: 'MANUAL',
    completed: false,
    archived: false,
    version: 1,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...changes,
  };
}
const at = (time: string) => `2026-11-04T${time}:00.000Z`;

describe('deterministic day organizer', () => {
  it('orders by earliest deadline, priority, creation date, then stable ID', () => {
    const tasks = [
      task('z-low', { priority: 'LOW' }),
      task('b-high', { priority: 'HIGH' }),
      task('a-high', { priority: 'HIGH' }),
      task('deadline', { priority: 'LOW', deadline: at('12:00') }),
      task('older', { priority: 'HIGH', createdAt: '2026-10-01T00:00:00Z' }),
    ];
    const result = organizeDay(tasks, options);
    expect(result.scheduled).toEqual([
      { id: 'deadline', scheduledAt: at('09:00') },
      { id: 'older', scheduledAt: at('10:00') },
      { id: 'a-high', scheduledAt: at('11:00') },
      { id: 'b-high', scheduledAt: at('12:00') },
      { id: 'z-low', scheduledAt: at('13:00') },
    ]);
    expect(organizeDay([...tasks].reverse(), options)).toEqual(result);
  });

  it('preserves fixed appointments, manual placements and previously automatic placements', () => {
    const tasks = [
      task('meeting', { placement: 'FIXED', scheduledAt: at('09:00') }),
      task('manual', { placement: 'MANUAL', scheduledAt: at('10:00') }),
      task('previous-auto', { placement: 'AUTO', scheduledAt: at('12:00') }),
      task('new-90', { duration: 90 }),
      task('new-30', { duration: 30 }),
    ];
    const copy = structuredClone(tasks);
    expect(organizeDay(tasks, options).scheduled).toEqual([
      { id: 'new-30', scheduledAt: at('11:00') },
      { id: 'new-90', scheduledAt: at('13:00') },
    ]);
    expect(tasks).toEqual(copy);
  });

  it('never overlaps automatically placed active tasks, including overlapping existing blockers', () => {
    const tasks = [
      task('manual-a', { scheduledAt: at('09:00'), duration: 120 }),
      task('manual-b', { scheduledAt: at('10:00'), duration: 120 }),
      task('first'),
      task('second'),
    ];
    expect(organizeDay(tasks, options).scheduled).toEqual([
      { id: 'first', scheduledAt: at('12:00') },
      { id: 'second', scheduledAt: at('13:00') },
    ]);
  });

  it('allows one passive activity alongside active work, but respects passive duration', () => {
    const result = organizeDay(
      [
        task('active', { duration: 120 }),
        task('backup', { kind: 'PASSIVE', duration: 90 }),
        task('download', { kind: 'PASSIVE', duration: 30 }),
      ],
      options,
    );
    expect(result.scheduled).toEqual([
      { id: 'active', scheduledAt: at('09:00') },
      { id: 'backup', scheduledAt: at('09:00') },
      { id: 'download', scheduledAt: at('10:30') },
    ]);
  });

  it('fixed events block both attention lanes, even when the event is labelled passive', () => {
    const result = organizeDay(
      [
        task('fixed', {
          placement: 'FIXED',
          kind: 'PASSIVE',
          scheduledAt: at('09:00'),
          duration: 120,
        }),
        task('active'),
        task('passive', { kind: 'PASSIVE' }),
      ],
      options,
    );
    expect(result.scheduled).toEqual([
      { id: 'active', scheduledAt: at('11:00') },
      { id: 'passive', scheduledAt: at('11:00') },
    ]);
  });

  it('permits exact adjacent boundaries and completion exactly at the deadline', () => {
    const result = organizeDay(
      [
        task('fixed', { placement: 'FIXED', scheduledAt: at('10:00') }),
        task('early', { deadline: at('10:00') }),
        task('later', { deadline: at('12:00') }),
      ],
      options,
    );
    expect(result.scheduled).toEqual([
      { id: 'early', scheduledAt: at('09:00') },
      { id: 'later', scheduledAt: at('11:00') },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('leaves overdue and unplaceable tasks in the Inbox with distinct explanations', () => {
    const result = organizeDay(
      [
        task('overdue', { deadline: at('08:00') }),
        task('too-long', { duration: 600 }),
        task('deadline-too-soon', { duration: 120, deadline: at('10:00') }),
      ],
      options,
    );
    expect(result.scheduled).toEqual([]);
    expect(result.unscheduled.find((t) => t.id === 'overdue')?.reason).toMatch(
      /deadline is before/,
    );
    expect(result.unscheduled.find((t) => t.id === 'too-long')?.reason).toMatch(/longer than/);
    expect(result.unscheduled.find((t) => t.id === 'deadline-too-soon')?.reason).toMatch(
      /before the deadline/,
    );
  });

  it('reports a full day without displacing anything or creating a zero-length passive task', () => {
    const result = organizeDay(
      [
        task('all-day', { scheduledAt: at('09:00'), placement: 'FIXED', duration: 480 }),
        task('active'),
        task('passive', { kind: 'PASSIVE', duration: 90 }),
      ],
      options,
    );
    expect(result.scheduled).toEqual([]);
    expect(result.unscheduled).toHaveLength(2);
    expect(result.unscheduled.every((t) => /no uninterrupted slot/.test(t.reason))).toBe(true);
  });

  it('is idempotent after the caller applies placements and never mutates inputs', () => {
    const tasks = [task('a'), task('b')];
    const original = structuredClone(tasks);
    const first = organizeDay(tasks, options);
    const persisted = tasks.map((t) => ({
      ...t,
      scheduledAt: first.scheduled.find((p) => p.id === t.id)?.scheduledAt ?? t.scheduledAt,
      placement: 'AUTO' as const,
    }));
    expect(organizeDay(persisted, options)).toEqual({ scheduled: [], unscheduled: [] });
    expect(tasks).toEqual(original);
  });

  it('ignores completed, archived and unscheduled fixed tasks and frees archived blockers', () => {
    const result = organizeDay(
      [
        task('completed', { completed: true }),
        task('archived', { archived: true }),
        task('unscheduled-fixed', { placement: 'FIXED' }),
        task('old-blocker', { archived: true, scheduledAt: at('09:00'), duration: 480 }),
        task('new'),
      ],
      options,
    );
    expect(result).toEqual({
      scheduled: [{ id: 'new', scheduledAt: at('09:00') }],
      unscheduled: [],
    });
  });

  it('continues to respect completed scheduled time rather than silently replacing it', () => {
    expect(
      organizeDay(
        [task('done', { scheduledAt: at('09:00'), completed: true }), task('next')],
        options,
      ).scheduled,
    ).toEqual([{ id: 'next', scheduledAt: at('10:00') }]);
  });

  it('clips an overnight previous-day task when checking morning availability', () => {
    expect(
      organizeDay(
        [task('overnight', { scheduledAt: '2026-11-03T23:00:00Z', duration: 660 }), task('new')],
        options,
      ).scheduled,
    ).toEqual([{ id: 'new', scheduledAt: at('10:00') }]);
  });

  it('uses the selected day and ignores blockers outside its availability', () => {
    const result = organizeDay(
      [
        task('yesterday', { scheduledAt: '2026-11-03T09:00:00Z' }),
        task('tomorrow', { scheduledAt: '2026-11-05T09:00:00Z' }),
        task('new'),
      ],
      { ...options, date: '2026-11-06' },
    );
    expect(result.scheduled).toEqual([{ id: 'new', scheduledAt: '2026-11-06T09:00:00.000Z' }]);
  });

  it('does not plan into the past and rounds the current time up to a whole minute', () => {
    expect(
      organizeDay([task('new')], { ...options, now: '2026-11-04T10:20:30Z' }).scheduled,
    ).toEqual([{ id: 'new', scheduledAt: at('10:21') }]);
    expect(
      organizeDay([task('new')], { ...options, now: '2026-11-05T10:00:00Z' }).unscheduled[0].reason,
    ).toMatch(/availability has ended/);
  });

  it('handles time zones and actual duration across a spring daylight-saving transition', () => {
    const result = organizeDay(
      [task('first', { duration: 120 }), task('second', { duration: 60 })],
      {
        date: '2026-03-29',
        timezone: 'Europe/Paris',
        dayStart: '01:00',
        dayEnd: '05:00',
      },
    );
    expect(result.scheduled).toEqual([
      { id: 'first', scheduledAt: '2026-03-29T00:00:00.000Z' },
      { id: 'second', scheduledAt: '2026-03-29T02:00:00.000Z' },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('handles the extra hour in a fall daylight-saving transition without duplicate placements', () => {
    const result = organizeDay(
      [task('first', { duration: 180 }), task('second', { duration: 120 })],
      {
        date: '2026-10-25',
        timezone: 'Europe/Paris',
        dayStart: '01:00',
        dayEnd: '05:00',
      },
    );
    expect(result.scheduled).toEqual([
      { id: 'first', scheduledAt: '2026-10-24T23:00:00.000Z' },
      { id: 'second', scheduledAt: '2026-10-25T02:00:00.000Z' },
    ]);
  });

  it('rejects invalid availability, duration, timestamps and duplicate task identifiers', () => {
    expect(() => organizeDay([], { ...options, dayStart: '17:00', dayEnd: '09:00' })).toThrow(
      /availability/,
    );
    expect(() => organizeDay([task('bad', { duration: 0 })], options)).toThrow(/durations/);
    expect(() => organizeDay([task('bad', { duration: 1.5 })], options)).toThrow(/durations/);
    expect(() => organizeDay([task('bad', { deadline: 'invalid' })], options)).toThrow(/timestamp/);
    expect(() => organizeDay([task('same'), task('same')], options)).toThrow(/unique/);
  });
});
