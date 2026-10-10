import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, expect as ui, type Browser, type BrowserContext, type Page, type Response } from '@playwright/test';
import { boundaries, resetBoundaries } from './boundaries';
import { createWorkflowFixture, type Actor, type WorkflowFixture } from './fixture';
import { browserTransport } from './browser-transport';

describe.skipIf(process.env.WORKFLOW_DB_TESTS !== 'true' || process.env.WORKFLOW_BROWSER_TESTS !== 'true')('roadmap28 real React + authenticated API journeys', () => {
  let f: WorkflowFixture, front: Awaited<ReturnType<typeof browserTransport>>, browser: Browser;
  let a: Actor, context: BrowserContext, page: Page;
  let errors: string[], mutations: string[];
  beforeAll(async () => {
    // Separate gate also protects direct Vitest invocation, before any DB imports.
    const target = new URL(process.env.TEST_DATABASE_URL!);
    if (target.hostname !== '127.0.0.1' || target.port !== '60053' || target.pathname !== '/thesocialpundit_acceptance_test') throw new Error('Retained isolated target required');
    front = await browserTransport();
    process.env.BETTER_AUTH_URL = front.origin; process.env.APP_URL = front.origin;
    f = await createWorkflowFixture();
    // Real route modules required by the original dashboard and readiness UI.
    (await import('../../server/routes/integrations')).registerIntegrationsRoutes(f.app);
    (await import('../../server/routes/analytics')).registerAnalyticsRoutes(f.app);
    (await import('../../server/routes/billing')).registerBillingRoutes(f.app);
    front.connect(f.origin);
    browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  });
  beforeEach(async () => {
    a = await f.actor(); errors = []; mutations = [];
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== front.origin) { errors.push(`Blocked browser request: ${url.origin}`); await route.abort(); return; }
      // No fulfill, fetch override, auth hook replacement, or query-cache injection.
      await route.continue();
    });
    await context.routeWebSocket('**/*', socket => { errors.push('Blocked websocket'); socket.close(); });
    const equals = a.cookie.indexOf('=');
    await context.addCookies([{ name: a.cookie.slice(0, equals), value: a.cookie.slice(equals + 1), url: front.origin, httpOnly: true, sameSite: 'Lax' }]);
    page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/') && req.method() !== 'GET') mutations.push(`${req.method()} ${new URL(req.url()).pathname}`); });
  });
  afterEach(async test => {
    if (test.task.result?.state === 'fail' && page && !page.isClosed()) {
      console.error('Browser failure state', { alerts: await page.getByRole('alert').allTextContents(), mutations, aiCalls: boundaries.ai.mock.calls.length });
    }
    await context?.close();
    await f?.control.pause();
    await f?.cleanupActors();
    expect(errors).toEqual([]); expect(f?.blocked).toEqual([]); expect(front?.errors).toEqual([]);
  });
  afterAll(async () => {
    try { await browser?.close(); } finally { try { await front?.close(); } finally { await f?.close(); } }
  });

  function response(path: string, method = 'POST') {
    return page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method);
  }
  async function body(res: Response, status = 200) { expect(res.status(), await res.text()).toBe(status); return res.json(); }
  async function onboard() {
    await page.goto(`${front.origin}/dashboard`);
    await ui(page.getByTestId('text-registration-title')).toBeVisible();
    await page.getByTestId('select-industries').click();
    await page.getByTestId('option-industries-technology_saas').click(); await page.keyboard.press('Escape');
    await page.getByTestId('select-countries').click();
    await page.getByTestId('option-countries-india').click(); await page.keyboard.press('Escape');
    const registered = response('/api/complete-registration');
    await page.getByTestId('button-complete-registration').click(); await body(await registered);
    await page.getByLabel('Professional focus').fill('I study engineering latency in controlled pilot trials.');
    const suggested = response('/api/ai/analyze-identity');
    await page.getByRole('button', { name: 'Suggest preferences with AI' }).click(); await body(await suggested);
    await ui(page.getByTestId('section-sources')).toBeVisible();
    await page.getByTestId('button-continue').click();
    await ui(page.getByTestId(`badge-keyword-${a.keyword}`)).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('button-continue').click();
    const completed = response('/api/profile/complete-onboarding');
    await page.getByTestId('button-complete-onboarding').click();
    const profile = await body(await completed);
    expect(profile).toMatchObject({ userId: a.userId, tenantId: a.tenantId, onboardingStatus: 'completed' });
    await ui(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    // Fixture-only entitlement/connection setup, not a payment/OAuth acceptance claim.
    await f.paid(a);
    await f.http(a).patch('/api/profile').send({ enabledPlatforms: ['mastodon'], defaultPlatform: 'mastodon', requirePublishReview: true, timezone: 'UTC' }).expect(200);
    await page.getByRole('link', { name: 'Discover', exact: true }).click();
    await page.reload(); // Load actual persisted preferences; no cache manipulation.
    await ui(page.getByTestId('button-refresh-inbox')).toBeVisible();
    const refreshed = response('/api/inbox/refresh');
    await page.getByTestId('button-refresh-inbox').click(); await body(await refreshed);
    await vi.waitFor(async () => expect((await f.http(a).get('/api/inbox').expect(200)).body).toHaveLength(1), { timeout: 10000 });
    const item = (await f.http(a).get('/api/inbox').expect(200)).body[0];
    expect(item.articleUrl).toBe(a.articleUrl);
    await ui(page.getByTestId(`button-generate-${item.id}`)).toBeVisible();
    await page.getByTestId(`button-generate-${item.id}`).click();
    await ui(page.getByLabel('Story', { exact: true })).toHaveValue(item.id);
    await ui(page.getByLabel('Platform', { exact: true })).toHaveValue('mastodon');
    return item;
  }
  async function generate() {
    const admitted = response('/api/instant-review/selected');
    await page.getByTestId('button-regenerate').click();
    const res = await admitted;
    return { ...await body(res, 202), input: res.request().postDataJSON() };
  }
  async function save() {
    await ui(page.getByTestId('textarea-post-content')).toHaveValue(/12%/);
    const saved = response('/api/drafts'); await page.getByTestId('button-save-draft').click();
    const draft = await body(await saved);
    await ui(page.getByTestId('button-save-draft')).toHaveText('Saved');
    // Other unsaved tone versions intentionally cause the real close confirmation.
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('link', { name: 'Go to Content', exact: true }).click();
    await ui(page.getByTestId(`card-draft-${draft.id}`)).toBeVisible();
    return draft;
  }
  async function approveSchedule(draft: { id: string; content: string; updatedAt: string }) {
    await ui(page.getByTestId(`button-schedule-${draft.id}`)).toBeDisabled();
    await page.getByTestId(`button-post-${draft.id}`).click();
    const approved = response(`/api/drafts/${draft.id}/approve-publishing`);
    await page.getByRole('button', { name: 'I reviewed this exact draft — approve publishing' }).click();
    const res = await approved; expect(res.request().postDataJSON()).toEqual({ content: draft.content, updatedAt: draft.updatedAt }); await body(res);
    await page.getByTestId('button-cancel-post').click();
    await page.getByTestId(`button-schedule-${draft.id}`).click();
    await page.getByLabel('Publication Date', { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    await page.getByLabel('Publication Time (UTC)', { exact: true }).fill('12:00');
    const scheduled = response(`/api/drafts/${draft.id}/schedule`);
    await page.getByRole('button', { name: 'Schedule Article', exact: true }).click();
    const schedule = await body(await scheduled);
    await page.getByTestId('tab-scheduled').click();
    await ui(page.getByTestId(`card-draft-${draft.id}`)).toContainText('Scheduled for');
    return schedule;
  }
  function delivery(draftId: string, schedule: any): Parameters<WorkflowFixture['handlePublishDraft']>[0] {
    return { id: randomUUID(), data: { tenantId: a.tenantId, userId: a.userId, draftId, draftScheduleId: schedule.id,
      draftScheduleTargetId: schedule.targets[0].id, platform: 'mastodon', publishAt: schedule.scheduledPublishAt, attemptNumber: 1 },
      attemptsMade: 0, opts: { attempts: 1 }, progress: async () => undefined, discard: () => undefined } as unknown as Parameters<WorkflowFixture['handlePublishDraft']>[0];
  }
  async function ledger() { return (await f.owner.query('select operation_id, status from billing_generation_operations where tenant_id=$1', [a.tenantId])).rows; }
  async function makeDue(draftId: string, schedule: any) {
    // Fixture clock setup only: preserve schedule/target IDs and all policy state.
    const due = new Date(Date.now() - 1000).toISOString();
    const moved = await f.owner.query('update draft_schedules set scheduled_publish_at=$1 where id=$2 and tenant_id=$3 and draft_id=$4 and status=$5',
      [due, schedule.id, a.tenantId, draftId, 'scheduled']);
    expect(moved.rowCount).toBe(1); schedule.scheduledPublishAt = due;
  }

  it('original onboarding → Discover → async generation → save → review → schedule → sandbox receipt survives reload', async () => {
    const item = await onboard(); await f.control.resume();
    const job = await generate(); const draft = await save();
    expect(draft).toMatchObject({ inboxItemId: item.id, userId: a.userId, tenantId: a.tenantId });
    const schedule = await approveSchedule(draft);
    const calls = boundaries.ai.mock.calls.length;
    expect(calls).toBe(4); expect(await ledger()).toHaveLength(1);
    const operation = (await f.http(a).get(`/api/generation/operations/${job.input.requestIntent}`).expect(200)).body;
    expect(operation).toMatchObject({ status: 'succeeded', consumed: true });
    // Verify the real not-due guard, then move ONLY this owned schedule's clock.
    expect((await f.handlePublishDraft(delivery(draft.id, schedule))).status).toBe('skipped');
    await makeDue(draft.id, schedule);
    // Deliberate fixture delivery, not a scheduler/clock or Bull publish transport claim.
    expect(await f.handlePublishDraft(delivery(draft.id, schedule))).toEqual({ platform: 'mastodon', status: 'simulated' });
    expect((await f.handlePublishDraft(delivery(draft.id, schedule))).status).toBe('skipped');
    await page.reload(); await page.getByTestId('tab-attention').click();
    const card = page.getByTestId(`card-draft-${draft.id}`);
    await ui(card).toContainText(/simulat/i);
    await ui(page.getByTestId('tab-published')).toHaveText('0 Published');
    const state = (await f.http(a).get(`/api/drafts/${draft.id}/publish-status`).expect(200)).body;
    expect(state.schedule).toMatchObject({ id: schedule.id, status: 'simulated', targets: [expect.objectContaining({ id: schedule.targets[0].id, status: 'simulated', executionMode: 'sandbox', providerPostId: null, receiptKind: 'none' })] });
    const logs = (await f.http(a).get(`/api/drafts/${draft.id}/publish-logs`).expect(200)).body;
    expect(logs.filter((l: any) => l.status === 'simulated')).toHaveLength(1);
    expect((await f.http(a).get('/api/drafts/published').expect(200)).body).toEqual([]);
    expect(await ledger()).toHaveLength(1); expect(boundaries.ai).toHaveBeenCalledTimes(calls); expect(boundaries.publisher).not.toHaveBeenCalled();
    expect(mutations.filter(s => s === 'POST /api/instant-review/selected')).toHaveLength(1);
    expect(mutations.filter(s => s === 'POST /api/drafts')).toHaveLength(1);
  });

  it('failed generation, active cancellation, saved-content reload and schedule cancellation never replay spend or send', async () => {
    const item = await onboard(); await f.control.resume();
    const { AIGenerationError } = await import('../../server/services/openRouter');
    boundaries.ai.mockRejectedValue(new AIGenerationError('ai_unavailable'));
    const failed = await generate();
    await ui(page.getByRole('alert')).toContainText(/unavailable|failed/i);
    await ui(page.getByTestId('textarea-post-content')).toHaveCount(0);
    const failedCalls = boundaries.ai.mock.calls.length;
    expect(failedCalls).toBeGreaterThan(0);
    // Retry same terminal job reads its failure; it must not admit a new operation.
    const retried = response(`/api/editorial/jobs/${failed.jobId}`, 'GET');
    await page.getByRole('button', { name: 'Retry same request' }).click();
    expect((await body(await retried)).status).toBe('failed');
    await ui(page.getByRole('alert')).toContainText(/unavailable|failed/i);
    expect(boundaries.ai).toHaveBeenCalledTimes(failedCalls); expect(await ledger()).toHaveLength(1);
    expect((await f.http(a).get(`/api/generation/operations/${failed.input.requestIntent}`).expect(200)).body).toMatchObject({ status: 'failed', consumed: true });
    await page.reload();
    await ui(page.getByTestId(`button-generate-${item.id}`)).toBeVisible();
    expect(boundaries.ai).toHaveBeenCalledTimes(failedCalls); expect(await ledger()).toHaveLength(1);
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toEqual([]);
    await page.getByTestId(`button-generate-${item.id}`).click();
    boundaries.ai.mockImplementation((_prompt, options) => new Promise((_ok, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    const active = await generate();
    await vi.waitFor(async () => expect((await f.http(a).get(`/api/generation/operations/${active.input.requestIntent}`).expect(200)).body.status).toBe('started'));
    await vi.waitFor(() => expect(boundaries.ai.mock.calls.length).toBeGreaterThan(failedCalls));
    const cancelled = response(`/api/editorial/jobs/${active.jobId}`, 'DELETE');
    await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
    // Cancellation aborts the client transport: Chromium may discard its body.
    expect((await cancelled).status()).toBe(200);
    expect((await f.http(a).get(`/api/editorial/jobs/${active.jobId}`).expect(200)).body.status).toBe('cancelled');
    await ui(page.getByRole('alert')).toContainText(/cancelled/i);
    await vi.waitFor(async () => expect((await f.http(a).get(`/api/generation/operations/${active.input.requestIntent}`).expect(200)).body.status).toBe('cancelled'));
    const cancelledCalls = boundaries.ai.mock.calls.length;
    await page.reload();
    await ui(page.getByTestId(`button-generate-${item.id}`)).toBeVisible();
    expect(boundaries.ai).toHaveBeenCalledTimes(cancelledCalls); expect(await ledger()).toHaveLength(2);
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toEqual([]);
    await f.http(a).get(`/api/editorial/jobs/${active.jobId}/result`).expect(409);
    resetBoundaries(a.keyword, a.articleUrl);
    await page.getByTestId(`button-generate-${item.id}`).click();
    await generate(); const draft = await save(); const schedule = await approveSchedule(draft);
    await makeDue(draft.id, schedule);
    await page.getByTestId(`button-menu-${draft.id}`).click();
    const unscheduled = response(`/api/drafts/${draft.id}/schedule`, 'DELETE');
    await page.getByTestId(`button-cancel-schedule-${draft.id}`).click(); await body(await unscheduled);
    expect((await f.handlePublishDraft(delivery(draft.id, schedule))).status).toBe('skipped');
    await page.reload(); await page.getByTestId('tab-ready').click();
    await ui(page.getByTestId(`card-draft-${draft.id}`)).toContainText(draft.content);
    expect(await ledger()).toHaveLength(3); expect(boundaries.ai).toHaveBeenCalledTimes(4);
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toHaveLength(1);
    expect((await f.http(a).get(`/api/drafts/${draft.id}/publish-logs`).expect(200)).body).toEqual([]);
    expect(boundaries.publisher).not.toHaveBeenCalled();
    expect(mutations.filter(s => s === 'POST /api/instant-review/selected')).toHaveLength(3);
    expect(mutations.filter(s => s === 'POST /api/drafts')).toHaveLength(1);
  });
});