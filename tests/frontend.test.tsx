// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MotionConfig } from 'motion/react';
import type { ComponentProps, ReactNode } from 'react';
import type { Task, User } from '../shared/types';
import { ApiError } from '../src/api';
import { TaskEditor } from '../src/components/TaskEditor';
import { Timeline } from '../src/components/Timeline';

const user: User = {
  id: 'person',
  name: 'Camille',
  email: 'camille@example.test',
  isDemo: false,
  timezone: 'Europe/Paris',
  dayStart: '08:00',
  dayEnd: '18:00',
};
const fixture = (overrides: Partial<Task> = {}): Task => ({
  id: 'task',
  title: 'Focus on the useful details',
  description: 'A saved note.',
  duration: 60,
  priority: 'MEDIUM',
  kind: 'ACTIVE',
  projectId: null,
  scheduledAt: null,
  deadline: null,
  placement: 'MANUAL',
  completed: false,
  archived: false,
  version: 2,
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
  ...overrides,
});

beforeAll(() => {
  // jsdom does not implement native modal dialogs or pointer capture. Keep their
  // DOM contract while exercising the real components and event handlers.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  HTMLElement.prototype.setPointerCapture = vi.fn();
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(children: ReactNode) {
  return render(<MotionConfig reducedMotion="always">{children}</MotionConfig>);
}
function editor(overrides: Partial<ComponentProps<typeof TaskEditor>> = {}) {
  const props: ComponentProps<typeof TaskEditor> = {
    editor: {},
    tasks: [],
    projects: [],
    user,
    selectedDate: '2027-10-31',
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    onReload: vi.fn(),
    ...overrides,
  };
  mount(<TaskEditor {...props} />);
  return props;
}
function timeline(overrides: Partial<ComponentProps<typeof Timeline>> = {}) {
  const props: ComponentProps<typeof Timeline> = {
    tasks: [],
    projects: [],
    user: { ...user, timezone: 'UTC' },
    date: '2027-05-02',
    saving: new Set(),
    onEdit: vi.fn(),
    onCreate: vi.fn(),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onSettings: vi.fn(),
    ...overrides,
  };
  const view = mount(<Timeline {...props} />);
  return { ...view, props };
}

describe('task editor: clock changes and safe recovery', () => {
  it('preserves the saved occurrence for an ambiguous start and deadline when editing a note', async () => {
    const task = fixture({
      scheduledAt: '2027-10-31T01:30:00.000Z',
      deadline: '2027-10-31T01:45:00.000Z',
    });
    const props = editor({ editor: { task }, tasks: [task] });
    expect(screen.getByLabelText('Start time')).toHaveValue('02:30');
    expect(screen.getByLabelText('Repeated hour')).toHaveValue('reject');
    fireEvent.change(screen.getByRole('textbox', { name: 'Task description' }), {
      target: { value: 'A clearer note.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'A clearer note.',
          scheduledAt: task.scheduledAt,
          deadline: task.deadline,
        }),
        task,
      ),
    );
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('requires an explicit occurrence for a new task in a repeated hour', async () => {
    const props = editor({ editor: { date: '2027-10-31', time: '02:30' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'The second 02:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose the first or second occurrence',
    );
    expect(props.onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Repeated hour'), { target: { value: 'later' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    const input = vi.mocked(props.onSave).mock.calls[0][0];
    expect(Date.parse(input.scheduledAt!)).toBe(Date.parse('2027-10-31T01:30:00Z'));
  });

  it('keeps a conflicting draft, stops repeat saves and offers an explicit latest-version review', async () => {
    const task = fixture();
    const props = editor({
      editor: { task },
      onSave: vi.fn().mockRejectedValue(new ApiError('This task changed in another window.', 409)),
    });
    const draft = 'My unsaved description deserves to stay here.';
    fireEvent.change(screen.getByRole('textbox', { name: 'Task description' }), {
      target: { value: draft },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed in another window');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled(),
    );
    expect(screen.getByRole('textbox', { name: 'Task description' })).toHaveValue(draft);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Loading it will replace this draft/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review latest version' }));
    expect(props.onReload).toHaveBeenCalledWith(task);
    expect(props.onSave).toHaveBeenCalledOnce();
  });
});

describe('timeline: actual intervals and resilient manipulation', () => {
  it('keeps a DST-gap day usable and offers Settings instead of throwing during render', () => {
    const { props, container } = timeline({
      user: { ...user, dayStart: '02:30', dayEnd: '05:00' },
      date: '2027-03-28',
    });
    expect(screen.getByRole('region', { name: 'Daily timeline' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The clocks change');
    expect(container.querySelectorAll('.hour-line')).toHaveLength(23);
    expect(container.querySelectorAll('.free-slot')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust hours' }));
    expect(props.onSettings).toHaveBeenCalledOnce();
  });

  it('reserves a passive fixed event when advertising focus time', () => {
    const fixed = fixture({
      kind: 'PASSIVE',
      placement: 'FIXED',
      scheduledAt: '2027-05-02T09:00:00Z',
    });
    const { props, container } = timeline({
      tasks: [fixed],
      user: { ...user, timezone: 'UTC', dayStart: '08:00', dayEnd: '12:00' },
    });
    const free = [...container.querySelectorAll<HTMLButtonElement>('.free-slot')];
    expect(free.map((button) => button.textContent)).toEqual([
      '1h to make your own',
      '2h to make your own',
    ]);
    fireEvent.click(free[1]);
    expect(props.onCreate).toHaveBeenCalledWith('10:00');
  });

  it('shows a persistent overlap warning even on short active tasks', () => {
    const first = fixture({ scheduledAt: '2027-05-02T09:00:00Z', duration: 15 });
    const second = fixture({
      id: 'other-task',
      title: 'Another thought',
      scheduledAt: '2027-05-02T09:05:00Z',
      duration: 15,
    });
    timeline({ tasks: [first, second] });
    expect(screen.getAllByLabelText('Overlapping active tasks')).toHaveLength(2);
  });

  it('moves a continuation from yesterday by its delta without teleporting it to midnight', async () => {
    const task = fixture({ scheduledAt: '2027-05-01T23:30:00Z', duration: 120 });
    const { props } = timeline({ tasks: [task] });
    const handle = screen.getByRole('button', { name: `Move ${task.title}` });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 120.25 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 120.25 });
    await waitFor(() =>
      expect(props.onUpdate).toHaveBeenCalledWith(
        task,
        expect.objectContaining({ scheduledAt: '2027-05-01T23:45:00.000Z' }),
      ),
    );
  });

  it('includes scroll movement in a pointer drag so the saved time remains under the pointer', async () => {
    const task = fixture({ scheduledAt: '2027-05-02T09:00:00Z', duration: 60 });
    const { props, container } = timeline({ tasks: [task] });
    const scroll = container.querySelector<HTMLDivElement>('.timeline-scroll')!;
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 1000,
      left: 0,
      right: 600,
      width: 600,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const handle = screen.getByRole('button', { name: `Move ${task.title}` });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 300 });
    scroll.scrollTop += 81; // An hour of elapsed timeline scroll at 1.35px/min.
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 320.25 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 320.25 });
    await waitFor(() =>
      expect(props.onUpdate).toHaveBeenCalledWith(
        task,
        expect.objectContaining({ scheduledAt: '2027-05-02T10:15:00.000Z' }),
      ),
    );
  });
});
