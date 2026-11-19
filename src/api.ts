import type { Bootstrap, Project, ScheduleResult, Task, TaskInput, User } from '../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

let csrfToken = '';
let authEpoch = 0;
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'E-Todo-Flow',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('Unable to connect. Check your connection and try again.', 0);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(
      typeof error.error === 'string'
        ? error.error
        : typeof error.message === 'string'
          ? error.message
          : 'Something went wrong. Please try again.',
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function sessionRequest(path: string, method?: string, body?: unknown) {
  const epoch = method === 'POST' ? ++authEpoch : authEpoch;
  const data = await request<Bootstrap>(path, method, body);
  if (epoch === authEpoch) csrfToken = data.csrfToken;
  return data;
}

export const api = {
  session: () => sessionRequest('/session'),
  demo: (timezone: string) => sessionRequest('/auth/demo', 'POST', { timezone }),
  register: (name: string, email: string, password: string, timezone: string) =>
    sessionRequest('/auth/register', 'POST', { name, email, password, timezone }),
  login: (email: string, password: string) =>
    sessionRequest('/auth/login', 'POST', { email, password }),
  logout: async () => {
    const epoch = ++authEpoch;
    await request<void>('/auth/logout', 'POST');
    if (epoch === authEpoch) csrfToken = '';
  },
  createTask: (input: TaskInput) => request<Task>('/tasks', 'POST', input),
  updateTask: (task: Task, input: TaskInput) =>
    request<Task>(`/tasks/${task.id}`, 'PATCH', { ...input, version: task.version }),
  deleteTask: (task: Task) =>
    request<void>(`/tasks/${task.id}`, 'DELETE', { version: task.version }),
  organize: (date: string) => request<ScheduleResult>('/organize', 'POST', { date }),
  settings: (input: Partial<Pick<User, 'name' | 'timezone' | 'dayStart' | 'dayEnd'>>) =>
    request<User>('/settings', 'PATCH', input),
  createProject: (name: string, color: string) =>
    request<Project>('/projects', 'POST', { name, color }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, 'DELETE'),
};
