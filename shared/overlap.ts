import type { Task } from './types';

export interface LaidOutTask {
  task: Task;
  column: number;
  columns: number;
  /** Actual elapsed minutes from the start of the displayed local day. */
  start: number;
  end: number;
}

/**
 * Interval partitioning per connected overlap group. Vertical coordinates are
 * never shifted to hide a collision; tasks keep their exact clipped duration.
 * The caller passes actual UTC day boundaries (23/24/25-hour days supported).
 */
export function layoutOverlaps(tasks: Task[], dayStart: string, dayEnd: string): LaidOutTask[] {
  const start = Date.parse(dayStart);
  const end = Date.parse(dayEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new RangeError('Invalid day bounds.');
  const items: LaidOutTask[] = tasks
    .filter((task) => task.scheduledAt && !task.archived)
    .map((task) => ({
      task,
      column: 0,
      columns: 1,
      start: Math.max(0, (Date.parse(task.scheduledAt!) - start) / 60_000),
      end: Math.min(
        (end - start) / 60_000,
        (Date.parse(task.scheduledAt!) + task.duration * 60_000 - start) / 60_000,
      ),
    }))
    .filter((item) => item.end > item.start)
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0),
    );

  let group: LaidOutTask[] = [];
  let groupEnd = -Infinity;
  let columnEnds: number[] = [];
  const finishGroup = () => {
    for (const item of group) item.columns = columnEnds.length;
  };
  for (const item of items) {
    if (item.start >= groupEnd) {
      finishGroup();
      group = [];
      groupEnd = -Infinity;
      columnEnds = [];
    }
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= item.start);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = item.end;
    item.column = column;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  finishGroup();
  return items;
}

/** Warn about manually allowed active/active overlaps, excluding finished work. */
export function activeConflicts(tasks: Task[]): Set<string> {
  const active = tasks
    .filter(
      (task) => task.scheduledAt && task.kind === 'ACTIVE' && !task.completed && !task.archived,
    )
    .map((task) => ({
      task,
      start: Date.parse(task.scheduledAt!),
      end: Date.parse(task.scheduledAt!) + task.duration * 60_000,
    }))
    .sort((a, b) => a.start - b.start);
  const conflicts = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length && active[j].start < active[i].end; j++) {
      conflicts.add(active[i].task.id);
      conflicts.add(active[j].task.id);
    }
  }
  return conflicts;
}
