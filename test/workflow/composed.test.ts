import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type Bull from 'bull';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundaries, prose } from './boundaries';
import { createWorkflowFixture, type Actor, type WorkflowFixture } from './fixture';
import type { PublishDraftJobData } from '../../server/jobs/handlers/publish-draft';

// No runtime DB imports or connections when discovered by the ordinary suite.
describe.skipIf(process.env.WORKFLOW_DB_TESTS !== 'true')('roadmap28 authenticated composed workflows', () => {
  let f: WorkflowFixture;
  let a: Actor;
  beforeAll(async () => { f = await createWorkflowFixture(); }, 30000);
  beforeEach(async () => { process.env.PUBLISHING_MODE = 'sandbox'; a = await f.actor(); });
  afterEach(async () => {
    await f.control.pause();
    expect(f.blocked, 'No unmocked provider may attempt outbound traffic').toEqual([]);
    await f.cleanupActors();
  });
  afterAll(async () => { await f?.close(); }, 30000);

  async function onboarding() {
    const api = f.http(a);
    const me = await api.get('/api/me').expect(200);
    expect(me.body.id).toBe(a.userId);
    expect(me.body).not.toHaveProperty('password');
    const session = await api.get('/api/auth/get-session').expect(200);
    expect(session.body.user.id).toBe(a.userId);
    await api.post('/api/complete-registration').send({ firstName: 'Workflow', lastName: 'Person', countries: ['India'], industries: ['Technology & SaaS'] }).expect(200);
    const recommendations = await api.post('/api/ai/analyze-identity').send({ focusDescription: 'I study engineering latency in controlled pilot trials.', selectedIndustry: 'Technology & SaaS' }).expect(200);
    expect(recommendations.body.keywords).toContainEqual(expect.objectContaining({ keyword: a.keyword }));
    const saved = await api.post('/api/profile/complete-onboarding').send({
      focusDescription: 'I study engineering latency in controlled pilot trials.', recommendedIndustry: 'technology_saas',
      keywords: recommendations.body.keywords, publications: [], companies: [], influencers: [],
    }).expect(200);
    await api.patch('/api/profile').send({ enabledPlatforms: ['mastodon'], requirePublishReview: true }).expect(200);
    const persisted = await api.get('/api/profile').expect(200);
    expect(persisted.body).toMatchObject({ id: saved.body.id, userId: a.userId, tenantId: a.tenantId, onboardingStatus: 'completed', requirePublishReview: true });
    expect(persisted.body.keywords).toEqual(saved.body.keywords);
    return persisted.body;
  }
  async function refresh(operationId = randomUUID()) {
    const admitted = await f.http(a).post('/api/inbox/refresh').send({ operationId }).expect(200);
    if (admitted.body.jobId) {
      await vi.waitFor(async () => {
        const state = await f.http(a).get(`/api/inbox/refresh/${admitted.body.jobId}`).expect(200);
        expect(state.body.status).toBe('completed');
      }, { timeout: 10000 });
    }
    const receipt = await f.http(a).post('/api/inbox/refresh').send({ operationId }).expect(200);
    expect(receipt.body.success).toBe(true);
    return { receipt: receipt.body, operationId, jobId: admitted.body.jobId };
  }
  async function generate() {
    const items = await f.http(a).get('/api/inbox').expect(200);
    const item = items.body[0]; expect(item.articleUrl).toBe(a.articleUrl);
    const requestIntent = randomUUID();
    const input = { headline: item.headline, summary: item.summary, source: item.source, articleUrl: item.articleUrl, platform: 'mastodon', tone: 'professional', requestIntent };
    const result = await f.http(a).post('/api/ai/generate-post').send(input).expect(200);
    expect(result.headers['x-generation-operation-id']).toBe(requestIntent);
    expect(result.body.content).toContain('12%');
    expect(boundaries.ai.mock.calls.at(-1)?.[0]).toContain(item.summary);
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toEqual([]);
    return { item, input, content: result.body.content as string, requestIntent };
  }
  async function savedDraft() {
    await onboarding(); await f.paid(a); await refresh();
    const generated = await generate();
    const response = await f.http(a).post('/api/drafts').send({ inboxItemId: generated.item.id, content: generated.content, platform: 'mastodon', tone: 'professional' }).expect(200);
    expect(response.body).toMatchObject({ inboxItemId: generated.item.id, tenantId: a.tenantId, userId: a.userId, publishStatus: 'draft' });
    return { ...generated, draft: response.body };
  }
  async function approvedSchedule(draft: any, publishAt = new Date(Date.now() - 1000).toISOString()) {
    await f.http(a).post(`/api/drafts/${draft.id}/approve-publishing`).send({ content: draft.content, updatedAt: draft.updatedAt }).expect(200);
    return (await f.http(a).post(`/api/drafts/${draft.id}/schedule`).send({ publishAt, platforms: ['mastodon'] }).expect(200)).body;
  }
  function delivery(draftId: string, schedule: any): Bull.Job<PublishDraftJobData> {
    return { id: randomUUID(), data: { tenantId: a.tenantId, userId: a.userId, draftId, draftScheduleId: schedule.id,
      draftScheduleTargetId: schedule.targets[0].id, platform: 'mastodon', publishAt: schedule.scheduledPublishAt, attemptNumber: 1 },
      attemptsMade: 0, opts: { attempts: 1 }, progress: async () => undefined, discard: () => undefined } as unknown as Bull.Job<PublishDraftJobData>;
  }
  async function operation(id: string) { return (await f.http(a).get(`/api/generation/operations/${id}`).expect(200)).body; }
  async function ledgerCount() {
    return f.runtime.db.transaction(async tx => {
      const { sql } = await import('drizzle-orm');
      await tx.execute(sql`select set_config('app.tenant_id', ${a.tenantId}, true)`);
      return Number((await tx.execute(sql`select count(*) as n from billing_generation_operations where tenant_id=${a.tenantId}`)).rows[0].n);
    });
  }

  it('original onboarding → persisted article → generation → save → exact review → schedule → sandbox receipt, same IDs', async () => {
    const g = await savedDraft();
    await f.http(a).post(`/api/drafts/${g.draft.id}/schedule`).send({ publishAt: new Date().toISOString() }).expect(403);
    const schedule = await approvedSchedule(g.draft);
    const result = await f.handlePublishDraft(delivery(g.draft.id, schedule));
    expect(result).toEqual({ platform: 'mastodon', status: 'simulated' });
    const status = await f.http(a).get(`/api/drafts/${g.draft.id}/publish-status`).expect(200);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.body.schedule).toMatchObject({ id: schedule.id, draftId: g.draft.id, status: 'simulated', targets: [expect.objectContaining({ id: schedule.targets[0].id, executionMode: 'sandbox', status: 'simulated', receiptKind: 'none', providerPostId: null })] });
    const logs = (await f.http(a).get(`/api/drafts/${g.draft.id}/publish-logs`).expect(200)).body;
    expect(logs.filter((l: any) => l.status === 'simulated')).toEqual([expect.objectContaining({ draftId: g.draft.id, draftScheduleId: schedule.id, targetId: schedule.targets[0].id, publishedPostId: null })]);
    expect((await f.http(a).get('/api/drafts/published').expect(200)).body).toEqual([]);
    expect((await f.http(a).get('/api/inbox').expect(200)).body[0].id).toBe(g.item.id);
    expect(await operation(g.requestIntent)).toMatchObject({ status: 'succeeded', consumed: true, resultRetained: false });
    expect(await ledgerCount()).toBe(1); expect(boundaries.publisher).not.toHaveBeenCalled();
  });

  it('rejects unsigned/revoked sessions and foreign tenant IDs before workflow mutations', async () => {
    await request(f.api).post('/api/profile/complete-onboarding').send({}).expect(401);
    await request(f.api).get('/api/me').set('Cookie', 'better-auth.session_token=forged').expect(401);
    await f.http(a).get('/api/me').set('x-tenant-id', randomUUID()).expect(404);
    await f.owner.query('delete from sessions where user_id=$1', [a.userId]);
    await f.http(a).get('/api/me').expect(401);
    expect(boundaries.ai).not.toHaveBeenCalled();
  });

  it('failed refresh preserves persisted inbox; repeated committed refresh and worker delivery reuse the receipt', async () => {
    await onboarding(); const first = await refresh();
    const before = (await f.http(a).get('/api/inbox').expect(200)).body;
    const crawlCount = boundaries.crawl.mock.calls.length;
    const repeated = await f.http(a).post('/api/inbox/refresh').send({ operationId: first.operationId }).expect(200);
    expect(repeated.body).toEqual(first.receipt);
    const job = await f.queues.getInboxRefreshQueue()!.getJob(first.jobId);
    const { handleInboxRefresh } = await import('../../server/jobs/handlers/inbox-refresh');
    expect(JSON.parse(JSON.stringify(await handleInboxRefresh(job!)))).toEqual(first.receipt);
    expect(boundaries.crawl).toHaveBeenCalledTimes(crawlCount);
    await f.http(a).patch('/api/profile').send({ keywords: [`failure${randomUUID().replaceAll('-', '')}`] }).expect(200);
    boundaries.crawl.mockRejectedValue(new Error('controlled external crawl failure'));
    const admitted = await f.http(a).post('/api/inbox/refresh').send({ operationId: randomUUID(), autoRefresh: true }).expect(200);
    await vi.waitFor(async () => {
      const state = await f.http(a).get(`/api/inbox/refresh/${admitted.body.jobId}`).expect(200);
      expect(state.body.status).toBe('failed');
    }, { timeout: 15000 });
    expect((await f.http(a).get('/api/inbox').expect(200)).body).toEqual(before);
  }, 20000); // Real Bull retries/backoff exceed Vitest's default five seconds.

  it('generation success and provider failure consume once; intent retries never fabricate or save drafts', async () => {
    await onboarding(); await refresh(); const g = await generate();
    const calls = boundaries.ai.mock.calls.length;
    expect((await f.http(a).post('/api/ai/generate-post').send(g.input).expect(409)).body.code).toBe('generation_operation_consumed');
    expect(boundaries.ai).toHaveBeenCalledTimes(calls);
    const { AIGenerationError } = await import('../../server/services/openRouter');
    boundaries.ai.mockRejectedValue(new AIGenerationError('ai_unavailable'));
    const failed = { ...g.input, requestIntent: randomUUID() };
    const failure = await f.http(a).post('/api/ai/generate-post').send(failed).expect(503);
    expect(failure.body).not.toHaveProperty('content'); expect(failure.body).not.toHaveProperty('posts');
    await f.http(a).post('/api/ai/generate-post').send(failed).expect(409);
    expect(boundaries.ai).toHaveBeenCalledTimes(calls + 1);
    expect(await operation(failed.requestIntent)).toMatchObject({ status: 'failed', consumed: true });
    expect(await ledgerCount()).toBe(2);
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toEqual([]);
    expect((await f.http(a).get('/api/inbox').expect(200)).body[0].id).toBe(g.item.id);
  });

  it('failed draft insert leaves inbox and generation status unchanged; explicit save recovery does not regenerate', async () => {
    await onboarding(); await refresh(); const g = await generate();
    const before = (await f.http(a).get('/api/inbox').expect(200)).body;
    const calls = boundaries.ai.mock.calls.length;
    const body = { inboxItemId: g.item.id, content: `${g.content}\u0000`, platform: 'mastodon', tone: 'professional' };
    // PostgreSQL rejects NUL in text: a real insert failure without schema,
    // privilege or repository mocks. inbox_item_id has no FK in this schema.
    await f.http(a).post('/api/drafts').send(body).expect(500);
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toEqual([]);
    expect((await f.http(a).get('/api/inbox').expect(200)).body).toEqual(before);
    expect(await operation(g.requestIntent)).toMatchObject({ status: 'succeeded' });
    const saved = await f.http(a).post('/api/drafts').send({ ...body, content: g.content }).expect(200);
    expect(saved.body.inboxItemId).toBe(g.item.id); expect(await ledgerCount()).toBe(1);
    expect(boundaries.ai).toHaveBeenCalledTimes(calls);
  });

  it('stale approval is rejected; editing clears approval and blocks scheduling until exact revision review', async () => {
    const { draft } = await savedDraft();
    await f.http(a).post(`/api/drafts/${draft.id}/approve-publishing`).send({ content: draft.content, updatedAt: draft.updatedAt }).expect(200);
    const edited = (await f.http(a).patch(`/api/drafts/${draft.id}`).send({ content: `${draft.content} Review.` }).expect(200)).body;
    expect(edited.publishApprovalHash).toBeNull();
    await f.http(a).post(`/api/drafts/${draft.id}/approve-publishing`).send({ content: draft.content, updatedAt: draft.updatedAt }).expect(409);
    await f.http(a).post(`/api/drafts/${draft.id}/schedule`).send({ publishAt: new Date().toISOString() }).expect(403);
    expect((await approvedSchedule(edited)).draftId).toBe(draft.id);
  });

  it('policy disable after scheduling prevents worker dispatch; explicit retry after re-enable replaces target', async () => {
    process.env.PUBLISHING_MODE = 'live'; // Only the Mastodon adapter mock can execute.
    const { draft } = await savedDraft(); const schedule = await approvedSchedule(draft);
    await f.http(a).put('/api/publishing-rules/mastodon').send({ enabled: false }).expect(200);
    await expect(f.handlePublishDraft(delivery(draft.id, schedule))).rejects.toThrow('disabled');
    expect(boundaries.publisher).not.toHaveBeenCalled();
    const failed = await f.http(a).get(`/api/drafts/${draft.id}/publish-status`).expect(200);
    expect(failed.body.schedule.status).toBe('failed');
    await f.http(a).post(`/api/drafts/${draft.id}/retry-publish`).expect(403);
    await f.http(a).put('/api/publishing-rules/mastodon').send({ enabled: true }).expect(200);
    await f.http(a).post(`/api/drafts/${draft.id}/retry-publish`).expect(200);
    const current = (await f.http(a).get(`/api/drafts/${draft.id}/publish-status`).expect(200)).body.schedule;
    expect(current.targets[0].id).not.toBe(schedule.targets[0].id);
    expect((await f.handlePublishDraft(delivery(draft.id, schedule))).status).toBe('skipped');
    expect(boundaries.publisher).not.toHaveBeenCalled();
  });

  it('rescheduled and cancelled job generations cannot dispatch; concurrent/repeated deliveries commit one sandbox completion', async () => {
    const { draft } = await savedDraft(); const old = await approvedSchedule(draft);
    const next = (await f.http(a).put(`/api/drafts/${draft.id}/schedule`).send({ publishAt: old.scheduledPublishAt }).expect(200)).body;
    expect(next.targets[0].id).not.toBe(old.targets[0].id);
    expect((await f.handlePublishDraft(delivery(draft.id, old))).status).toBe('skipped');
    await f.http(a).delete(`/api/drafts/${draft.id}/schedule`).expect(200);
    expect((await f.handlePublishDraft(delivery(draft.id, next))).status).toBe('skipped');
    const final = (await f.http(a).put(`/api/drafts/${draft.id}/schedule`).send({ publishAt: old.scheduledPublishAt }).expect(200)).body;
    const results = await Promise.all([f.handlePublishDraft(delivery(draft.id, final)), f.handlePublishDraft(delivery(draft.id, final))]);
    expect(results.map(r => r.status).sort()).toEqual(['simulated', 'skipped']);
    expect((await f.handlePublishDraft(delivery(draft.id, final))).status).toBe('skipped');
    const logs = (await f.http(a).get(`/api/drafts/${draft.id}/publish-logs`).expect(200)).body;
    expect(logs.filter((l: any) => l.status === 'simulated')).toHaveLength(1);
    expect(boundaries.publisher).not.toHaveBeenCalled();
  });

  it('mock live acceptance then throw remains unknown without replay; reconciliation is scoped, CAS audited and not verified publication', async () => {
    process.env.PUBLISHING_MODE = 'live';
    const { draft } = await savedDraft(); const schedule = await approvedSchedule(draft);
    const accepted: string[] = [];
    boundaries.publisher.mockImplementation(async (_scope, id) => { accepted.push(id); throw new Error('response lost after external acceptance'); });
    await expect(f.handlePublishDraft(delivery(draft.id, schedule))).rejects.toThrow('reconciliation');
    expect(accepted).toEqual([draft.id]);
    const current = (await f.http(a).get(`/api/drafts/${draft.id}/publish-status`).expect(200)).body.schedule;
    expect(current.status).toBe('unknown');
    await f.http(a).post(`/api/drafts/${draft.id}/retry-publish`).expect(409);
    await f.http(a).post(`/api/drafts/${draft.id}/publish-now`).expect(409);
    await f.http(a).delete(`/api/drafts/${draft.id}/schedule`).expect(409);
    expect((await f.handlePublishDraft(delivery(draft.id, schedule))).status).toBe('skipped');
    const endpoint = `/api/drafts/${draft.id}/schedule/targets/${current.targets[0].id}/reconcile`;
    const decision = { expectedRevision: current.targets[0].revision, decision: 'delivered', receipt: 'operator-reference-123', note: 'Operator inspected the matching accepted post.', workerStopped: true };
    const stranger = await f.actor();
    await f.http(stranger).post(endpoint).send(decision).expect(404);
    const responses = await Promise.all([f.http(a).post(endpoint).send(decision), f.http(a).post(endpoint).send(decision)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const logs = (await f.http(a).get(`/api/drafts/${draft.id}/publish-logs`).expect(200)).body;
    expect(logs.filter((l: any) => l.receiptKind === 'manual')).toEqual([expect.objectContaining({ actorUserId: a.userId, targetId: current.targets[0].id,
      evidence: expect.objectContaining({ previousStatus: 'unknown', previousRevision: current.targets[0].revision, decision: 'delivered', receipt: decision.receipt }) })]);
    expect((await f.http(a).get('/api/drafts/published').expect(200)).body).toEqual([]);
    await f.http(a).post(`/api/drafts/${draft.id}/retry-publish`).expect(409);
    expect(accepted).toEqual([draft.id]);
  });

  it('waiting cancellation consumes nothing; cancellation after durable reservation consumes once and blocks replay', async () => {
    await onboarding();
    const input = { requestIntent: randomUUID(), title: 'Pilot', content: prose, selectedPlatforms: ['mastodon'] };
    const queued = (await f.http(a).post('/api/editorial/jobs/manual').send(input).expect(202)).body;
    await f.http(a).delete(`/api/editorial/jobs/${queued.jobId}`).expect(200);
    await f.editorial.getEditorialJobs()!.process(queued.jobId);
    await f.http(a).get(`/api/generation/operations/${input.requestIntent}`).expect(404);
    expect(boundaries.ai).not.toHaveBeenCalled(); expect(await ledgerCount()).toBe(0);
    const activeInput = { ...input, requestIntent: randomUUID() };
    boundaries.ai.mockImplementation((_prompt, options) => new Promise((_ok, fail) => {
      options.signal.addEventListener('abort', () => fail(options.signal.reason), { once: true });
    }));
    const active = (await f.http(a).post('/api/editorial/jobs/manual').send(activeInput).expect(202)).body;
    await f.control.resume();
    await vi.waitFor(() => expect(boundaries.ai).toHaveBeenCalled(), { timeout: 5000 });
    expect(await operation(activeInput.requestIntent)).toMatchObject({ status: 'started' });
    await f.http(a).delete(`/api/editorial/jobs/${active.jobId}`).expect(200);
    await vi.waitFor(async () => expect(await operation(activeInput.requestIntent)).toMatchObject({ status: 'cancelled' }), { timeout: 5000 });
    await f.control.pause();
    await f.http(a).get(`/api/editorial/jobs/${active.jobId}/result`).expect(409);
    const retry = await f.http(a).post('/api/editorial/jobs/manual').send(activeInput).expect(202);
    expect(retry.body.jobId).toBe(active.jobId);
    await f.editorial.getEditorialJobs()!.process(active.jobId);
    expect(await ledgerCount()).toBe(1);
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toEqual([]);
  });
});