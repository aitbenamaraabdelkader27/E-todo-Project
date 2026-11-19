import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  FolderClosed,
  GripVertical,
  Inbox,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { Bootstrap, Project, Task, TaskInput } from '../shared/types';
import { addDays, formatTime, localDate, localDayBounds, todayInZone } from '../shared/time';
import { api, ApiError } from './api';
import { FlowLogo, Welcome } from './components/Welcome';
import { TaskEditor, type EditorState } from './components/TaskEditor';
import { Timeline } from './components/Timeline';
import { Dialog } from './components/Dialog';
import { Settings } from './components/Settings';

type View = 'day' | 'inbox' | 'projects' | 'completed' | 'archived';
type Toast = { message: string; error?: boolean; id: number };
const prettyDuration = (n: number) =>
  n < 60 ? `${n}m` : `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}`;
const projectColors = ['#6b8ee8', '#a58aca', '#6caa95', '#d49c6b', '#d38294', '#7b9cab'];
const weekdayFormatter = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' });
const shortDateFormatter = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function TaskRow({
  task,
  projects,
  timezone,
  onEdit,
  onComplete,
  saving,
  reason,
}: {
  task: Task;
  projects: Project[];
  timezone: string;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => void;
  saving: boolean;
  reason?: string;
}) {
  const project = projects.find((p) => p.id === task.projectId);
  const [now] = useState(() => Date.now());
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      className={`inbox-task ${task.completed ? 'completed' : ''}`}
      draggable={!task.completed && !task.archived && !saving}
      onDragStartCapture={(e) => {
        e.dataTransfer.setData('application/x-flow-task', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="inbox-task-main">
        <button
          className={`completion-check ${task.completed ? 'checked' : ''}`}
          disabled={saving}
          onClick={() => onComplete(task)}
          aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
        >
          {task.completed && <Check size={11} strokeWidth={3} />}
        </button>
        <button className="inbox-task-title" onClick={() => onEdit(task)}>
          {task.title}
        </button>
        <span className="inbox-drag" title="Drag onto the timeline">
          <GripVertical size={14} />
        </span>
      </div>
      <div className="inbox-task-meta">
        {project && (
          <span
            className="project-tag"
            style={{ '--project-color': project.color } as React.CSSProperties}
          >
            <i />
            {project.name}
          </span>
        )}
        <span>
          <Clock3 size={11} />
          {prettyDuration(task.duration)}
        </span>
        {task.kind === 'PASSIVE' && <span className="passive-label">Passive</span>}
        {task.priority === 'HIGH' && (
          <span className="high-priority">
            <ArrowUpRight size={12} />
            High
          </span>
        )}
        {task.scheduledAt && (
          <span className="scheduled-label">
            {shortDateFormatter.format(
              new Date(`${localDate(task.scheduledAt, timezone)}T12:00:00Z`),
            )}{' '}
            · {formatTime(task.scheduledAt, timezone)}
          </span>
        )}
      </div>
      {task.deadline && (
        <span
          className={`deadline-label ${Date.parse(task.deadline) < now && !task.completed ? 'overdue' : ''}`}
        >
          Due{' '}
          {shortDateFormatter.format(new Date(`${localDate(task.deadline, timezone)}T12:00:00Z`))} ·{' '}
          {formatTime(task.deadline, timezone)}
        </span>
      )}
      {reason && <p className="unscheduled-reason">{reason}</p>}
    </motion.article>
  );
}

export function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const activeUser = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [date, setDate] = useState(() =>
    todayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  const [view, setView] = useState<View>('day');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'timeline' | 'inbox'>('timeline');
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectColor, setProjectColor] = useState(projectColors[0]);
  const [projectError, setProjectError] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const pendingWrites = useRef(new Set<string>());
  const [quickBusy, setQuickBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, error, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), error ? 8000 : 4500);
  }, []);
  useEffect(() => {
    let mounted = true;
    api
      .session()
      .then((session) => {
        if (mounted) {
          activeUser.current = session.user.id;
          setData(session);
          setDate(todayInZone(session.user.timezone));
        }
      })
      .catch((err) => {
        if (mounted && (!(err instanceof ApiError) || err.status !== 401))
          setLoadError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && data) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [data]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  async function reload() {
    const userId = activeUser.current;
    const fresh = await api.session();
    if (activeUser.current === userId)
      setData((prev) => (prev?.user.id === fresh.user.id ? fresh : prev));
    return fresh;
  }
  function acceptSession(session: Bootstrap) {
    activeUser.current = session.user.id;
    setData(session);
    setDate(todayInZone(session.user.timezone));
    setLoadError('');
    setView('day');
    setSelectedProject(null);
  }
  async function handleError(error: unknown, userId = data?.user.id) {
    if (userId && userId !== activeUser.current) return;
    if (error instanceof ApiError && error.status === 401) {
      activeUser.current = null;
      setData(null);
      notify('Your session ended. Sign in to continue.', true);
    } else if (error instanceof ApiError && error.status === 409) {
      let refreshed = false;
      try {
        await reload();
        refreshed = true;
      } catch {
        /* Keep the draft and allow an explicit reload below. */
      }
      notify(
        refreshed
          ? 'This task changed in another window. Review the latest version before saving.'
          : 'This task changed in another window. The latest version could not be loaded. Use Review latest version to retry.',
        true,
      );
    } else
      notify(error instanceof Error ? error.message : 'Unable to save. Please try again.', true);
  }
  async function saveTask(input: TaskInput, task?: Task) {
    const userId = data?.user.id;
    if (task && pendingWrites.current.has(task.id))
      throw new Error('This task is being saved. Please wait a moment.');
    if (task) {
      pendingWrites.current.add(task.id);
      setSaving(new Set(pendingWrites.current));
    }
    try {
      const saved = task ? await api.updateTask(task, input) : await api.createTask(input);
      if (activeUser.current !== userId) return;
      setData((prev) =>
        prev?.user.id === userId
          ? {
              ...prev,
              tasks: task
                ? prev.tasks.map((t) => (t.id === saved.id ? saved : t))
                : [...prev.tasks, saved],
            }
          : prev,
      );
      setReasons((prev) => {
        const next = { ...prev };
        delete next[saved.id];
        return next;
      });
      if (!task) notify('A new idea, captured.');
      else if (input.completed !== undefined)
        notify(input.completed ? 'One less thing on your mind. Nicely done.' : 'Task reopened.');
      else if (input.archived !== undefined)
        notify(input.archived ? 'Task archived.' : 'Task restored.');
      else notify('Changes saved.');
    } catch (err) {
      await handleError(err, userId);
      throw err;
    } finally {
      if (task) {
        pendingWrites.current.delete(task.id);
        setSaving(new Set(pendingWrites.current));
      }
    }
  }
  async function removeTask(task: Task) {
    const userId = data?.user.id;
    try {
      await api.deleteTask(task);
      if (activeUser.current !== userId) return;
      setData((prev) =>
        prev?.user.id === userId
          ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) }
          : prev,
      );
      notify('Task deleted.');
    } catch (err) {
      await handleError(err);
      throw err;
    }
  }
  async function organize() {
    const userId = data?.user.id;
    setOrganizing(true);
    try {
      const result = await api.organize(date);
      if (activeUser.current !== userId) return;
      const nextReasons = Object.fromEntries(result.unscheduled.map((t) => [t.id, t.reason]));
      setReasons(nextReasons);
      await reload();
      if (result.scheduled.length)
        notify(
          `${result.scheduled.length} task${result.scheduled.length === 1 ? '' : 's'} found a place in your day.${result.unscheduled.length ? ` ${result.unscheduled.length} remain in Inbox.` : ' You’re all set.'}`,
        );
      else if (result.unscheduled.length) {
        notify('Some tasks need more room. See the explanations in your Inbox.');
        setMobilePanel('inbox');
      } else notify('Your day is already organized.');
    } catch (err) {
      await handleError(err);
    } finally {
      setOrganizing(false);
    }
  }
  async function quickAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    const title = String(values.get('quickTitle')).trim();
    if (!title) return;
    setQuickBusy(true);
    try {
      await saveTask({ title, ...(selectedProject ? { projectId: selectedProject } : {}) });
      form.reset();
    } catch {
      /* The shared error notification keeps the input available for retry. */
    } finally {
      setQuickBusy(false);
    }
  }
  async function signOut() {
    try {
      await api.logout();
      activeUser.current = null;
      setData(null);
      setMobileNav(false);
      setEditor(null);
      setSettingsOpen(false);
      setSearchOpen(false);
      setProjectOpen(false);
      setDeleteProject(null);
      setReasons({});
      notify('Signed out. See you soon.');
    } catch (err) {
      await handleError(err);
    }
  }
  async function createProject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('projectName')).trim();
    setProjectBusy(true);
    setProjectError('');
    try {
      const userId = activeUser.current;
      const project = await api.createProject(name, projectColor);
      if (activeUser.current !== userId) return;
      setData((prev) =>
        prev?.user.id === userId ? { ...prev, projects: [...prev.projects, project] } : prev,
      );
      setProjectOpen(false);
      setView('projects');
      setSelectedProject(project.id);
      notify('A new space for your ideas.');
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : 'Unable to create project.');
    } finally {
      setProjectBusy(false);
    }
  }
  function navigate(nextView: View, project: string | null = null) {
    setView(nextView);
    setSelectedProject(project);
    setMobileNav(false);
  }

  if (loading)
    return (
      <div className="app-loading" role="status">
        <FlowLogo />
        <LoaderCircle className="spin" size={23} />
        <span>Making a little room for your day…</span>
      </div>
    );
  if (!data)
    return (
      <>
        {loadError && (
          <div className="connection-banner" role="alert">
            {loadError}
            <button onClick={() => window.location.reload()}>Retry connection</button>
          </div>
        )}
        <Welcome onSession={acceptSession} />
        <ToastView toast={toast} close={() => setToast(null)} />
      </>
    );

  const { user, tasks, projects } = data;
  const today = todayInZone(user.timezone);
  const activeTasks = tasks.filter((t) => !t.archived);
  const inbox = activeTasks.filter((t) => !t.scheduledAt && !t.completed);
  const completed = activeTasks.filter((t) => t.completed);
  const dayBounds = localDayBounds(date, user.timezone);
  const dayTasks = activeTasks.filter(
    (t) =>
      t.scheduledAt &&
      Date.parse(t.scheduledAt) < dayBounds.end.getTime() &&
      Date.parse(t.scheduledAt) + t.duration * 60000 > dayBounds.start.getTime(),
  );
  const dayCompleted = dayTasks.filter((t) => t.completed).length;
  const focusMinutes = dayTasks
    .filter((t) => t.kind === 'ACTIVE' && !t.completed)
    .reduce(
      (total, t) =>
        total +
        Math.max(
          0,
          (Math.min(dayBounds.end.getTime(), Date.parse(t.scheduledAt!) + t.duration * 60000) -
            Math.max(dayBounds.start.getTime(), Date.parse(t.scheduledAt!))) /
            60000,
        ),
      0,
    );
  const dayTitle =
    date === today
      ? 'My Day'
      : new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }).format(
          new Date(`${date}T12:00:00Z`),
        );
  const list =
    view === 'inbox'
      ? inbox
      : view === 'completed'
        ? completed
        : view === 'archived'
          ? tasks.filter((t) => t.archived)
          : activeTasks.filter((t) => t.projectId === selectedProject);
  const searchResults = activeTasks
    .filter((t) =>
      `${t.title} ${t.description} ${projects.find((p) => p.id === t.projectId)?.name ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
    )
    .slice(0, 40);
  const currentProject = projects.find((p) => p.id === selectedProject);
  const monday = addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const completeTask = (task: Task) => {
    void saveTask({ title: task.title, completed: !task.completed }, task).catch(() => {});
  };
  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      projects={projects}
      timezone={user.timezone}
      onEdit={(task) => setEditor({ task })}
      onComplete={completeTask}
      saving={saving.has(task.id)}
      reason={reasons[task.id]}
    />
  );
  const quickForm = (
    <form className="quick-add" onSubmit={quickAdd}>
      <Plus size={16} />
      <input
        name="quickTitle"
        aria-label="Quick task title"
        placeholder="Capture a task…"
        maxLength={200}
        required
        autoComplete="off"
      />
      <button aria-label="Add quick task" disabled={quickBusy}>
        {quickBusy ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}
      </button>
    </form>
  );

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <FlowLogo />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button className="workspace-switch" onClick={() => setSettingsOpen(true)}>
          <span className="workspace-avatar">{user.name.charAt(0).toUpperCase()}</span>
          <span>
            <strong>
              {user.isDemo ? 'Your demo space' : `${user.name.split(' ')[0]}’s workspace`}
            </strong>
            <small>Personal workspace</small>
          </span>
          <Settings2 size={13} />
        </button>
        <span className="nav-section-label">WORKSPACE</span>
        <nav className="main-nav">
          <button
            className={view === 'day' ? 'active' : ''}
            aria-current={view === 'day' ? 'page' : undefined}
            onClick={() => navigate('day')}
          >
            <Sun size={18} />
            <span>My Day</span>
            <span className="nav-dot" />
          </button>
          <button
            className={view === 'inbox' ? 'active' : ''}
            aria-current={view === 'inbox' ? 'page' : undefined}
            onClick={() => navigate('inbox')}
          >
            <Inbox size={18} />
            <span>Inbox</span>
            <span className="nav-count">{inbox.length}</span>
          </button>
          <button
            className={view === 'projects' ? 'active' : ''}
            aria-current={view === 'projects' ? 'page' : undefined}
            onClick={() => navigate('projects')}
          >
            <FolderClosed size={18} />
            <span>Projects</span>
            <span className="nav-count">{projects.length}</span>
          </button>
          <button
            className={view === 'completed' ? 'active' : ''}
            aria-current={view === 'completed' ? 'page' : undefined}
            onClick={() => navigate('completed')}
          >
            <CheckCheck size={18} />
            <span>Completed</span>
          </button>
        </nav>
        <div className="nav-project-label">
          <span className="nav-section-label">YOUR PROJECTS</span>
          <button
            className="icon-button"
            aria-label="Add project"
            onClick={() => {
              setProjectOpen(true);
              setProjectError('');
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <nav className="project-nav">
          {projects.map((p) => (
            <button
              key={p.id}
              className={selectedProject === p.id ? 'selected' : ''}
              onClick={() => navigate('projects', p.id)}
            >
              <span className="project-square" style={{ backgroundColor: p.color }} />
              <span>{p.name}</span>
              <small>
                {activeTasks.filter((t) => t.projectId === p.id && !t.completed).length}
              </small>
            </button>
          ))}
          {projects.length === 0 && (
            <button className="first-project" onClick={() => setProjectOpen(true)}>
              + Your first project
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="flow-note">
            <span className="flow-note-icon">
              <Sparkles size={17} />
            </span>
            <strong>Find your daily flow.</strong>
            <p>
              A little planning.
              <br />A little more headspace.
            </p>
            <button onClick={() => setHelpOpen(true)}>
              A quick introduction
              <ArrowUpRight size={13} />
            </button>
          </div>
          <button
            className="bottom-nav-button"
            onClick={() => {
              setSettingsOpen(true);
              setMobileNav(false);
            }}
          >
            <Settings2 size={17} />
            Settings
          </button>
          <button className="bottom-nav-button" onClick={() => navigate('archived')}>
            <Archive size={17} />
            Archive
          </button>
          <div className="user-menu">
            <span className="user-avatar">{user.name.slice(0, 2).toUpperCase()}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.isDemo ? 'Private demo' : 'Your personal space'}</small>
            </span>
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={signOut}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span className="desktop-only">Workspace</span>
            <span className="breadcrumb-separator desktop-only">/</span>
            <span>
              {view === 'day'
                ? 'My Day'
                : view === 'inbox'
                  ? 'Inbox'
                  : view === 'projects'
                    ? (currentProject?.name ?? 'Projects')
                    : view === 'completed'
                      ? 'Completed'
                      : 'Archive'}
            </span>
          </div>
          <div className="topbar-actions">
            {user.isDemo && (
              <span className="demo-badge">
                <span />
                Private demo
              </span>
            )}
            <button
              className="search-trigger"
              aria-label="Search tasks"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={15} />
              <span>Search anything</span>
              <kbd>
                <Command size={10} />K
              </kbd>
            </button>
            <button
              className="icon-button help-button"
              aria-label="How Flow works"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <main className="main-content" id="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" />
                {view === 'day'
                  ? date === today
                    ? 'A FRESH PERSPECTIVE ON TODAY'
                    : 'A LITTLE ROOM TO PLAN AHEAD'
                  : view === 'inbox'
                    ? 'EVERY GOOD DAY STARTS WITH AN IDEA'
                    : view === 'projects'
                      ? 'BRING YOUR IDEAS TOGETHER'
                      : view === 'completed'
                        ? 'LOOK AT HOW FAR YOU’VE COME'
                        : 'SAVED FOR ANOTHER CHAPTER'}
              </div>
              <h1>
                {view === 'day'
                  ? dayTitle
                  : view === 'inbox'
                    ? 'The Inbox'
                    : view === 'projects'
                      ? (currentProject?.name ?? 'Your projects')
                      : view === 'completed'
                        ? 'A little progress.'
                        : 'The archive'}
              </h1>
              <p>
                {view === 'day'
                  ? 'Make time for what matters. Leave room for life.'
                  : view === 'inbox'
                    ? 'Get it out of your head. Find it a place when you’re ready.'
                    : view === 'projects'
                      ? 'A home for each part of your life.'
                      : view === 'completed'
                        ? 'Small steps add up. These are yours.'
                        : 'Out of the way. Always here when you need it.'}
              </p>
            </div>
            <button
              className="primary-button new-task-button"
              onClick={() =>
                setEditor({ ...(selectedProject ? { projectId: selectedProject } : {}) })
              }
            >
              <Plus size={17} />
              New task
            </button>
          </div>
          {view === 'day' ? (
            <>
              <section className="day-toolbar" aria-label="Date navigation">
                <div className="date-heading">
                  <CalendarDays size={17} />
                  <span>
                    {new Intl.DateTimeFormat('en', {
                      month: 'long',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }).format(new Date(`${date}T12:00:00Z`))}
                  </span>
                  <div className="date-arrows">
                    <button
                      className="icon-button"
                      aria-label="Previous day"
                      onClick={() => setDate(addDays(date, -1))}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Next day"
                      onClick={() => setDate(addDays(date, 1))}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <button className="today-button" onClick={() => setDate(today)}>
                    Today
                  </button>
                  <label className="date-picker-button" title="Choose a date">
                    <input
                      type="date"
                      aria-label="Choose a date"
                      value={date}
                      min="2000-01-01"
                      max="2100-12-31"
                      onChange={(e) => {
                        if (e.target.value) setDate(e.target.value);
                      }}
                    />
                  </label>
                </div>
                <button
                  className="organize-button"
                  disabled={organizing || saving.size > 0 || !inbox.length}
                  onClick={organize}
                >
                  {organizing ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  <span>{organizing ? 'Finding your flow…' : 'Organize my day'}</span>
                  <span className="organize-shortcut">
                    <ArrowUpRight size={14} />
                  </span>
                </button>
              </section>
              <div className="week-strip" role="group" aria-label="Days of the week">
                {week.map((d) => {
                  const count = activeTasks.filter(
                    (t) =>
                      t.scheduledAt &&
                      localDate(t.scheduledAt, user.timezone) === d &&
                      !t.completed,
                  ).length;
                  return (
                    <button
                      key={d}
                      onClick={() => setDate(d)}
                      className={`week-day ${d === date ? 'selected' : ''} ${d === today ? 'is-today' : ''}`}
                      aria-pressed={d === date}
                      aria-label={new Intl.DateTimeFormat('en', {
                        dateStyle: 'full',
                        timeZone: 'UTC',
                      }).format(new Date(`${d}T12:00:00Z`))}
                    >
                      <span>{weekdayFormatter.format(new Date(`${d}T12:00:00Z`))}</span>
                      <strong>{Number(d.slice(-2))}</strong>
                      <i className={count ? 'has-plans' : ''} />
                      {d === today && <small>Today</small>}
                    </button>
                  );
                })}
              </div>
              <div className="day-summary">
                <div>
                  <span className="summary-icon">
                    <Sun size={15} />
                  </span>
                  <span>
                    {dayTasks.length ? (
                      <>
                        <strong>{dayTasks.length} plans</strong>
                        <span className="summary-dot">·</span>
                        {prettyDuration(focusMinutes)} of focus ahead
                      </>
                    ) : (
                      <>A clear day. A fresh possibility.</>
                    )}
                  </span>
                </div>
                <div className="day-progress">
                  <span>
                    {dayCompleted} of {dayTasks.length} complete
                  </span>
                  <span className="progress-track">
                    <i
                      style={{
                        width: `${dayTasks.length ? (dayCompleted / dayTasks.length) * 100 : 0}%`,
                      }}
                    />
                  </span>
                </div>
              </div>
              <div className="mobile-panel-tabs">
                <button
                  className={mobilePanel === 'timeline' ? 'selected' : ''}
                  onClick={() => setMobilePanel('timeline')}
                >
                  <CalendarDays size={15} />
                  Timeline
                </button>
                <button
                  className={mobilePanel === 'inbox' ? 'selected' : ''}
                  onClick={() => setMobilePanel('inbox')}
                >
                  <Inbox size={15} />
                  Inbox<span>{inbox.length}</span>
                </button>
              </div>
              <div className={`day-workspace show-${mobilePanel}`} aria-busy={organizing}>
                <Timeline
                  onSettings={() => setSettingsOpen(true)}
                  tasks={tasks}
                  projects={projects}
                  user={user}
                  date={date}
                  saving={saving}
                  onEdit={(task) => setEditor({ task })}
                  onCreate={(time) => setEditor({ date, time })}
                  onUpdate={(task, input) => saveTask(input, task)}
                />
                <aside className="inbox-panel" aria-label="Unscheduled tasks">
                  <div className="panel-heading">
                    <div className="inbox-heading">
                      <Inbox size={17} />
                      <h2>Inbox</h2>
                      <span className="small-count">{inbox.length}</span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="New Inbox task"
                      onClick={() => setEditor({})}
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                  <p className="inbox-intro">A place for your not-quite-planned-yet.</p>
                  {quickForm}
                  <div className="inbox-section-title">
                    <span>READY WHEN YOU ARE</span>
                    <ArrowDown size={11} />
                  </div>
                  <div className="inbox-list">
                    <AnimatePresence initial={false}>{inbox.slice(0, 6).map(row)}</AnimatePresence>
                    {inbox.length === 0 && (
                      <div className="inbox-empty">
                        <span>
                          <CheckCheck size={23} />
                        </span>
                        <h3>All clear up here.</h3>
                        <p>
                          Your ideas have a place.
                          <br />
                          Enjoy a little headspace.
                        </p>
                      </div>
                    )}
                  </div>
                  {inbox.length > 6 && (
                    <button className="view-all-button" onClick={() => navigate('inbox')}>
                      View all {inbox.length} tasks
                      <ArrowRight size={14} />
                    </button>
                  )}
                  <div className="inbox-bottom">
                    <div className="inbox-planning-note">
                      <span>
                        <Sparkles size={17} />
                      </span>
                      <div>
                        <strong>A little help finding your rhythm.</strong>
                        <p>Flow finds time for your Inbox, around the plans you’ve already made.</p>
                      </div>
                    </div>
                    <button
                      className="inbox-organize"
                      disabled={organizing || !inbox.length || saving.size > 0}
                      onClick={organize}
                    >
                      {organizing ? 'Finding space…' : 'Let’s organize your day'}
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                </aside>
              </div>
              <div className="page-footer">
                <span>
                  <span className="soft-dot" />{' '}
                  {saving.size || organizing ? 'Saving your changes…' : 'All changes saved'}
                </span>
                <span>Small steps. A little more flow.</span>
                <span>{user.timezone.replaceAll('_', ' ')}</span>
              </div>
            </>
          ) : view === 'projects' && !selectedProject ? (
            <>
              <div className="projects-toolbar">
                <span>{projects.length} spaces for the things that matter</span>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setProjectOpen(true);
                    setProjectError('');
                  }}
                >
                  <Plus size={15} />
                  New project
                </button>
              </div>
              <div className="projects-grid">
                {projects.map((p) => {
                  const projectTasks = activeTasks.filter((t) => t.projectId === p.id);
                  const done = projectTasks.filter((t) => t.completed).length;
                  return (
                    <article
                      className="project-card"
                      key={p.id}
                      style={{ '--project-color': p.color } as React.CSSProperties}
                    >
                      <span className="project-card-icon">
                        <FolderClosed size={23} />
                      </span>
                      <button
                        className="project-card-title"
                        onClick={() => setSelectedProject(p.id)}
                      >
                        {p.name}
                        <ArrowUpRight size={18} />
                      </button>
                      <p>
                        {projectTasks.length - done} open · {done} completed
                      </p>
                      <span className="project-progress">
                        <i
                          style={{
                            width: `${projectTasks.length ? (done / projectTasks.length) * 100 : 0}%`,
                          }}
                        />
                      </span>
                      <div>
                        <span>
                          {projectTasks.length
                            ? `${Math.round((done / projectTasks.length) * 100)}% complete`
                            : 'A fresh possibility'}
                        </span>
                        <button
                          className="icon-button"
                          aria-label={`Delete project ${p.name}`}
                          onClick={() => setDeleteProject(p)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </article>
                  );
                })}
                <button
                  className="new-project-card"
                  onClick={() => {
                    setProjectOpen(true);
                    setProjectError('');
                  }}
                >
                  <Plus size={24} />
                  <strong>Room for something new.</strong>
                  <span>Create a project</span>
                </button>
              </div>
            </>
          ) : (
            <section className="list-view">
              <div className="list-toolbar">
                <span>
                  {list.length} {list.length === 1 ? 'task' : 'tasks'}
                </span>
                {view === 'projects' && currentProject && (
                  <button className="text-button" onClick={() => setSelectedProject(null)}>
                    <ArrowLeft size={14} />
                    All projects
                  </button>
                )}
              </div>
              {view === 'inbox' && quickForm}
              <div className="full-task-list">
                <AnimatePresence initial={false}>{list.map(row)}</AnimatePresence>
                {list.length === 0 && (
                  <div className="list-empty">
                    <span className="empty-orbit">
                      {view === 'completed' ? (
                        <CheckCheck size={26} />
                      ) : view === 'archived' ? (
                        <Archive size={26} />
                      ) : (
                        <Inbox size={26} />
                      )}
                    </span>
                    <h2>
                      {view === 'completed'
                        ? 'Progress begins with one task.'
                        : view === 'archived'
                          ? 'Nothing tucked away yet.'
                          : 'A little space to think.'}
                    </h2>
                    <p>
                      {view === 'archived'
                        ? 'Archived tasks will appear here. You can restore them anytime.'
                        : 'Capture an idea, give it a little time, and see where it takes you.'}
                    </p>
                    {view !== 'archived' && (
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setEditor({ ...(selectedProject ? { projectId: selectedProject } : {}) })
                        }
                      >
                        <Plus size={15} />
                        Create a task
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
      {editor && (
        <TaskEditor
          key={`${editor.task?.id ?? 'new'}-${editor.task?.version ?? 0}`}
          onReload={async (task) => {
            const fresh = await reload();
            if (activeUser.current !== user.id) return;
            const latest = fresh.tasks.find((t) => t.id === task.id);
            if (latest) setEditor({ task: latest });
            else {
              setEditor(null);
              notify('This task was removed in another window.', true);
            }
          }}
          editor={editor}
          tasks={tasks}
          projects={projects}
          user={user}
          selectedDate={date}
          onSave={saveTask}
          onDelete={removeTask}
          onClose={() => setEditor(null)}
        />
      )}
      {settingsOpen && (
        <Settings
          user={user}
          onClose={() => setSettingsOpen(false)}
          onSave={async (input) => {
            try {
              const nextUser = await api.settings(input);
              if (activeUser.current !== user.id) return;
              setData((prev) => (prev?.user.id === user.id ? { ...prev, user: nextUser } : prev));
              notify('Your rhythm, updated.');
            } catch (err) {
              await handleError(err);
              throw err;
            }
          }}
        />
      )}
      {searchOpen && (
        <Dialog
          title="Find your flow"
          onClose={() => {
            setSearchOpen(false);
            setQuery('');
          }}
          wide
        >
          <div className="search-field">
            <Search size={19} />
            <input
              aria-label="Search tasks"
              placeholder="Search tasks, notes, or projects…"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>esc</kbd>
          </div>
          <div className="search-results">
            {searchResults.length ? (
              searchResults.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSearchOpen(false);
                    setQuery('');
                    setEditor({ task: t });
                  }}
                >
                  <span className="search-result-icon">
                    {t.completed ? (
                      <Check size={17} />
                    ) : t.scheduledAt ? (
                      <CalendarDays size={17} />
                    ) : (
                      <Inbox size={17} />
                    )}
                  </span>
                  <span>
                    <strong>{t.title}</strong>
                    <small>
                      {projects.find((p) => p.id === t.projectId)?.name ?? 'Personal'} ·{' '}
                      {prettyDuration(t.duration)}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))
            ) : (
              <div className="search-empty">No tasks found. Try a different word.</div>
            )}
          </div>
          <p className="search-footnote">
            Search includes open and completed tasks. Archived tasks live in Archive.
          </p>
        </Dialog>
      )}
      {projectOpen && (
        <Dialog title="A new space for your ideas" onClose={() => setProjectOpen(false)}>
          <form className="project-form" onSubmit={createProject}>
            <label>
              <span>Project name</span>
              <input
                name="projectName"
                placeholder="A side project, a big idea…"
                required
                maxLength={80}
                autoFocus
              />
            </label>
            <fieldset>
              <legend>Make it your own</legend>
              <div className="color-picker">
                {projectColors.map((c, i) => (
                  <button
                    type="button"
                    key={c}
                    aria-label={`Color ${['blue', 'lavender', 'sage', 'amber', 'rose', 'slate'][i]}`}
                    aria-pressed={projectColor === c}
                    style={{ backgroundColor: c }}
                    onClick={() => setProjectColor(c)}
                  >
                    {projectColor === c && <Check size={16} />}
                  </button>
                ))}
              </div>
            </fieldset>
            {projectError && (
              <p className="form-error" role="alert">
                {projectError}
              </p>
            )}
            <div className="dialog-footer">
              <span />
              <button className="primary-button" disabled={projectBusy}>
                {projectBusy ? 'Creating…' : 'Create project'}
                <Plus size={15} />
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {deleteProject && (
        <Dialog title="Remove this project?" onClose={() => setDeleteProject(null)}>
          <p className="dialog-copy">
            “{deleteProject.name}” will be removed. Its tasks will stay in your workspace without a
            project.
          </p>
          {projectError && (
            <p className="form-error" role="alert">
              {projectError}
            </p>
          )}
          <div className="dialog-footer">
            <button className="secondary-button" onClick={() => setDeleteProject(null)}>
              Keep project
            </button>
            <button
              className="danger-button"
              disabled={projectBusy}
              onClick={async () => {
                setProjectBusy(true);
                setProjectError('');
                try {
                  await api.deleteProject(deleteProject.id);
                  await reload();
                  setDeleteProject(null);
                  setSelectedProject(null);
                  notify('Project removed. Your tasks are safe.');
                } catch (err) {
                  setProjectError(err instanceof Error ? err.message : 'Unable to remove project.');
                } finally {
                  setProjectBusy(false);
                }
              }}
            >
              Remove project
            </button>
          </div>
        </Dialog>
      )}
      {helpOpen && (
        <Dialog title="A little less juggling." onClose={() => setHelpOpen(false)}>
          <div className="help-content">
            <p>Flow turns a head full of tasks into a day you can see.</p>
            <div>
              <span>
                <Inbox size={20} />
              </span>
              <section>
                <h3>First, get it out of your head.</h3>
                <p>
                  Capture ideas in your Inbox. A title is all you need. Add a duration, priority, or
                  deadline when it helps.
                </p>
              </section>
            </div>
            <div>
              <span>
                <Sparkles size={20} />
              </span>
              <section>
                <h3>Then, find a little structure.</h3>
                <p>
                  Choose a date and select Organize my day. Flow finds available time for your Inbox
                  tasks, without moving any existing plans. Deadlines come first, then priority.
                </p>
              </section>
            </div>
            <div>
              <span>
                <Zap size={20} />
              </span>
              <section>
                <h3>Not everything needs your attention.</h3>
                <p>
                  Passive activities can run alongside active tasks. Fixed events reserve both
                  lanes. Manual overlaps are allowed and gently marked.
                </p>
              </section>
            </div>
            <div>
              <span>
                <CalendarDays size={20} />
              </span>
              <section>
                <h3>Your plans can change. Naturally.</h3>
                <p>
                  Drag a task by its handle or resize its bottom edge. On a keyboard, use the
                  handle’s arrow keys. On any device, open a task to choose its time and duration.
                </p>
              </section>
            </div>
            <button className="primary-button full-width" onClick={() => setHelpOpen(false)}>
              Let’s find your flow
              <ArrowRight size={16} />
            </button>
          </div>
        </Dialog>
      )}
      <ToastView toast={toast} close={() => setToast(null)} />
    </div>
  );
}

function ToastView({ toast, close }: { toast: Toast | null; close: () => void }) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="true">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`toast ${toast.error ? 'toast-error' : ''}`}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            role={toast.error ? 'alert' : 'status'}
          >
            <span className="toast-icon">
              {toast.error ? <X size={15} /> : <Check size={15} />}
            </span>
            <span>{toast.message}</span>
            <button aria-label="Dismiss notification" onClick={close}>
              <X size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
