import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  CalendarPlus,
  Check,
  Circle,
  GripVertical,
  LockKeyhole,
  MoreHorizontal,
  MoveVertical,
  Plus,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import type { Project, Task, TaskInput, User } from '../../shared/types';
import { formatTime, localDayBounds, localToInstant } from '../../shared/time';
import { activeConflicts, layoutOverlaps } from '../../shared/overlap';

const PX_MIN = 1.35;
const SNAP = 15;
const minute = 60_000;
interface Drag {
  task: Task;
  mode: 'move' | 'resize';
  start: number;
  duration: number;
  origin: number;
  scrollOrigin: number;
  changed: boolean;
}
function durationLabel(n: number) {
  return n < 60 ? `${n}m` : `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}`;
}

export function Timeline({
  tasks,
  projects,
  user,
  date,
  onEdit,
  onCreate,
  onUpdate,
  onSettings,
  saving,
}: {
  tasks: Task[];
  projects: Project[];
  user: User;
  date: string;
  saving: Set<string>;
  onEdit: (task: Task) => void;
  onCreate: (time: string) => void;
  onUpdate: (task: Task, input: TaskInput) => Promise<void>;
  onSettings: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropMinute, setDropMinute] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const bounds = localDayBounds(date, user.timezone);
  const startMs = bounds.start.getTime();
  const endMs = bounds.end.getTime();
  const dayMinutes = (endMs - startMs) / minute;
  const visibleTasks = tasks.filter(
    (t) =>
      !t.archived &&
      t.scheduledAt &&
      Date.parse(t.scheduledAt) < endMs &&
      Date.parse(t.scheduledAt) + t.duration * minute > startMs,
  );
  const layout = layoutOverlaps(visibleTasks, bounds.start.toISOString(), bounds.end.toISOString());
  const conflicts = activeConflicts(visibleTasks);
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const nowMinutes = (now - startMs) / minute;
  let availabilityStart = 0;
  let availabilityEnd = dayMinutes;
  let availabilityError = false;
  try {
    availabilityStart =
      (Date.parse(localToInstant(date, user.dayStart, user.timezone)) - startMs) / minute;
    availabilityEnd =
      (Date.parse(localToInstant(date, user.dayEnd, user.timezone)) - startMs) / minute;
  } catch {
    availabilityError = true;
  }
  const scrollStart = availabilityError ? 450 : Math.max(0, availabilityStart - 30);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollStart * PX_MIN;
  }, [date, scrollStart]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  function pointMinute(clientY: number) {
    const rect = gridRef.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(dayMinutes - SNAP, Math.round((clientY - rect.top) / PX_MIN / SNAP) * SNAP),
    );
  }
  function begin(e: ReactPointerEvent<HTMLButtonElement>, task: Task, mode: Drag['mode']) {
    if (e.button !== 0 || saving.has(task.id)) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const value: Drag = {
      task,
      mode,
      start: (Date.parse(task.scheduledAt!) - startMs) / minute,
      duration: task.duration,
      origin: e.clientY,
      scrollOrigin: scrollRef.current!.scrollTop,
      changed: false,
    };
    dragRef.current = value;
    setDrag(value);
  }
  function move(e: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;
    const originalStart = (Date.parse(current.task.scheduledAt!) - startMs) / minute;
    const delta =
      Math.round(
        (e.clientY - current.origin + scrollRef.current!.scrollTop - current.scrollOrigin) /
          PX_MIN /
          SNAP,
      ) * SNAP;
    const value =
      current.mode === 'move'
        ? {
            ...current,
            start: Math.max(
              originalStart < 0 ? -current.task.duration + 5 : 0,
              Math.min(dayMinutes - SNAP, originalStart + delta),
            ),
            changed: delta !== 0,
          }
        : {
            ...current,
            duration: Math.max(5, Math.min(1440, current.task.duration + delta)),
            changed: delta !== 0,
          };
    dragRef.current = value;
    setDrag(value);
    const viewport = scrollRef.current!.getBoundingClientRect();
    if (e.clientY < viewport.top + 48) scrollRef.current!.scrollTop -= 8;
    if (e.clientY > viewport.bottom - 48) scrollRef.current!.scrollTop += 8;
  }
  function finish(e: ReactPointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current?.changed) return;
    void onUpdate(current.task, {
      title: current.task.title,
      scheduledAt: new Date(startMs + current.start * minute).toISOString(),
      duration: current.duration,
      placement: current.task.placement === 'FIXED' ? 'FIXED' : 'MANUAL',
    }).catch(() => {});
  }
  function cancel() {
    dragRef.current = null;
    setDrag(null);
  }
  function keyboard(e: React.KeyboardEvent<HTMLButtonElement>, task: Task, mode: Drag['mode']) {
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? -SNAP : SNAP;
    void onUpdate(
      task,
      mode === 'move'
        ? {
            title: task.title,
            scheduledAt: new Date(Date.parse(task.scheduledAt!) + delta * minute).toISOString(),
            placement: task.placement === 'FIXED' ? 'FIXED' : 'MANUAL',
          }
        : {
            title: task.title,
            duration: Math.max(5, Math.min(1440, task.duration + delta)),
            placement: task.placement === 'FIXED' ? 'FIXED' : 'MANUAL',
          },
    ).catch(() => {});
  }
  const previewStart = drag ? startMs + drag.start * minute : 0;
  const previewEnd = drag ? previewStart + drag.duration * minute : 0;
  const previewConflict =
    drag?.task.kind === 'ACTIVE' &&
    visibleTasks.some(
      (t) =>
        t.id !== drag.task.id &&
        !t.completed &&
        t.kind === 'ACTIVE' &&
        Date.parse(t.scheduledAt!) < previewEnd &&
        Date.parse(t.scheduledAt!) + t.duration * minute > previewStart,
    );
  const occupied = visibleTasks
    .filter((t) => t.kind === 'ACTIVE' || t.placement === 'FIXED')
    .map((t) => ({
      start: Math.max(availabilityStart, (Date.parse(t.scheduledAt!) - startMs) / minute),
      end: Math.min(availabilityEnd, (Date.parse(t.scheduledAt!) - startMs) / minute + t.duration),
    }))
    .filter((t) => t.end > t.start)
    .sort((a, b) => a.start - b.start);
  const free: { start: number; end: number }[] = [];
  let cursor = availabilityStart;
  for (const slot of occupied) {
    if (slot.start - cursor >= 45) free.push({ start: cursor, end: slot.start });
    cursor = Math.max(cursor, slot.end);
  }
  if (availabilityEnd - cursor >= 45) free.push({ start: cursor, end: availabilityEnd });

  return (
    <section className="timeline-panel" aria-label="Daily timeline">
      <div className="panel-heading">
        <div>
          <span className="section-eyebrow">YOUR TIMELINE</span>
          <span className="timezone-label">
            {user.timezone.split('/').pop()?.replaceAll('_', ' ')}
            <span className="soft-dot" />
            {user.dayStart} – {user.dayEnd}
          </span>
        </div>
        <button
          className="icon-button"
          title="Schedule a task"
          aria-label="Schedule a task"
          onClick={() => onCreate(availabilityError ? '09:00' : user.dayStart)}
        >
          <CalendarPlus size={17} />
        </button>
      </div>
      {availabilityError && (
        <div className="availability-warning" role="alert">
          <span>
            The clocks change on this date. Your availability needs a different start or end time.
          </span>
          <button onClick={onSettings}>Adjust hours</button>
        </div>
      )}
      <p className="sr-only" id="timeline-instructions">
        Use the move or resize handle with up and down arrow keys in 15 minute steps. Open task
        details to choose any date and time.
      </p>
      <div className={`timeline-scroll ${drag ? 'is-dragging' : ''}`} ref={scrollRef}>
        <div
          className="timeline-grid"
          ref={gridRef}
          style={{ height: dayMinutes * PX_MIN }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-flow-task')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropMinute(pointMinute(e.clientY));
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropMinute(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDropMinute(null);
            const id = e.dataTransfer.getData('application/x-flow-task');
            const task = tasks.find((t) => t.id === id);
            if (task)
              void onUpdate(task, {
                title: task.title,
                scheduledAt: new Date(startMs + pointMinute(e.clientY) * minute).toISOString(),
                placement: 'MANUAL',
              }).catch(() => {});
          }}
        >
          <div className="outside-hours" style={{ top: 0, height: availabilityStart * PX_MIN }} />
          <div
            className="outside-hours"
            style={{
              top: availabilityEnd * PX_MIN,
              height: Math.max(0, dayMinutes - availabilityEnd) * PX_MIN,
            }}
          />
          {Array.from({ length: Math.ceil(dayMinutes / 60) + 1 }, (_, i) => i * 60)
            .filter((n) => n < dayMinutes)
            .map((n) => (
              <div className="hour-line" key={n} style={{ top: n * PX_MIN }}>
                <span>
                  {formatTime(new Date(startMs + n * minute).toISOString(), user.timezone)}
                </span>
                <i />
                <button
                  tabIndex={-1}
                  aria-label={`Add task at ${formatTime(new Date(startMs + n * minute).toISOString(), user.timezone)}`}
                  onClick={() =>
                    onCreate(
                      formatTime(new Date(startMs + n * minute).toISOString(), user.timezone),
                    )
                  }
                >
                  <Plus size={13} />
                </button>
              </div>
            ))}
          {!availabilityError &&
            free.map((slot, i) => (
              <button
                key={`${slot.start}-${i}`}
                className="free-slot"
                style={{
                  top: slot.start * PX_MIN + 8,
                  height: (slot.end - slot.start) * PX_MIN - 16,
                }}
                onClick={() =>
                  onCreate(
                    formatTime(
                      new Date(startMs + slot.start * minute).toISOString(),
                      user.timezone,
                    ),
                  )
                }
              >
                <Plus size={13} />
                <span>{durationLabel(slot.end - slot.start)} to make your own</span>
              </button>
            ))}
          {visibleTasks.length === 0 && (
            <div className="timeline-empty" style={{ top: (availabilityStart + 60) * PX_MIN }}>
              <span className="empty-orbit">
                <CalendarPlus size={24} />
              </span>
              <h3>A little breathing room.</h3>
              <p>
                Drop a task here, choose a time,
                <br />
                or let Flow organize your day.
              </p>
              <button className="secondary-button" onClick={() => onCreate(user.dayStart)}>
                Plan your first task
                <Plus size={14} />
              </button>
            </div>
          )}
          {layout.map(({ task, column, columns, start, end }) => {
            const project = task.projectId ? projectMap.get(task.projectId) : undefined;
            const color = project?.color ?? '#6b8ee8';
            const isDragging = drag?.task.id === task.id;
            const height = (end - start) * PX_MIN - 3;
            return (
              <motion.article
                key={task.id}
                initial={reduceMotion ? false : { y: 6 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className={`time-block ${height < 65 ? 'compact-block' : ''} ${height < 25 ? 'tiny-block' : ''} ${task.kind.toLowerCase()} ${task.placement === 'FIXED' ? 'fixed' : ''} ${task.completed ? 'completed' : ''} ${isDragging ? 'drag-origin' : ''} ${saving.has(task.id) ? 'saving' : ''}`}
                style={
                  {
                    '--task-color': color,
                    top: start * PX_MIN,
                    height: Math.max(5, height),
                    left: `calc(65px + (100% - 83px) * ${column / columns})`,
                    width: `calc((100% - 83px) / ${columns} - 5px)`,
                  } as React.CSSProperties
                }
              >
                <div className="block-top">
                  <button
                    className={`completion-check ${task.completed ? 'checked' : ''}`}
                    aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
                    disabled={saving.has(task.id)}
                    onClick={() =>
                      void onUpdate(task, { title: task.title, completed: !task.completed }).catch(
                        () => {},
                      )
                    }
                  >
                    {task.completed && <Check size={11} strokeWidth={3} />}
                  </button>
                  <button className="block-title" onClick={() => onEdit(task)} title={task.title}>
                    {task.title}
                  </button>
                  {conflicts.has(task.id) && (
                    <span
                      className="overlap-icon"
                      role="img"
                      title="Shares time with another active task"
                      aria-label="Overlapping active tasks"
                    >
                      <TriangleAlert size={11} />
                    </span>
                  )}
                  <button
                    className="block-more"
                    aria-label={`Edit ${task.title}`}
                    onClick={() => onEdit(task)}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
                {height > 30 && (
                  <div className="block-time">
                    <span>
                      {formatTime(task.scheduledAt!, user.timezone)} –{' '}
                      {formatTime(
                        new Date(
                          Date.parse(task.scheduledAt!) + task.duration * minute,
                        ).toISOString(),
                        user.timezone,
                      )}
                    </span>
                    <span className="block-duration">{durationLabel(task.duration)}</span>
                  </div>
                )}
                {height > 63 && (
                  <div className="block-meta">
                    <span>
                      {task.placement === 'FIXED' ? (
                        <LockKeyhole size={11} />
                      ) : task.kind === 'PASSIVE' ? (
                        <Circle size={11} />
                      ) : (
                        <Zap size={11} />
                      )}
                      {task.placement === 'FIXED'
                        ? 'Fixed event'
                        : task.kind === 'PASSIVE'
                          ? 'Passive'
                          : (project?.name ?? 'Focus time')}
                    </span>
                    {conflicts.has(task.id) && (
                      <span className="overlap-note" title="This task overlaps another active task">
                        Shared time
                      </span>
                    )}
                    {Date.parse(task.scheduledAt!) + task.duration * minute > endMs && (
                      <span>→ next day</span>
                    )}
                  </div>
                )}
                <button
                  className="move-handle"
                  aria-label={`Move ${task.title}`}
                  aria-describedby="timeline-instructions"
                  disabled={saving.has(task.id)}
                  onPointerDown={(e) => begin(e, task, 'move')}
                  onPointerMove={move}
                  onPointerUp={finish}
                  onPointerCancel={cancel}
                  onKeyDown={(e) => keyboard(e, task, 'move')}
                >
                  <GripVertical size={14} />
                </button>
                <button
                  className="resize-handle"
                  aria-label={`Resize ${task.title}`}
                  aria-describedby="timeline-instructions"
                  disabled={saving.has(task.id)}
                  onPointerDown={(e) => begin(e, task, 'resize')}
                  onPointerMove={move}
                  onPointerUp={finish}
                  onPointerCancel={cancel}
                  onKeyDown={(e) => keyboard(e, task, 'resize')}
                >
                  <span />
                </button>
              </motion.article>
            );
          })}
          {drag && (
            <div
              className={`drag-preview ${previewConflict ? 'conflict' : ''}`}
              style={{
                top: Math.max(0, drag.start) * PX_MIN,
                height: Math.min(drag.duration, dayMinutes - drag.start) * PX_MIN - 3,
              }}
            >
              <MoveVertical size={14} />
              <strong>{drag.task.title}</strong>
              <span>
                {formatTime(new Date(previewStart).toISOString(), user.timezone)} –{' '}
                {formatTime(new Date(previewEnd).toISOString(), user.timezone)} ·{' '}
                {durationLabel(drag.duration)}
              </span>
              {previewConflict && <small>Overlaps an active task</small>}
            </div>
          )}
          {dropMinute !== null && (
            <div className="drop-preview" style={{ top: dropMinute * PX_MIN }}>
              <span>
                {formatTime(new Date(startMs + dropMinute * minute).toISOString(), user.timezone)}
              </span>
              <i />
            </div>
          )}
          {nowMinutes >= 0 && nowMinutes < dayMinutes && (
            <div className="now-line" style={{ top: nowMinutes * PX_MIN }}>
              <span>{formatTime(new Date(now).toISOString(), user.timezone)}</span>
              <i />
            </div>
          )}
        </div>
      </div>
      <div className="timeline-footer">
        <span>
          <span className="legend-dot active-dot" />
          Active
        </span>
        <span>
          <span className="legend-dot passive-dot" />
          Passive
        </span>
        <span>
          <LockKeyhole size={11} />
          Fixed
        </span>
        <span className="timeline-tip">Drag to move · Pull edge to resize</span>
      </div>
    </section>
  );
}
