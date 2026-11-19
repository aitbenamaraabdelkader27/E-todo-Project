import type { Task as DatabaseTask, User as DatabaseUser } from '@prisma/client';
import type { Task, User } from '../shared/types.js';

export function serializeTask(task: DatabaseTask): Task {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    duration: task.duration,
    priority: task.priority,
    kind: task.kind,
    projectId: task.projectId,
    scheduledAt: task.scheduledAt?.toISOString() ?? null,
    deadline: task.deadline?.toISOString() ?? null,
    placement: task.placement,
    completed: task.completed,
    archived: task.archived,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function serializeUser(user: DatabaseUser): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isDemo: user.isDemo,
    timezone: user.timezone,
    dayStart: user.dayStart,
    dayEnd: user.dayEnd,
  };
}
