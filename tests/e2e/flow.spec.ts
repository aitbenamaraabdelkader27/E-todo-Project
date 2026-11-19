import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, Task } from '../../shared/types';

const uniqueTitle = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`;
test.beforeAll(async () => {
  await mkdir('artifacts', { recursive: true });
});

async function openDemo(page: Page) {
  await page.goto('/');
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/auth/demo') && response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Explore the live demo', exact: true }).click(),
  ]);
  expect(response.ok(), `Opening the demo returned HTTP ${response.status()}`).toBe(true);
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeVisible();
}

async function session(page: Page): Promise<Bootstrap> {
  const response = await page.request.get('/api/session');
  expect(response.ok()).toBe(true);
  return response.json() as Promise<Bootstrap>;
}

async function savedTask(page: Page, title: string): Promise<Task> {
  const task = (await session(page)).tasks.find((task) => task.title === title);
  expect(task, `Task “${title}” must be persisted in PostgreSQL`).toBeDefined();
  return task!;
}

async function newTask(
  page: Page,
  title: string,
  options: { time?: string; duration?: string; description?: string } = {},
) {
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'A little space for your next idea' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Task title', exact: true }).fill(title);
  if (options.description)
    await dialog.getByRole('textbox', { name: 'Task description' }).fill(options.description);
  if (options.duration)
    await dialog
      .getByRole('combobox', { name: 'Duration', exact: true })
      .selectOption(options.duration);
  if (options.time) {
    await dialog.getByRole('button', { name: 'Choose a time', exact: true }).click();
    await dialog.getByLabel('Start time', { exact: true }).fill(options.time);
  }
  await dialog.getByRole('button', { name: /^Create task/ }).click();
  await expect(dialog).not.toBeVisible();
}

async function openTask(page: Page, title: string) {
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task details' })).toBeVisible();
  return page.getByRole('dialog', { name: 'Task details' });
}

test('demo: create, automatically schedule, manually edit, complete and reload', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  const title = uniqueTitle('Write a thoughtful launch note');
  await newTask(page, title, {
    duration: '45',
    description: 'Explain the problem, the idea, and the result.',
  });
  expect((await savedTask(page, title)).scheduledAt).toBeNull();

  await page.getByRole('button', { name: 'Organize my day', exact: true }).click();
  await expect(
    page
      .locator('.time-block')
      .filter({ has: page.getByRole('button', { name: title, exact: true }) }),
  ).toBeVisible();
  const planned = await savedTask(page, title);
  expect(planned.scheduledAt).not.toBeNull();
  expect(planned.placement).toBe('AUTO');
  await expect(page.locator('.inbox-task-title').filter({ hasText: title })).toHaveCount(0);

  const dialog = await openTask(page, title);
  await dialog.getByLabel('Start time', { exact: true }).fill('10:30');
  await dialog
    .getByRole('textbox', { name: 'Task description' })
    .fill('Reviewed and ready for a first draft.');
  await dialog.getByRole('button', { name: 'High', exact: true }).click();
  await dialog.getByRole('button', { name: /^Save changes/ }).click();
  await expect(dialog).not.toBeVisible();
  const edited = await savedTask(page, title);
  expect(edited.description).toBe('Reviewed and ready for a first draft.');
  expect(edited.priority).toBe('HIGH');
  expect(edited.placement).toBe('MANUAL');
  await expect(
    page
      .locator('.time-block')
      .filter({ has: page.getByRole('button', { name: title, exact: true }) })
      .locator('.block-time'),
  ).toContainText('10:30');

  await page.getByRole('button', { name: `Complete ${title}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Reopen ${title}`, exact: true })).toBeVisible();
  expect((await savedTask(page, title)).completed).toBe(true);
  await page.screenshot({ path: 'artifacts/completed-task.png', animations: 'disabled' });
  await page.reload();
  expect((await savedTask(page, title)).completed).toBe(true);
  const reloaded = await savedTask(page, title);
  expect(reloaded.scheduledAt).toBe(edited.scheduledAt);
  expect(reloaded.description).toBe(edited.description);
});

test('timeline: keyboard and pointer move/resize persist exact times and duration', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  const title = uniqueTitle('Focused implementation');
  await newTask(page, title, { time: '09:00', duration: '60' });
  const original = await savedTask(page, title);
  const block = page
    .locator('.time-block')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  const move = page.getByRole('button', { name: `Move ${title}`, exact: true });
  await move.focus();
  await move.press('ArrowDown');
  await expect(block.locator('.block-time')).toContainText('09:15');
  expect(
    Date.parse((await savedTask(page, title)).scheduledAt!) - Date.parse(original.scheduledAt!),
  ).toBe(15 * 60_000);

  const resize = page.getByRole('button', { name: `Resize ${title}`, exact: true });
  await resize.focus();
  await resize.press('ArrowDown');
  await expect(block.locator('.block-time')).toContainText('10:30');
  expect((await savedTask(page, title)).duration).toBe(75);

  await move.scrollIntoViewIfNeeded();
  const moveBounds = await move.boundingBox();
  expect(moveBounds).not.toBeNull();
  await page.mouse.move(
    moveBounds!.x + moveBounds!.width / 2,
    moveBounds!.y + moveBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    moveBounds!.x + moveBounds!.width / 2,
    moveBounds!.y + moveBounds!.height / 2 + 81,
    { steps: 12 },
  );
  await expect(page.locator('.drag-preview')).toContainText('10:15');
  await page.mouse.up();
  await expect(block.locator('.block-time')).toContainText('10:15');
  const moved = await savedTask(page, title);
  expect(Date.parse(moved.scheduledAt!) - Date.parse(original.scheduledAt!)).toBe(75 * 60_000);

  await resize.scrollIntoViewIfNeeded();
  const resizeBounds = await resize.boundingBox();
  expect(resizeBounds).not.toBeNull();
  await page.mouse.move(
    resizeBounds!.x + resizeBounds!.width / 2,
    resizeBounds!.y + resizeBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeBounds!.x + resizeBounds!.width / 2,
    resizeBounds!.y + resizeBounds!.height / 2 + 40.5,
    { steps: 8 },
  );
  await expect(page.locator('.drag-preview')).toContainText('1h 45m');
  await page.mouse.up();
  await expect(block.locator('.block-time')).toContainText('12:00');
  expect((await savedTask(page, title)).duration).toBe(105);
});

test('real account: register, persist a task, sign out and sign in again', async ({ page }) => {
  const email = `flow-${randomUUID()}@example.test`;
  const password = 'An-example-password-28!';
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Camille Laurent');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeVisible();
  expect((await session(page)).user.isDemo).toBe(false);
  const title = uniqueTitle('A private first idea');
  await newTask(page, title);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Explore the live demo', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeVisible();
  expect((await savedTask(page, title)).title).toBe(title);
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
});

test('demo workspaces are isolated between browser sessions', async ({ page, browser }) => {
  await openDemo(page);
  const title = uniqueTitle('Only in my workspace');
  await newTask(page, title);
  const firstUser = (await session(page)).user.id;
  const secondContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    timezoneId: 'Europe/Paris',
  });
  const secondPage = await secondContext.newPage();
  try {
    await openDemo(secondPage);
    const second = await session(secondPage);
    expect(second.user.id).not.toBe(firstUser);
    expect(second.tasks.some((task) => task.title === title)).toBe(false);
    await expect(secondPage.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  } finally {
    await secondContext.close();
  }
});

test('failed task save keeps the editor open and preserves the saved task', async ({ page }) => {
  await openDemo(page);
  const title = uniqueTitle('Keep this thought safe');
  await newTask(page, title);
  const dialog = await openTask(page, title);
  await dialog
    .getByRole('textbox', { name: 'Task description' })
    .fill('Unsaved because the connection is unavailable.');
  await page.route('**/api/tasks/*', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporarily unavailable. Please try again.' }),
      });
    else await route.continue();
  });
  await dialog.getByRole('button', { name: /^Save changes/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('Temporarily unavailable');
  await expect(dialog).toBeVisible();
  expect((await savedTask(page, title)).description).toBe('');
  await page.screenshot({ path: 'artifacts/save-error.png', animations: 'disabled' });
  await page.unroute('**/api/tasks/*');
  await dialog.getByRole('button', { name: /^Save changes/ }).click();
  await expect(dialog).not.toBeVisible();
  expect((await savedTask(page, title)).description).toContain('Unsaved because');
});

test('concurrent edits: preserve a draft and recover from a stale task version', async ({
  page,
}) => {
  await openDemo(page);
  const title = uniqueTitle('Shared across my tabs');
  await newTask(page, title, { description: 'The starting version.' });
  const firstDialog = await openTask(page, title);
  await firstDialog
    .getByRole('textbox', { name: 'Task description' })
    .fill('My draft is still worth keeping.');

  const secondPage = await page.context().newPage();
  try {
    await secondPage.goto('/');
    const secondDialog = await openTask(secondPage, title);
    await secondDialog
      .getByRole('textbox', { name: 'Task description' })
      .fill('The other tab saved this first.');
    await secondDialog.getByRole('button', { name: /^Save changes/ }).click();
    await expect(secondDialog).not.toBeVisible();

    await firstDialog.getByRole('button', { name: /^Save changes/ }).click();
    await expect(
      firstDialog.getByRole('button', { name: 'Review latest version', exact: true }),
    ).toBeVisible();
    await expect(firstDialog.getByRole('button', { name: /^Save changes/ })).toBeDisabled();
    await expect(firstDialog.getByRole('textbox', { name: 'Task description' })).toHaveValue(
      'My draft is still worth keeping.',
    );
    expect((await savedTask(page, title)).description).toBe('The other tab saved this first.');
    await page.screenshot({
      path: 'artifacts/concurrent-edit-recovery.png',
      animations: 'disabled',
    });

    await firstDialog.getByRole('button', { name: 'Review latest version', exact: true }).click();
    const refreshedDialog = page.getByRole('dialog', { name: 'Task details' });
    await expect(refreshedDialog.getByRole('textbox', { name: 'Task description' })).toHaveValue(
      'The other tab saved this first.',
    );
    await expect(refreshedDialog.getByRole('button', { name: /^Save changes/ })).toBeEnabled();
    await refreshedDialog
      .getByRole('textbox', { name: 'Task description' })
      .fill('Both ideas, reconciled.');
    await refreshedDialog.getByRole('button', { name: /^Save changes/ }).click();
    await expect(refreshedDialog).not.toBeVisible();
    expect((await savedTask(page, title)).description).toBe('Both ideas, reconciled.');
  } finally {
    await secondPage.close();
  }
});

test('clock changes: recover invalid availability and explicitly select a repeated hour', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  let preferences = page.getByRole('dialog', { name: 'Make space for your day' });
  await preferences.getByLabel('Day starts', { exact: true }).fill('02:30');
  await preferences.getByLabel('Day ends', { exact: true }).fill('05:00');
  await preferences.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(preferences).not.toBeVisible();
  await page.getByLabel('Choose a date', { exact: true }).fill('2027-03-28');
  await expect(
    page.getByRole('alert').filter({ hasText: 'The clocks change on this date' }),
  ).toBeVisible();
  const before = await session(page);
  await page.getByRole('button', { name: 'Organize my day', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'unavailable or ambiguous clock time' }),
  ).toBeVisible();
  expect((await session(page)).tasks.map((t) => [t.id, t.scheduledAt])).toEqual(
    before.tasks.map((t) => [t.id, t.scheduledAt]),
  );

  await page.getByRole('button', { name: 'Adjust hours', exact: true }).click();
  preferences = page.getByRole('dialog', { name: 'Make space for your day' });
  await preferences.getByLabel('Day starts', { exact: true }).fill('03:00');
  await preferences.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(preferences).not.toBeVisible();
  await expect(
    page.getByText('The clocks change on this date.', { exact: false }),
  ).not.toBeVisible();
  const springTitle = uniqueTitle('After the clocks move forward');
  await newTask(page, springTitle, { time: '03:30', duration: '30' });
  expect((await savedTask(page, springTitle)).scheduledAt).toBe('2027-03-28T01:30:00.000Z');

  await page.getByLabel('Choose a date', { exact: true }).fill('2027-10-31');
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'A little space for your next idea' });
  const fallTitle = uniqueTitle('The second occurrence');
  await dialog.getByRole('textbox', { name: 'Task title', exact: true }).fill(fallTitle);
  await dialog.getByRole('button', { name: 'Choose a time', exact: true }).click();
  await dialog.getByLabel('Start time', { exact: true }).fill('02:30');
  await dialog.getByRole('combobox', { name: 'Repeated hour', exact: true }).selectOption('later');
  await dialog.getByRole('button', { name: /^Create task/ }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await savedTask(page, fallTitle);
  expect(saved.scheduledAt).toBe('2027-10-31T01:30:00.000Z');

  dialog = await openTask(page, fallTitle);
  await dialog
    .getByRole('textbox', { name: 'Task description' })
    .fill('Keep the same clock occurrence while editing a note.');
  await dialog.getByRole('button', { name: /^Save changes/ }).click();
  await expect(dialog).not.toBeVisible();
  expect((await savedTask(page, fallTitle)).scheduledAt).toBe(saved.scheduledAt);
});

test('rendered desktop and mobile: usable layouts, dialog keyboard and accessible placement', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let releaseSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await page.route('**/api/session', async (route) => {
    await sessionGate;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByText('Making a little room for your day…', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/loading-session.png', animations: 'disabled' });
  releaseSession();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(
    page.getByRole('button', { name: 'Explore the live demo', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/welcome-1440x900.png', animations: 'disabled' });
  await openDemo(page);
  await page.screenshot({ path: 'artifacts/desktop-1440x900.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toBeFocused();
  expect(await page.getByRole('dialog').evaluate((element) => element.matches(':modal'))).toBe(
    true,
  );
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByText('A little breathing room.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/empty-day.png', animations: 'disabled' });

  const mobileContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Europe/Paris',
    reducedMotion: 'reduce',
  });
  const mobile = await mobileContext.newPage();
  try {
    await mobile.goto('/');
    await expect(mobile.getByRole('button', { name: 'New task', exact: true })).toBeVisible();
    await mobile.screenshot({ path: 'artifacts/mobile-390x844.png', animations: 'disabled' });
    expect(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(
      await mobile.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(true);
    await mobile.getByRole('button', { name: 'Next day', exact: true }).click();
    const title = uniqueTitle('A little mobile focus');
    await newTask(mobile, title, { time: '10:00', duration: '45' });
    const first = await savedTask(mobile, title);
    expect(first.scheduledAt).not.toBeNull();
    const dialog = await openTask(mobile, title);
    await dialog.getByLabel('Start time', { exact: true }).fill('11:00');
    await dialog.getByRole('button', { name: /^Save changes/ }).click();
    await expect(dialog).not.toBeVisible();
    const edited = await savedTask(mobile, title);
    expect(Date.parse(edited.scheduledAt!) - Date.parse(first.scheduledAt!)).toBe(60 * 60_000);
    await mobile.getByRole('button', { name: `Complete ${title}`, exact: true }).click();
    await expect(
      mobile.getByRole('button', { name: `Reopen ${title}`, exact: true }),
    ).toBeVisible();
    expect((await savedTask(mobile, title)).completed).toBe(true);
  } finally {
    await mobileContext.close();
  }
});

test('timeline: auto-scroll drag follows its preview and overnight tasks retain their exact instant', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  const lateTitle = uniqueTitle('A little late-night reading');
  await newTask(page, lateTitle, { time: '23:30', duration: '90' });
  const overnight = await savedTask(page, lateTitle);
  let overnightBlock = page
    .locator('.time-block')
    .filter({ has: page.getByRole('button', { name: lateTitle, exact: true }) });
  await page.getByRole('button', { name: lateTitle, exact: true }).scrollIntoViewIfNeeded();
  const beforeMidnight = await overnightBlock.boundingBox();
  expect(beforeMidnight).not.toBeNull();
  expect(beforeMidnight!.height).toBeGreaterThan(30);
  expect(beforeMidnight!.height).toBeLessThan(45);

  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  overnightBlock = page
    .locator('.time-block')
    .filter({ has: page.getByRole('button', { name: lateTitle, exact: true }) });
  await page.getByRole('button', { name: lateTitle, exact: true }).scrollIntoViewIfNeeded();
  const afterMidnight = await overnightBlock.boundingBox();
  expect(afterMidnight).not.toBeNull();
  expect(afterMidnight!.height).toBeGreaterThan(beforeMidnight!.height * 1.8);
  expect(afterMidnight!.height).toBeLessThan(beforeMidnight!.height * 2.3);
  expect((await savedTask(page, lateTitle)).scheduledAt).toBe(overnight.scheduledAt);
  expect((await session(page)).tasks.filter((task) => task.id === overnight.id)).toHaveLength(1);
  await page.screenshot({ path: 'artifacts/overnight-continuation.png', animations: 'disabled' });

  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  const title = uniqueTitle('Follow the timeline');
  await newTask(page, title, { time: '09:00', duration: '60' });
  const original = await savedTask(page, title);
  const move = page.getByRole('button', { name: `Move ${title}`, exact: true });
  await move.scrollIntoViewIfNeeded();
  const handle = await move.boundingBox();
  const viewport = await page.locator('.timeline-scroll').boundingBox();
  expect(handle).not.toBeNull();
  expect(viewport).not.toBeNull();
  const initialScroll = await page
    .locator('.timeline-scroll')
    .evaluate((element) => element.scrollTop);
  const x = handle!.x + handle!.width / 2;
  const y = handle!.y + handle!.height / 2;
  const targetY = viewport!.y + viewport!.height - 12;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, targetY, { steps: 20 });
  for (let i = 0; i < 14; i++) await page.mouse.move(x, targetY - (i % 2));
  const finalScroll = await page
    .locator('.timeline-scroll')
    .evaluate((element) => element.scrollTop);
  expect(finalScroll).toBeGreaterThan(initialScroll + 50);
  const preview = await page.locator('.drag-preview').innerText();
  const previewTime = preview.match(/\b\d{2}:\d{2}\b/)?.[0];
  expect(previewTime).toBeDefined();
  await page.mouse.up();
  const block = page
    .locator('.time-block')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await expect(block.locator('.block-time')).toContainText(previewTime!);
  const saved = await savedTask(page, title);
  const persistedTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(saved.scheduledAt!));
  expect(persistedTime).toBe(previewTime);
  expect(Date.parse(saved.scheduledAt!)).toBeGreaterThan(Date.parse(original.scheduledAt!));
  expect(saved.duration).toBe(60);
});

test('Inbox: native drag onto the timeline saves one manual placement', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  const title = uniqueTitle('From an idea to a little focus');
  await newTask(page, title, { duration: '45' });
  const captured = await savedTask(page, title);
  expect(captured.scheduledAt).toBeNull();
  const source = page
    .locator('.inbox-task')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  const target = page.locator('.free-slot').first();
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await source.dragTo(target, { targetPosition: { x: 100, y: 50 } });
  const block = page
    .locator('.time-block')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await expect(block).toBeVisible();
  await expect(source).toHaveCount(0);
  const saved = await savedTask(page, title);
  expect(saved.id).toBe(captured.id);
  expect(saved.scheduledAt).not.toBeNull();
  expect(saved.placement).toBe('MANUAL');
  expect(saved.duration).toBe(45);
  expect((await session(page)).tasks.filter((task) => task.id === captured.id)).toHaveLength(1);
  await page.reload();
  expect((await savedTask(page, title)).scheduledAt).toBe(saved.scheduledAt);
});
