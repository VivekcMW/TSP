import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, expect as ui, type Browser, type BrowserContext, type Page, type Request as BrowserRequest } from '@playwright/test';
import { boundaries, prose } from './workflow/boundaries';
import { createWorkflowFixture, type Actor, type WorkflowFixture } from './workflow/fixture';
import { browserTransport } from './workflow/browser-transport';
import { EDITORIAL_RECOVERY_KEY } from '../client/src/lib/editorial-recovery';

// Own file/runner; shared workflow fixtures and concurrent crash suites are untouched.
describe.skipIf(process.env.WORKFLOW_DB_TESTS !== 'true' || process.env.EDITORIAL_RELOAD_BROWSER_TESTS !== 'true')('unfinished editorial reload (real App/API/Redis/ledger)', () => {
  let f: WorkflowFixture, front: Awaited<ReturnType<typeof browserTransport>>, browser: Browser;
  let a: Actor, context: BrowserContext, page: Page;
  let errors: string[], requests: { method: string; path: string }[];
  beforeAll(async () => {
    const target = new URL(process.env.TEST_DATABASE_URL!);
    if (target.hostname !== '127.0.0.1' || target.port !== '60053' || target.pathname !== '/thesocialpundit_acceptance_test') throw new Error('Only the retained isolated cluster is authorized');
    front = await browserTransport();
    process.env.BETTER_AUTH_URL = front.origin; process.env.APP_URL = front.origin;
    f = await createWorkflowFixture();
    (await import('../server/routes/integrations')).registerIntegrationsRoutes(f.app);
    (await import('../server/routes/analytics')).registerAnalyticsRoutes(f.app);
    front.connect(f.origin);
    browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  });
  beforeEach(async () => {
    a = await actor(); errors = []; requests = [];
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== front.origin) { errors.push('External browser request'); await route.abort(); return; }
      await route.continue(); // Never fulfill/fake any API response.
    });
    await context.routeWebSocket('**/*', socket => { errors.push('External websocket'); socket.close(); });
    await login(a);
    page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { const path = new URL(req.url()).pathname; if (path.startsWith('/api/')) requests.push({ method: req.method(), path }); });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`${front.origin}/dashboard/discover`);
    await page.getByTestId('button-global-create').click();
    await ui(page.getByLabel('Platform', { exact: true })).toHaveValue('mastodon');
    await page.getByLabel('Source type').selectOption('manual');
    await page.getByTestId('input-manual-article-title').fill('Private recovery pilot');
    await page.getByTestId('editor-manual-article').fill(prose);
  });
  afterEach(async test => {
    if (test.task.result?.state === 'fail' && page && !page.isClosed()) console.error('Reload failure', { alerts: await page.getByRole('alert').allTextContents(), requests, aiCalls: boundaries.ai.mock.calls.length });
    if (page && !page.isClosed()) await page.waitForLoadState('networkidle');
    await context?.close();
    // Cancel only this fixture's actors, allowing held external mocks to settle.
    if (f) {
      for (const job of await f.control.getJobs(['active', 'waiting', 'paused'])) await f.editorial.getEditorialJobs()!.cancel(a, job.data.id);
      await f.control.pause();
      await f.cleanupActors();
    }
    expect(errors).toEqual([]); expect(f?.blocked).toEqual([]); expect(front?.errors).toEqual([]);
  });
  afterAll(async () => {
    try { await browser?.close(); } finally { try { await front?.close(); } finally { await f?.close(); } }
  });

  async function actor() {
    const value = await f.actor(); const api = f.http(value);
    await api.post('/api/complete-registration').send({ firstName: 'Reload', lastName: 'Person', countries: ['India'], industries: ['Technology & SaaS'] }).expect(200);
    await api.post('/api/profile/complete-onboarding').send({ focusDescription: 'I study engineering latency in controlled pilot trials.', recommendedIndustry: 'technology_saas', keywords: [], publications: [] }).expect(200);
    await api.patch('/api/profile').send({ enabledPlatforms: ['mastodon'], defaultPlatform: 'mastodon' }).expect(200);
    await f.paid(value);
    return value;
  }
  async function login(value: Actor) {
    await context.clearCookies();
    const equals = value.cookie.indexOf('=');
    await context.addCookies([{ name: value.cookie.slice(0, equals), value: value.cookie.slice(equals + 1), url: front.origin, httpOnly: true, sameSite: 'Lax' }]);
  }
  async function pointer() { return page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null'), EDITORIAL_RECOVERY_KEY); }
  async function ledger() { return (await f.owner.query('select operation_id, status from billing_generation_operations where tenant_id=$1 and user_id=$2', [a.tenantId, a.userId])).rows; }
  async function generate() {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/instant-review/manual' && r.request().method() === 'POST');
    await page.getByTestId('button-regenerate').click();
    const res = await response; expect(res.status(), await res.text()).toBe(202);
    const job = { jobId: (await res.json()).jobId as string, requestIntent: res.request().postDataJSON().requestIntent as string };
    await ui.poll(pointer).toEqual({ tenantId: a.tenantId, userId: a.userId, jobId: job.jobId, requestIntent: job.requestIntent });
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(prose);
    return job;
  }
  async function reload(jobId: string) {
    let navigated = false;
    const newDocumentRequests = new Set<BrowserRequest>();
    const navigation = () => { navigated = true; };
    const requested = (req: BrowserRequest) => { if (navigated) newDocumentRequests.add(req); };
    page.once('framenavigated', navigation); page.on('request', requested);
    try {
      const response = page.waitForResponse(r => newDocumentRequests.has(r.request()) && new URL(r.url()).pathname === `/api/editorial/jobs/${jobId}` && r.request().method() === 'GET');
      const [, res] = await Promise.all([page.reload(), response]);
      await ui(page.getByRole('dialog', { name: 'Create draft', exact: true })).toBeVisible();
      return res;
    } finally { page.off('framenavigated', navigation); page.off('request', requested); }
  }
  function noReplay() {
    expect(requests.filter(r => r.method === 'POST' && r.path.includes('instant-review'))).toHaveLength(1);
    expect(requests.filter(r => r.method === 'POST' && /editorial\/jobs|generation\/operations/.test(r.path))).toHaveLength(0);
  }
  function holdProvider() {
    const answer = boundaries.ai.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    boundaries.ai.mockImplementation(async (prompt, options) => {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(options.signal.reason);
        options.signal.addEventListener('abort', abort, { once: true });
        if (options.signal.aborted) abort();
        void gate.then(() => { options.signal.removeEventListener('abort', abort); resolve(); });
      });
      return answer(prompt, options);
    });
    return release;
  }

  it('reloads a queued job, restores its server result, and explicitly saves without readmission', async () => {
    const job = await generate(); expect(await ledger()).toEqual([]);
    expect((await (await reload(job.jobId)).json()).status).toBe('queued');
    await ui(page.getByTestId('input-instant-review-url')).toHaveValue(''); // no source persisted
    expect(await pointer()).toMatchObject(job); expect(boundaries.ai).not.toHaveBeenCalled();
    await f.control.resume();
    await ui(page.getByTestId('textarea-post-content')).toHaveValue(/12%/);
    expect(await ledger()).toEqual([{ operation_id: job.requestIntent, status: 'succeeded' }]);
    expect(await pointer()).toBeNull(); expect(boundaries.ai).toHaveBeenCalledTimes(4); noReplay();
    expect(requests.filter(r => r.method === 'DELETE')).toEqual([]);
    const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/drafts' && r.request().method() === 'POST');
    await page.getByTestId('button-save-draft').click(); expect((await saved).status()).toBe(200);
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toHaveLength(1);
    expect(await ledger()).toHaveLength(1);
  });

  it('reattaches after durable reservation and finishes the same active job once', async () => {
    const release = holdProvider(); await f.control.resume();
    const job = await generate();
    await vi.waitFor(async () => expect(await ledger()).toEqual([{ operation_id: job.requestIntent, status: 'started' }]));
    expect((await (await reload(job.jobId)).json()).status).toBe('active');
    release();
    await ui(page.getByTestId('textarea-post-content')).toHaveValue(/12%/);
    expect(await ledger()).toEqual([{ operation_id: job.requestIntent, status: 'succeeded' }]);
    expect(boundaries.ai).toHaveBeenCalledTimes(4); expect(await pointer()).toBeNull(); noReplay();
    expect(requests.filter(r => r.method === 'DELETE')).toEqual([]);
  });

  it.each(['retained', 'result-lost', 'record-lost'] as const)('reloads an already completed job with %s Redis data without a second charge', async mode => {
    const job = await generate();
    await context.setOffline(true); await f.control.resume();
    await vi.waitFor(async () => expect((await f.http(a).get(`/api/editorial/jobs/${job.jobId}`).expect(200)).body.status).toBe('completed'));
    if (mode === 'result-lost') await f.control.client.hdel(`editorial:v1:job:${job.jobId}`, 'result');
    if (mode === 'record-lost') await f.control.client.del(`editorial:v1:job:${job.jobId}`);
    await context.setOffline(false);
    const res = await reload(job.jobId); expect(res.status()).toBe(mode === 'record-lost' ? 404 : 200);
    if (mode === 'retained') await ui(page.getByTestId('textarea-post-content')).toHaveValue(/12%/);
    else {
      await ui(page.getByRole('alert')).toContainText('expired or unavailable');
      await ui(page.getByTestId('textarea-post-content')).toHaveCount(0);
      await page.getByRole('button', { name: 'Retry same request' }).click();
      await ui(page.getByRole('alert')).toContainText('No new generation was started');
    }
    expect(await pointer()).toBeNull(); expect(boundaries.ai).toHaveBeenCalledTimes(4); noReplay();
    expect(await ledger()).toEqual([{ operation_id: job.requestIntent, status: 'succeeded' }]);
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toEqual([]);
  });

  it.each(['waiting', 'reserved'] as const)('cancels a reattached %s job truthfully with no replay', async state => {
    if (state === 'reserved') { holdProvider(); await f.control.resume(); }
    const job = await generate();
    if (state === 'reserved') await vi.waitFor(async () => expect(await ledger()).toEqual([{ operation_id: job.requestIntent, status: 'started' }]));
    const res = await reload(job.jobId); expect(res.status()).toBe(200);
    await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
    await ui(page.getByRole('alert')).toContainText('Generation cancelled');
    await ui(page.getByRole('alert')).toContainText('may still count toward usage');
    expect((await f.http(a).get(`/api/editorial/jobs/${job.jobId}`).expect(200)).body.status).toBe('cancelled');
    await vi.waitFor(async () => expect(await ledger()).toEqual(state === 'waiting' ? [] : [{ operation_id: job.requestIntent, status: 'cancelled' }]));
    const calls = boundaries.ai.mock.calls.length;
    expect(await pointer()).toBeNull(); noReplay();
    await page.getByRole('button', { name: 'Retry same request' }).click();
    await ui(page.getByRole('alert')).toContainText('Generation cancelled');
    expect(boundaries.ai).toHaveBeenCalledTimes(calls); noReplay();
    if (state === 'waiting') expect(calls).toBe(0);
  });

  it('treats a forged pointer as untrusted and denies another account/tenant job on the server', async () => {
    const owner = a; const job = await generate();
    const stranger = await actor();
    for (const method of ['get', 'delete'] as const) await f.http(stranger)[method](`/api/editorial/jobs/${job.jobId}`).expect(404);
    await f.http(stranger).get(`/api/editorial/jobs/${job.jobId}/result`).expect(404);
    await login(stranger);
    await page.reload(); await ui(page.getByTestId('button-global-create')).toBeVisible();
    expect(await pointer()).toBeNull();
    await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), {
      key: EDITORIAL_RECOVERY_KEY, value: { tenantId: stranger.tenantId, userId: stranger.userId, ...job },
    });
    const res = await reload(job.jobId); expect(res.status()).toBe(404);
    await ui(page.getByRole('alert')).toContainText('expired or unavailable');
    expect(await pointer()).toBeNull(); expect(boundaries.ai).not.toHaveBeenCalled(); noReplay();
    expect((await f.http(owner).get(`/api/editorial/jobs/${job.jobId}`).expect(200)).body.status).toBe('queued');
  });

  it('clears the pointer on account change and real UI logout, without cancelling or leaking the old job', async () => {
    const job = await generate();
    await page.waitForLoadState('networkidle');
    const stranger = await actor(); await login(stranger);
    const start = requests.length;
    await page.reload(); await ui(page.getByTestId('button-global-create')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await pointer()).toBeNull();
    expect(requests.slice(start).some(r => r.path.includes(job.jobId))).toBe(false);
    await login(a); await page.reload();
    await ui(page.getByTestId('button-global-create')).toBeVisible();
    // Account-cache cancellation legitimately aborts outstanding dashboard GETs.
    // Let those unrelated loads finish before testing the explicit logout path.
    await page.waitForLoadState('networkidle');
    // Restore only our valid pointer to exercise the actual logout cleanup path.
    await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), {
      key: EDITORIAL_RECOVERY_KEY, value: { tenantId: a.tenantId, userId: a.userId, ...job },
    });
    await page.getByTestId('button-navbar-account').click();
    const signedOut = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/sign-out');
    await page.getByTestId('button-navbar-logout').click();
    expect((await signedOut).status()).toBe(200);
    await page.waitForURL(`${front.origin}/`);
    await ui.poll(pointer).toBeNull();
    expect(boundaries.ai).not.toHaveBeenCalled(); noReplay();
    expect(requests.filter(r => r.method === 'DELETE' && r.path.includes(job.jobId))).toEqual([]);
  });
});