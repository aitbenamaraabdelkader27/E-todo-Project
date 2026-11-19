export type TaskKind = 'ACTIVE' | 'PASSIVE';
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type Placement = 'MANUAL' | 'AUTO' | 'FIXED';

export interface Project {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  duration: number;
  priority: Priority;
  kind: TaskKind;
  projectId: string | null;
  scheduledAt: string | null;
  deadline: string | null;
  placement: Placement;
  completed: boolean;
  archived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string | null;
  isDemo: boolean;
  timezone: string;
  dayStart: string;
  dayEnd: string;
}

export interface Bootstrap {
  user: User;
  tasks: Task[];
  projects: Project[];
  csrfToken: string;
}

export interface TaskInput {
  title: string;
  description?: string;
  duration?: number;
  priority?: Priority;
  kind?: TaskKind;
  projectId?: string | null;
  scheduledAt?: string | null;
  deadline?: string | null;
  placement?: Placement;
  completed?: boolean;
  archived?: boolean;
}

export interface ScheduleResult {
  scheduled: { id: string; scheduledAt: string }[];
  unscheduled: { id: string; reason: string }[];
}
