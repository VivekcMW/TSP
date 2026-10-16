import { randomUUID, createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boundaries, prose } from './boundaries';
import { createWorkflowFixture, type Actor, type WorkflowFixture } from './fixture';
import { buildCrashWorker, CrashProcess } from './crash-process';

describe.skipIf(process.env.WORKFLOW_CRASH_TESTS !== 'true')('roadmap28 real process crash and Bull publication', () => {
  let f: WorkflowFixture, a: Actor;
  let bundle: Awaited<ReturnType<typeof buildCrashWorker>>;
  const workers: CrashProcess[] = [];
  beforeAll(async () => {
    f = await createWorkflowFixture();
    const identity = await f.owner.query("select current_database() as db, host(inet_server_addr()) as host, inet_server_port() as port, current_user as name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname=current_user");
    expect(identity.rows[0]).toEqual({ db: 'thesocialpundit_acceptance_test', host: '127.0.0.1', port: 60053,
      name: 'vivekanandchoudhari', rolsuper: false, rolbypassrls: true, rolcreatedb: false, rolcreaterole: false });
    const runtime = await f.runtime.pool.query("select current_database() as db, host(inet_server_addr()) as host, inet_server_port() as port, current_user as name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname=current_user");
    expect(runtime.rows[0]).toEqual({ db: 'thesocialpundit_acceptance_test', host: '127.0.0.1', port: 60053,
      name: 'tsp_app', rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
    expect((await f.owner.query('select count(*)::int as n from schema_migrations')).rows[0].n).toBe(38);
    bundle = await buildCrashWorker();
  }, 30000);
  beforeEach(async () => {
    process.env.PUBLISHING_MODE = 'sandbox'; a = await f.actor();
    await f.http(a).post('/api/complete-registration').send({ firstName: 'Crash', lastName: 'Fixture', countries: ['India'], industries: ['Technology & SaaS'] }).expect(200);
    await f.http(a).post('/api/profile/complete-onboarding').send({ focusDescription: 'Controlled engineering trial analysis.',
      recommendedIndustry: 'technology_saas', keywords: [{ keyword: a.keyword, weight: 1 }], publications: [], companies: [], influencers: [] }).expect(200);
    await f.http(a).patch('/api/profile').send({ enabledPlatforms: ['mastodon'], requirePublishReview: true }).expect(200);
    await f.paid(a);
  });
  afterEach(async () => {
    try { for (const worker of workers) await worker.close(); }
    finally { workers.length = 0; await f.cleanupActors(); }
    expect(f.blocked).toEqual([]);
  }, 30000);
  afterAll(async () => {
    try {
      if (f) {
        const files = readdirSync(resolve('migrations')).filter(name => /^\d{4}_.*\.sql$/.test(name));
        const ledger = (await f.owner.query('select filename, checksum from schema_migrations')).rows;
        expect(files).toHaveLength(38); expect(ledger).toHaveLength(38);
        for (const file of files) expect(ledger.find(row => row.filename === file)?.checksum).toBe(
          createHash('sha256').update(readFileSync(resolve('migrations', file))).digest('hex').slice(0, 16));
      }
    } finally { await f?.close(); await bundle?.remove(); }
  }, 30000);

  async function worker(phase = '', publish = true) {
    const child = new CrashProcess(bundle.output); workers.push(child); await child.wait('ready');
    if (publish) await child.command('publish', { phase });
    return child;
  }
  async function scheduled(mode = 'sandbox') {
    process.env.PUBLISHING_MODE = mode;
    const api = f.http(a);
    const draft = (await api.post('/api/drafts').send({ content: 'A controlled pilot measured 12% lower latency across 30 stores.', platform: 'mastodon', tone: 'professional' }).expect(200)).body;
    await api.post(`/api/drafts/${draft.id}/schedule`).send({ publishAt: new Date().toISOString() }).expect(403);
    await api.post(`/api/drafts/${draft.id}/approve-publishing`).send({ content: draft.content, updatedAt: draft.updatedAt }).expect(200);
    const schedule = (await api.post(`/api/drafts/${draft.id}/schedule`).send({ publishAt: new Date(Date.now() - 1000).toISOString(), platforms: ['mastodon'] }).expect(200)).body;
    return { draft, schedule, target: schedule.targets[0], data: { tenantId: a.tenantId, userId: a.userId, draftId: draft.id,
      draftScheduleId: schedule.id, draftScheduleTargetId: schedule.targets[0].id, platform: 'mastodon', publishAt: schedule.scheduledPublishAt, attemptNumber: 1 } };
  }
  type Publication = Awaited<ReturnType<typeof scheduled>>;
  const snapshot = async (p: Publication) => (await f.http(a).get(`/api/drafts/${p.draft.id}/publish-status`).expect(200)).body.schedule;
  const logs = async (p: Publication) => (await f.http(a).get(`/api/drafts/${p.draft.id}/publish-logs`).expect(200)).body as any[];
  async function enqueueDue(p: Publication) {
    // The production scheduler scans scopes: refuse foreign pending fixtures before invoking it.
    const foreign = await f.owner.query("select count(*)::int as n from draft_schedules where status in ('scheduled','queued','publishing') and tenant_id <> $1", [a.tenantId]);
    expect(foreign.rows[0].n, 'No foreign pending schedules may enter this private queue').toBe(0);
    const scheduler = await import('../../server/jobs/scheduler');
    await scheduler.runSchedulerCycle(`crash-fixture-${randomUUID()}`, 1, (_slot, connected) => scheduler.publishDueDrafts(connected));
    const jobs = await f.queues.getPublishDraftQueue()!.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed']);
    const job = jobs.find(job => job.data.draftScheduleTargetId === p.target.id)!;
    expect(job).toBeDefined(); expect(job.data).toEqual(p.data); expect(job.opts.attempts).toBe(3);
    return String(job.id);
  }
  async function noVerifiedPublish() {
    expect((await f.http(a).get('/api/drafts/published').expect(200)).body).toEqual([]);
    expect(boundaries.email.mock.calls.filter(([email]) => email.type === 'post_published')).toHaveLength(0);
    expect(workers.flatMap(w => w.events).filter(e => e.event === 'email' && e.type === 'post_published')).toHaveLength(0);
  }
  async function ageClaim(p: Publication) {
    // ONLY the owned target's timestamp changes; no status/token/revision rewriting.
    const aged = await f.owner.query("update draft_schedule_targets set updated_at=(clock_timestamp() at time zone 'UTC')-interval '6 minutes' where id=$1 and tenant_id=$2 and draft_schedule_id=$3 and status='publishing' returning id", [p.target.id, a.tenantId, p.schedule.id]);
    expect(aged.rowCount).toBe(1);
    expect(Date.now() - new Date((await snapshot(p)).targets[0].updatedAt).getTime()).toBeGreaterThan(5 * 60_000);
  }
  const reconcileUrl = (p: Publication) => `/api/drafts/${p.draft.id}/schedule/targets/${p.target.id}/reconcile`;

  it('SIGKILL after mock acceptance before DB completion: restart cannot republish; stale claim needs audited manual reconciliation', async () => {
    const p = await scheduled('live'); const first = await worker('accepted'); const jobId = await enqueueDue(p);
    await first.wait('accepted');
    const claimed = (await snapshot(p)).targets[0];
    expect(claimed).toMatchObject({ status: 'publishing', receiptKind: null, providerPostId: null, retryCount: 1 });
    expect((await logs(p)).map(log => log.status)).toEqual(['pending']);
    await first.kill();
    const restarted = await worker();
    expect((await restarted.wait('completed', e => e.jobId === jobId)).result.status).toBe('skipped');
    expect((await snapshot(p)).status).toBe('publishing');
    await f.http(a).post(`/api/drafts/${p.draft.id}/retry-publish`).expect(409);
    await f.http(a).delete(`/api/drafts/${p.draft.id}/schedule`).expect(409);
    const decision = { expectedRevision: claimed.revision, decision: 'delivered', receipt: `fixture-receipt-${p.draft.id}`,
      note: 'Fixture provider accepted; exact child SIGKILL exit observed.', workerStopped: true };
    await f.http(a).post(reconcileUrl(p)).send(decision).expect(409);
    await ageClaim(p);
    const responses = await Promise.all([f.http(a).post(reconcileUrl(p)).send(decision), f.http(a).post(reconcileUrl(p)).send(decision)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await snapshot(p)).status).toBe('manual_published');
    expect(await f.storage.finishPublishTarget(a, p.target.id, 'published', { draftId: p.draft.id, platform: 'mastodon', status: 'published',
      claimToken: claimed.claimToken, executionMode: 'live', receiptKind: 'provider_id', publishedPostId: decision.receipt })).toBe(false);
    const audit = (await logs(p)).filter(log => log.receiptKind === 'manual');
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ actorUserId: a.userId, evidence: { workerStopped: true, previousStatus: 'publishing', previousRevision: claimed.revision } });
    await f.http(a).post(`/api/drafts/${p.draft.id}/retry-publish`).expect(409);
    expect(workers.flatMap(w => w.events).filter(e => e.event === 'accepted')).toHaveLength(1);
    await noVerifiedPublish();
  });

  it('SIGKILL after authorization but before dispatch stays stuck; explicit not-delivered reconciliation fences old claim and rechecks policy', async () => {
    const p = await scheduled('live'); const first = await worker('authorized'); const jobId = await enqueueDue(p);
    await first.wait('authorized'); const claim = (await snapshot(p)).targets[0]; await first.kill();
    const restarted = await worker(); await restarted.wait('completed', e => e.jobId === jobId);
    expect((await snapshot(p)).status).toBe('publishing');
    await f.http(a).post(`/api/drafts/${p.draft.id}/retry-publish`).expect(409);
    await ageClaim(p);
    const decision = { expectedRevision: claim.revision, decision: 'not_delivered', note: 'IPC proves pre-dispatch barrier and exact child exit.', workerStopped: false };
    await f.http(a).post(reconcileUrl(p)).send(decision).expect(400);
    await f.http(a).post(reconcileUrl(p)).send({ ...decision, workerStopped: true }).expect(200);
    await f.http(a).put('/api/publishing-rules/mastodon').send({ enabled: false }).expect(200);
    await f.http(a).post(`/api/drafts/${p.draft.id}/retry-publish`).expect(403);
    await f.http(a).put('/api/publishing-rules/mastodon').send({ enabled: true }).expect(200);
    await restarted.kill();
    process.env.PUBLISHING_MODE = 'sandbox';
    const sandboxWorker = await worker();
    const retry = (await f.http(a).post(`/api/drafts/${p.draft.id}/retry-publish`).expect(200)).body;
    await sandboxWorker.wait('completed', e => e.jobId === retry.jobId);
    expect((await snapshot(p)).targets[0]).toMatchObject({ status: 'simulated', executionMode: 'sandbox' });
    expect((await snapshot(p)).targets[0].id).not.toBe(p.target.id);
    expect(await f.storage.finishPublishTarget(a, p.target.id, 'failed', { draftId: p.draft.id, platform: 'mastodon', status: 'failed', claimToken: claim.claimToken, executionMode: 'live' })).toBe(false);
    expect(workers.flatMap(w => w.events).filter(e => e.event === 'accepted')).toHaveLength(0);
    await noVerifiedPublish();
  });

  it('SIGKILL before claim: bounded Bull stalled recovery safely acquires once and commits one sandbox receipt', async () => {
    const p = await scheduled(); const first = await worker('before-claim'); const jobId = await enqueueDue(p);
    await first.wait('before-claim'); expect((await snapshot(p)).targets[0]).toMatchObject({ status: 'scheduled', claimToken: null, retryCount: 0 });
    await first.kill(); const restarted = await worker();
    expect((await restarted.wait('completed', e => e.jobId === jobId)).result).toEqual({ platform: 'mastodon', status: 'simulated' });
    expect((await snapshot(p)).targets[0]).toMatchObject({ status: 'simulated', retryCount: 1, providerPostId: null, receiptKind: 'none' });
    const job = await f.queues.getPublishDraftQueue()!.getJob(jobId);
    expect(Number(await f.queues.getPublishDraftQueue()!.client.hget(f.queues.getPublishDraftQueue()!.toKey(jobId), 'stalledCounter'))).toBe(1);
    expect(job!.attemptsMade).toBe(0); // Stalls are bounded separately from handler attempts.
    expect((await logs(p)).filter(l => l.status === 'simulated')).toHaveLength(1);
    await noVerifiedPublish();
  });

  it('actual scheduler/Bull handler retries an unambiguous pre-send failure; duplicate jobs and receipt CAS cannot double-complete', async () => {
    const p = await scheduled(); const child = await worker('retry-once'); const jobId = await enqueueDue(p);
    expect(await f.queues.enqueuePublishDraft(p.data)).toBe(jobId);
    expect((await child.wait('completed', e => e.jobId === jobId)).result.status).toBe('simulated');
    const job = await f.queues.getPublishDraftQueue()!.getJob(jobId);
    expect(job!.attemptsMade).toBe(1); expect(job!.returnvalue).toEqual({ platform: 'mastodon', status: 'simulated' });
    const duplicate = await f.queues.enqueuePublishDraft({ ...p.data, attemptNumber: 2 });
    expect((await child.wait('completed', e => e.jobId === duplicate)).result.status).toBe('skipped');
    const history = await logs(p);
    expect(history.filter(l => l.status === 'retrying')).toHaveLength(1);
    const receipt = history.find(l => l.status === 'simulated');
    expect(history.filter(l => l.status === 'simulated')).toHaveLength(1);
    expect(receipt).toMatchObject({ targetId: p.target.id, draftScheduleId: p.schedule.id, executionMode: 'sandbox', receiptKind: 'none', publishedPostId: null, attempt: 2, maxAttempts: 3 });
    const duplicateReceipt = { draftId: p.draft.id, platform: 'mastodon', status: 'simulated', claimToken: receipt.claimToken, executionMode: 'sandbox', receiptKind: 'none' };
    expect(await Promise.all([f.storage.finishPublishTarget(a, p.target.id, 'simulated', duplicateReceipt), f.storage.finishPublishTarget(a, p.target.id, 'simulated', duplicateReceipt)])).toEqual([false, false]);
    expect((await snapshot(p)).status).toBe('simulated');
    expect(await f.storage.countScheduledDrafts(a, 'published')).toBe(0);
    expect(await f.storage.countScheduledDrafts(a, 'simulated')).toBe(1);
    await noVerifiedPublish();
  });

  it('cancelled queued target and post-admission policy disable remain fenced after worker restart', async () => {
    const cancelled = await scheduled(); const first = await worker('before-claim'); const jobId = await enqueueDue(cancelled);
    await first.wait('before-claim'); await first.kill();
    await f.http(a).delete(`/api/drafts/${cancelled.draft.id}/schedule`).expect(200);
    const denied = await scheduled('live'); const deniedJob = await enqueueDue(denied);
    await f.http(a).put('/api/publishing-rules/mastodon').send({ enabled: false }).expect(200);
    const restarted = await worker();
    expect((await restarted.wait('completed', e => e.jobId === jobId)).result.status).toBe('skipped');
    await restarted.wait('failed', e => e.jobId === deniedJob);
    expect((await snapshot(cancelled)).status).toBe('cancelled'); expect(await logs(cancelled)).toEqual([]);
    expect((await snapshot(denied)).status).toBe('failed');
    expect((await f.queues.getPublishDraftQueue()!.getJob(deniedJob))!.attemptsMade).toBe(1);
    expect(restarted.events.filter(e => e.event === 'accepted')).toHaveLength(0);
    await noVerifiedPublish();
  });

  it('mock-live Bull receipt completes once while sandbox remains separately counted without a Published email', async () => {
    const live = await scheduled('live'); const child = await worker(); const jobId = await enqueueDue(live);
    const receipt = `fixture-receipt-${live.draft.id}`;
    expect((await child.wait('completed', e => e.jobId === jobId)).result).toEqual({ platform: 'mastodon', status: 'published', postId: receipt });
    expect((await snapshot(live)).targets[0]).toMatchObject({ executionMode: 'live', status: 'published', receiptKind: 'provider_id', providerPostId: receipt });
    const duplicate = await f.queues.enqueuePublishDraft({ ...live.data, attemptNumber: 2 });
    expect((await child.wait('completed', e => e.jobId === duplicate)).result.status).toBe('skipped');
    expect((await logs(live)).filter(l => l.status === 'published')).toHaveLength(1);
    expect(child.events.filter(e => e.event === 'accepted')).toHaveLength(1);
    expect(child.events.filter(e => e.event === 'email' && e.type === 'post_published')).toHaveLength(1);
    await child.kill();
    const sandbox = await scheduled(); const sandboxWorker = await worker(); const sandboxId = await enqueueDue(sandbox);
    expect((await sandboxWorker.wait('completed', e => e.jobId === sandboxId)).result.status).toBe('simulated');
    expect((await snapshot(sandbox)).targets[0]).toMatchObject({ executionMode: 'sandbox', receiptKind: 'none', providerPostId: null });
    expect((await f.http(a).get('/api/drafts/published').expect(200)).body.map((d: any) => d.id)).toEqual([live.draft.id]);
    expect(await f.storage.countScheduledDrafts(a, 'published')).toBe(1);
    expect(await f.storage.countScheduledDrafts(a, 'simulated')).toBe(1);
    expect(child.events.filter(e => e.event === 'email' && e.type === 'post_published')).toHaveLength(1);
    expect(sandboxWorker.events.filter(e => e.event === 'email')).toHaveLength(0);
    expect(boundaries.email.mock.calls.filter(([email]) => email.type === 'post_published')).toHaveLength(0);
  });

  it('editorial restart preserves waiting cancellation; killed started generation and lost Redis record cannot bypass durable consumed-intent ledger', async () => {
    const input = { requestIntent: randomUUID(), title: 'Controlled pilot', content: prose, selectedPlatforms: ['mastodon'] };
    const cancelled = (await f.http(a).post('/api/editorial/jobs/manual').send(input).expect(202)).body;
    await f.http(a).delete(`/api/editorial/jobs/${cancelled.jobId}`).expect(200);
    const first = await worker('', false); await first.kill();
    const active = await worker('', false);
    await active.command('editorial', { jobId: cancelled.jobId });
    expect((await f.http(a).post('/api/editorial/jobs/manual').send(input).expect(202)).body.jobId).toBe(cancelled.jobId);
    await f.http(a).get(`/api/generation/operations/${input.requestIntent}`).expect(404);
    const started = { ...input, requestIntent: randomUUID() };
    const admitted = (await f.http(a).post('/api/editorial/jobs/manual').send(started).expect(202)).body;
    active.startEditorial(admitted.jobId); await active.wait('ai-started'); await active.kill();
    // Four tones use bounded parallelism: death may follow one or two started calls.
    const startedCalls = active.events.filter(e => e.event === 'ai-started').length;
    expect(startedCalls).toBeGreaterThanOrEqual(1); expect(startedCalls).toBeLessThanOrEqual(2);
    const recovered = await worker('', false);
    await recovered.command('editorial', { jobId: admitted.jobId });
    const operation = (await f.http(a).get(`/api/generation/operations/${started.requestIntent}`).expect(200)).body;
    expect(operation).toMatchObject({ status: 'started', consumed: true, outcome: 'in_progress_or_unknown', resultRetained: false, completedAt: null });
    expect((await f.http(a).post('/api/editorial/jobs/manual').send(started).expect(202)).body.jobId).toBe(admitted.jobId);
    await f.http(a).get(`/api/editorial/jobs/${admitted.jobId}/result`).expect(409);
    // Lose ONLY this actor's exact Redis record/dedupe, never FLUSHDB or unrelated keys.
    const redis = f.control.client;
    const key = `editorial:v1:job:${admitted.jobId}`;
    expect(await redis.hget(key, 'tenantId')).toBe(a.tenantId);
    const dedupe = await redis.hget(key, 'dedupe'); expect(await redis.get(dedupe!)).toBe(admitted.jobId);
    await redis.del(key, dedupe!);
    const replay = (await f.http(a).post('/api/editorial/jobs/manual').send(started).expect(202)).body;
    expect(replay.jobId).not.toBe(admitted.jobId);
    await recovered.command('editorial', { jobId: replay.jobId });
    const rejected = (await f.http(a).get(`/api/editorial/jobs/${replay.jobId}`).expect(200)).body;
    expect(rejected).toMatchObject({ status: 'failed', error: { status: 409, body: { code: 'generation_operation_consumed' } } });
    await f.http(a).get(`/api/editorial/jobs/${replay.jobId}/result`).expect(409);
    const ledger = await f.owner.query('select operation_id,status from billing_generation_operations where tenant_id=$1 and user_id=$2', [a.tenantId, a.userId]);
    expect(ledger.rows).toEqual([{ operation_id: started.requestIntent, status: 'started' }]);
    expect(workers.flatMap(w => w.events).filter(e => e.event === 'ai-started')).toHaveLength(startedCalls);
    expect(recovered.events.filter(e => e.event === 'ai-started')).toHaveLength(0);
    expect(boundaries.ai).not.toHaveBeenCalled();
    expect((await f.http(a).get('/api/drafts').expect(200)).body).toEqual([]);
  });
});