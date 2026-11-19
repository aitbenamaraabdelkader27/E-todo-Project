import { describe, expect, it } from 'vitest';
import { activeConflicts, layoutOverlaps } from '../shared/overlap';
import type { Task } from '../shared/types';

const start = '2026-11-04T00:00:00Z';
const end = '2026-11-05T00:00:00Z';
function task(id: string, at: string | null, duration: number, changes: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    scheduledAt: at,
    duration,
    priority: 'MEDIUM',
    kind: 'ACTIVE',
    projectId: null,
    deadline: null,
    placement: 'MANUAL',
    completed: false,
    archived: false,
    version: 1,
    createdAt: start,
    updatedAt: start,
    ...changes,
  };
}
const at = (time: string) => `2026-11-04T${time}:00Z`;

describe('timeline overlap layout', () => {
  it('keeps exact temporal bounds and lays simultaneous work out side by side', () => {
    const result = layoutOverlaps(
      [task('active', at('09:00'), 90), task('passive', at('09:30'), 30, { kind: 'PASSIVE' })],
      start,
      end,
    );
    expect(result.map(({ task, ...item }) => ({ id: task.id, ...item }))).toEqual([
      { id: 'active', column: 0, columns: 2, start: 540, end: 630 },
      { id: 'passive', column: 1, columns: 2, start: 570, end: 600 },
    ]);
  });

  it('shares columns across an overlap chain and resets width after the group ends', () => {
    const result = layoutOverlaps(
      [
        task('a', at('09:00'), 90),
        task('b', at('10:00'), 90),
        task('c', at('11:00'), 90),
        task('d', at('13:00'), 60),
      ],
      start,
      end,
    );
    expect(result.map((item) => [item.column, item.columns])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
      [0, 1],
    ]);
  });

  it('uses as many columns as the maximum simultaneous overlap and is input-order independent', () => {
    const tasks = [
      task('a', at('09:00'), 180),
      task('b', at('09:30'), 120),
      task('c', at('10:00'), 60),
    ];
    const layout = layoutOverlaps(tasks, start, end);
    expect(layout.map((item) => item.columns)).toEqual([3, 3, 3]);
    expect(layout.map((item) => item.column)).toEqual([0, 1, 2]);
    expect(layoutOverlaps([...tasks].reverse(), start, end)).toEqual(layout);
  });

  it('treats adjacent boundaries as separate groups', () => {
    const result = layoutOverlaps(
      [task('a', at('09:00'), 60), task('b', at('10:00'), 60)],
      start,
      end,
    );
    expect(result.map((item) => item.columns)).toEqual([1, 1]);
  });

  it('clips tasks that cross midnight without altering their actual data', () => {
    const previous = task('overnight', '2026-11-03T23:30:00Z', 120);
    const late = task('late', at('23:30'), 120);
    const result = layoutOverlaps([previous, late], start, end);
    expect(result.map((item) => [item.start, item.end])).toEqual([
      [0, 90],
      [1410, 1440],
    ]);
    expect(previous.duration).toBe(120);
    expect(late.duration).toBe(120);
  });

  it('omits archived, unscheduled and wholly out-of-day tasks but retains completed tasks', () => {
    const result = layoutOverlaps(
      [
        task('archived', at('09:00'), 60, { archived: true }),
        task('inbox', null, 30),
        task('previous', '2026-11-03T23:00:00Z', 60),
        task('tomorrow', '2026-11-05T00:00:00Z', 60),
        task('done', at('10:00'), 30, { completed: true }),
      ],
      start,
      end,
    );
    expect(result.map((item) => item.task.id)).toEqual(['done']);
  });

  it('supports a 25-hour day with elapsed-minute positions for both repeated hours', () => {
    const result = layoutOverlaps(
      [
        task('first-0230', '2026-10-25T00:30:00Z', 30),
        task('second-0230', '2026-10-25T01:30:00Z', 30),
      ],
      '2026-10-24T22:00:00Z',
      '2026-10-25T23:00:00Z',
    );
    expect(result.map((item) => [item.start, item.end, item.columns])).toEqual([
      [150, 180, 1],
      [210, 240, 1],
    ]);
  });

  it('rejects malformed or reversed day boundaries', () => {
    expect(() => layoutOverlaps([], 'bad', end)).toThrow(/bounds/);
    expect(() => layoutOverlaps([], end, start)).toThrow(/bounds/);
  });
});

describe('manual active overlap warning', () => {
  it('finds all conflicting active tasks and ignores passive, finished and archived work', () => {
    const result = activeConflicts([
      task('a', at('09:00'), 120),
      task('fixed', at('10:00'), 120, { placement: 'FIXED' }),
      task('adjacent', at('12:00'), 60),
      task('passive', at('09:00'), 120, { kind: 'PASSIVE' }),
      task('done', at('09:00'), 30, { completed: true }),
      task('archived', at('09:00'), 30, { archived: true }),
    ]);
    expect([...result].sort()).toEqual(['a', 'fixed']);
  });

  it('detects cross-midnight conflicts and nested intervals', () => {
    const result = activeConflicts([
      task('overnight', '2026-11-03T23:00:00Z', 180),
      task('inside', at('00:15'), 15),
      task('late', at('01:30'), 60),
    ]);
    expect([...result].sort()).toEqual(['inside', 'late', 'overnight']);
  });
});
