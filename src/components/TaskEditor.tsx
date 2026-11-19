import { useState, type FormEvent } from 'react';
import {
  Archive,
  CalendarDays,
  Check,
  Circle,
  Clock3,
  LockKeyhole,
  Trash2,
  Zap,
} from 'lucide-react';
import type { Project, Task, TaskInput, User } from '../../shared/types';
import { localDateTime, localToInstant } from '../../shared/time';
import { Dialog } from './Dialog';
import { ApiError } from '../api';

export interface EditorState {
  task?: Task;
  date?: string;
  time?: string;
  projectId?: string;
}

export function TaskEditor({
  editor,
  projects,
  tasks,
  user,
  selectedDate,
  onSave,
  onDelete,
  onClose,
  onReload,
}: {
  editor: EditorState;
  projects: Project[];
  tasks: Task[];
  user: User;
  selectedDate: string;
  onSave: (input: TaskInput, task?: Task) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
  onClose: () => void;
  onReload: (task: Task) => void | Promise<void>;
}) {
  const task = editor.task;
  const existing = task?.scheduledAt ? localDateTime(task.scheduledAt, user.timezone) : null;
  const due = task?.deadline ? localDateTime(task.deadline, user.timezone) : null;
  const [scheduled, setScheduled] = useState(!!existing || !!editor.time);
  const [kind, setKind] = useState(task?.kind ?? 'ACTIVE');
  const [priority, setPriority] = useState(task?.priority ?? 'MEDIUM');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(existing?.date ?? editor.date ?? selectedDate);
  const [scheduleTime, setScheduleTime] = useState(existing?.time ?? editor.time ?? '09:00');
  const [duration, setDuration] = useState(task?.duration ?? 30);
  const [deadlineValue, setDeadlineValue] = useState(due ? `${due.date}T${due.time}` : '');
  const [occurrence, setOccurrence] = useState<'reject' | 'earlier' | 'later'>('reject');
  const [dueOccurrence, setDueOccurrence] = useState<'reject' | 'earlier' | 'later'>('reject');
  function isRepeated(date: string, time: string) {
    try {
      return (
        localToInstant(date, time, user.timezone, 'earlier') !==
        localToInstant(date, time, user.timezone, 'later')
      );
    } catch {
      return false;
    }
  }
  const sameSchedule = existing?.date === scheduleDate && existing?.time === scheduleTime;
  const sameDeadline = !!due && `${due.date}T${due.time}` === deadlineValue;
  function scheduleInstant() {
    if (sameSchedule && occurrence === 'reject') return task!.scheduledAt!;
    if (occurrence === 'reject' && isRepeated(scheduleDate, scheduleTime))
      throw new Error(
        'This time occurs twice when the clocks change. Choose the first or second occurrence.',
      );
    return localToInstant(scheduleDate, scheduleTime, user.timezone, occurrence);
  }
  let overlap = false;
  if (scheduled && kind === 'ACTIVE') {
    try {
      const start = Date.parse(scheduleInstant());
      overlap = tasks.some(
        (t) =>
          t.id !== task?.id &&
          !t.archived &&
          !t.completed &&
          t.scheduledAt &&
          (t.kind === 'ACTIVE' || t.placement === 'FIXED') &&
          Date.parse(t.scheduledAt) < start + duration * 60_000 &&
          Date.parse(t.scheduledAt) + t.duration * 60_000 > start,
      );
    } catch {
      /* Invalid local times are explained when submitting. */
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      const scheduledAt = scheduled ? scheduleInstant() : null;
      if (
        deadlineValue &&
        !sameDeadline &&
        dueOccurrence === 'reject' &&
        isRepeated(deadlineValue.split('T')[0], deadlineValue.split('T')[1])
      )
        throw new Error('This deadline time occurs twice. Choose the first or second occurrence.');
      const deadline =
        sameDeadline && dueOccurrence === 'reject'
          ? task!.deadline
          : deadlineValue
            ? localToInstant(
                deadlineValue.split('T')[0],
                deadlineValue.split('T')[1],
                user.timezone,
                dueOccurrence,
              )
            : null;
      await onSave(
        {
          title: String(data.get('title')).trim(),
          description: String(data.get('description')).trim(),
          duration,
          priority,
          kind,
          projectId: String(data.get('projectId') || '') || null,
          scheduledAt,
          deadline,
          placement: scheduled && data.get('fixed') === 'on' ? 'FIXED' : 'MANUAL',
        },
        task,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save task.');
      if (err instanceof ApiError && err.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  async function taskAction(action: 'delete' | 'archive' | 'complete') {
    if (!task) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'delete') await onDelete(task);
      else
        await onSave(
          action === 'archive'
            ? { title: task.title, archived: !task.archived }
            : { title: task.title, completed: !task.completed },
          task,
        );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update task.');
      if (err instanceof ApiError && err.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={task ? 'Task details' : 'A little space for your next idea'} onClose={onClose}>
      <form onSubmit={submit} className="task-form">
        <input
          className="task-title-input"
          aria-label="Task title"
          name="title"
          placeholder="What would you like to do?"
          maxLength={200}
          required
          autoFocus
          defaultValue={task?.title ?? ''}
        />
        <textarea
          aria-label="Task description"
          name="description"
          placeholder="Add a note, a thought, a little context…"
          maxLength={5000}
          rows={2}
          defaultValue={task?.description ?? ''}
        />
        <div className="form-grid">
          <label>
            <span>
              <Clock3 size={14} /> Duration
            </span>
            <select
              name="duration"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {[
                15,
                30,
                45,
                60,
                90,
                120,
                180,
                240,
                360,
                480,
                ...(task && ![15, 30, 45, 60, 90, 120, 180, 240, 360, 480].includes(task.duration)
                  ? [task.duration]
                  : []),
              ]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n < 60
                      ? `${n} minutes`
                      : `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}`}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Project</span>
            <select name="projectId" defaultValue={task?.projectId ?? editor.projectId ?? ''}>
              <option value="">Personal · No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Priority</legend>
          <div className="segmented">
            {(['LOW', 'MEDIUM', 'HIGH'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={priority === p}
                className={priority === p ? 'selected' : ''}
                onClick={() => setPriority(p)}
              >
                <span className={`priority-dot ${p.toLowerCase()}`} />
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Attention</legend>
          <div className="segmented">
            <button
              type="button"
              aria-pressed={kind === 'ACTIVE'}
              className={kind === 'ACTIVE' ? 'selected' : ''}
              onClick={() => setKind('ACTIVE')}
            >
              <Zap size={14} /> Active
            </button>
            <button
              type="button"
              aria-pressed={kind === 'PASSIVE'}
              className={kind === 'PASSIVE' ? 'selected' : ''}
              onClick={() => setKind('PASSIVE')}
            >
              <Circle size={14} /> Passive
            </button>
          </div>
          <p className="field-hint">
            {kind === 'ACTIVE'
              ? 'Needs your attention. Scheduled in its own focus time.'
              : 'Runs in the background. Can share time with an active task.'}
          </p>
        </fieldset>
        <div className="schedule-choice">
          <button
            type="button"
            aria-pressed={!scheduled}
            className={!scheduled ? 'selected' : ''}
            onClick={() => setScheduled(false)}
          >
            Keep in Inbox
          </button>
          <button
            type="button"
            aria-pressed={scheduled}
            className={scheduled ? 'selected' : ''}
            onClick={() => setScheduled(true)}
          >
            <CalendarDays size={14} /> Choose a time
          </button>
        </div>
        {scheduled && (
          <div className="schedule-fields">
            <div className="form-grid">
              <label>
                <span>Date</span>
                <input
                  type="date"
                  name="date"
                  required
                  min="2000-01-01"
                  max="2099-12-31"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                />
              </label>
              <label>
                <span>Start time</span>
                <input
                  type="time"
                  name="time"
                  required
                  step="60"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
              </label>
            </div>
            {isRepeated(scheduleDate, scheduleTime) && (
              <label>
                <span>Repeated hour</span>
                <select
                  value={occurrence}
                  onChange={(e) => setOccurrence(e.target.value as typeof occurrence)}
                >
                  <option value="reject">
                    {sameSchedule ? 'Keep saved occurrence' : 'Choose an occurrence'}
                  </option>
                  <option value="earlier">First occurrence (before clocks change)</option>
                  <option value="later">Second occurrence (after clocks change)</option>
                </select>
              </label>
            )}
            <label className="checkbox-label">
              <input type="checkbox" name="fixed" defaultChecked={task?.placement === 'FIXED'} />
              <LockKeyhole size={13} /> Fixed event <span>Reserves both attention lanes</span>
            </label>
            {overlap && (
              <p className="overlap-warning">
                This shares time with another active task or fixed event. You can keep this
                placement, or choose a different time.
              </p>
            )}
          </div>
        )}
        <label>
          <span>
            Deadline <small>optional</small>
          </span>
          <input
            type="datetime-local"
            name="deadline"
            min="2000-01-01T00:00"
            max="2099-12-31T23:59"
            value={deadlineValue}
            onChange={(e) => setDeadlineValue(e.target.value)}
          />
        </label>
        {deadlineValue && isRepeated(deadlineValue.split('T')[0], deadlineValue.split('T')[1]) && (
          <label>
            <span>Deadline repeated hour</span>
            <select
              value={dueOccurrence}
              onChange={(e) => setDueOccurrence(e.target.value as typeof dueOccurrence)}
            >
              <option value="reject">
                {sameDeadline ? 'Keep saved occurrence' : 'Choose an occurrence'}
              </option>
              <option value="earlier">First occurrence</option>
              <option value="later">Second occurrence</option>
            </select>
          </label>
        )}
        <p className="field-hint">
          All times in {user.timezone.replaceAll('_', ' ')}. Duration is elapsed time.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {conflict && task && (
          <div className="conflict-recovery">
            <p>
              Your draft is still here. Review the latest version before making another change.
              Loading it will replace this draft.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onReload(task);
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : 'Unable to load the latest version. Try again.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Review latest version
            </button>
          </div>
        )}
        <div className="dialog-footer">
          <div className="task-actions">
            {task && (
              <>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={task.completed ? 'Mark incomplete' : 'Complete task'}
                  disabled={busy}
                  onClick={() => taskAction('complete')}
                >
                  <Check size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={task.archived ? 'Restore task' : 'Archive task'}
                  disabled={busy}
                  onClick={() => taskAction('archive')}
                >
                  <Archive size={17} />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label="Delete task"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={17} />
                </button>
              </>
            )}
          </div>
          <button className="primary-button" type="submit" disabled={busy || conflict}>
            {busy ? 'Saving…' : task ? 'Save changes' : 'Create task'}
            <span aria-hidden="true">↵</span>
          </button>
        </div>
        {confirmDelete && (
          <div className="delete-confirm" role="alert">
            <p>Delete this task permanently?</p>
            <button
              type="button"
              className="quiet-button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Keep task
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() => taskAction('delete')}
            >
              Delete task
            </button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
