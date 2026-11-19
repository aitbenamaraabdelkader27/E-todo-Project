import type { Prisma } from '@prisma/client';
import { localToInstant, todayInZone } from '../shared/time.js';

export async function createDemoUser(tx: Prisma.TransactionClient, timezone: string) {
  const user = await tx.user.create({
    data: {
      name: 'Alex Morgan',
      isDemo: true,
      timezone,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const work = await tx.project.create({
    data: { userId: user.id, name: 'Studio', color: '#6284d6' },
  });
  const learning = await tx.project.create({
    data: { userId: user.id, name: 'Learning', color: '#a580ca' },
  });
  const life = await tx.project.create({
    data: { userId: user.id, name: 'Personal', color: '#72a78b' },
  });
  const today = todayInZone(timezone);
  const at = (clock: string) => new Date(localToInstant(today, clock, timezone));
  await tx.task.createMany({
    data: [
      {
        userId: user.id,
        title: 'A little space to think',
        description: 'Coffee, a notebook, and the three things that matter today.',
        duration: 30,
        projectId: life.id,
        scheduledAt: at('08:30'),
        completed: true,
        priority: 'LOW',
      },
      {
        userId: user.id,
        title: 'Shape the new portfolio',
        description: 'Focus on the project story, the opening screen, and one memorable detail.',
        duration: 90,
        projectId: work.id,
        scheduledAt: at('09:15'),
        priority: 'HIGH',
      },
      {
        userId: user.id,
        title: 'Back up project files',
        description: 'A passive activity: the backup runs while you focus on something else.',
        duration: 60,
        kind: 'PASSIVE',
        projectId: work.id,
        scheduledAt: at('09:45'),
        priority: 'LOW',
      },
      {
        userId: user.id,
        title: 'Design catch-up',
        description: 'A fixed commitment. Automatic planning will always work around it.',
        duration: 45,
        projectId: work.id,
        scheduledAt: at('11:00'),
        placement: 'FIXED',
      },
      {
        userId: user.id,
        title: 'Lunch & a walk',
        description: 'Step away from the screen and get some fresh air.',
        duration: 60,
        projectId: life.id,
        scheduledAt: at('12:30'),
        placement: 'FIXED',
        priority: 'LOW',
      },
      {
        userId: user.id,
        title: 'Explore a new idea',
        description: 'Read the first chapter and capture a few useful notes.',
        duration: 60,
        projectId: learning.id,
        scheduledAt: at('14:00'),
      },
      {
        userId: user.id,
        title: 'Review project notes',
        description:
          'A manual overlap to try: move this block or edit its time if you prefer more space.',
        duration: 30,
        projectId: work.id,
        scheduledAt: at('14:30'),
        priority: 'LOW',
      },
      {
        userId: user.id,
        title: 'Polish the case study',
        description: 'A clear beginning, a useful process, and a result worth sharing.',
        duration: 45,
        projectId: work.id,
        priority: 'HIGH',
      },
      {
        userId: user.id,
        title: 'Read 20 pages',
        description: 'Make a little room for curiosity.',
        duration: 30,
        projectId: learning.id,
        priority: 'LOW',
      },
      {
        userId: user.id,
        title: 'Plan the weekend',
        description: 'Find a new place for a long walk.',
        duration: 20,
        projectId: life.id,
      },
      {
        userId: user.id,
        title: 'Download reference library',
        description: 'Let this run in the background alongside your active work.',
        duration: 40,
        kind: 'PASSIVE',
        projectId: learning.id,
        priority: 'LOW',
      },
    ],
  });
  return user;
}
