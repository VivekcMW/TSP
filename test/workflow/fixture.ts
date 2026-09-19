import { createHmac, randomUUID, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import Bull from 'bull';
import { vi, expect } from 'vitest';
import { resetBoundaries } from './boundaries';
import { validateWorkflowEnvironment } from './environment.mjs';

export type Actor = { tenantId: string; userId: string; cookie: string; keyword: string; articleUrl: string };

export async function createWorkflowFixture() {
  // Guard BEFORE importing any runtime database/auth/queue modules.
  const target = validateWorkflowEnvironment(process.env);
  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL || process.env.PGOPTIONS || process.env.DEV_AUTH_BYPASS || process.env.REDIS_URL) throw new Error('Use the isolated workflow runner');
  const owned: Actor[] = [];
  const workerErrors: unknown[] = [];
  let api: Server | undefined, redisChild: ChildProcess | undefined;
  let editorial: typeof import('../../server/jobs/editorial') | undefined;
  let queues: typeof import('../../server/jobs/queue') | undefined;
  let runtime: typeof import('../../server/db') | undefined;
  let redisModule: typeof import('../../server/lib/redis') | undefined;
  let control: Bull.Queue | undefined;
  const owner = new pg.Pool({ connectionString: process.env.OWNER_TEST_DATABASE_URL, max: 1 });
  const allowedPorts = new Set([target.port]);
  const blocked: string[] = [];
  const originalConnect = net.Socket.prototype.connect;
  const connectSpy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: any[]) {
    // Node's internal normalizeArgs passes [options, callback] as a single arg.
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (options.path || !['localhost', '127.0.0.1', '::1'].includes(options.host ?? 'localhost') || !allowedPorts.has(Number(options.port))) {
      blocked.push('socket'); throw new Error('Workflow outbound socket forbidden');
    }
    return Reflect.apply(originalConnect, this, args);
  });
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: any, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (u.hostname !== '127.0.0.1' || !api || Number(u.port) !== (api.address() as AddressInfo).port) {
      blocked.push('fetch'); throw new Error('Workflow outbound fetch forbidden');
    }
    return originalFetch(input, { ...init, redirect: 'error' });
  });

  async function cleanupActors() {
    while (owned.length) {
      const a = owned[0];
      const c = await owner.connect();
      try {
        await c.query('BEGIN');
        await c.query("select set_config('app.tenant_id', $1, true)", [a.tenantId]);
        // Explicit allowlist, exact UUID predicates, dependency order. No TRUNCATE.
        for (const table of ['publish_job_logs', 'draft_schedule_targets', 'draft_schedules', 'drafts', 'inbox_refresh_receipts', 'inbox_items', 'engine_run_logs', 'publication_resolutions', 'user_source_deletions', 'user_sources', 'publishing_rules', 'social_accounts', 'user_profiles', 'billing_generation_operations', 'subscriptions', 'billing_customers', 'tenant_members']) {
          await c.query(`delete from ${table} where tenant_id = $1`, [a.tenantId]);
        }
        await c.query('delete from email_preferences where user_id = $1', [a.userId]);
        await c.query('delete from tenants where id = $1', [a.tenantId]);
        await c.query('delete from users where id = $1', [a.userId]);
        await c.query('COMMIT');
        owned.shift();
      } catch (e) { await c.query('ROLLBACK'); throw e; }
      finally { c.release(); }
    }
  }
  async function closeApi() {
    if (!api?.listening) return;
    await new Promise<void>((ok, fail) => {
      api!.close(error => error ? fail(error) : ok());
      api!.closeAllConnections();
    });
  }
  async function close() {
    const errors: unknown[] = workerErrors;
    for (const release of [
      () => editorial?.closeEditorialJobs(), () => control?.close(), () => queues?.closeQueues(),
      () => redisModule?.redis?.disconnect(),
      closeApi,
      cleanupActors, () => runtime?.pool.end(), () => owner.end(),
      async () => {
        if (redisChild?.exitCode === null && redisChild.signalCode === null) {
          const exit = once(redisChild, 'exit'); redisChild.kill('SIGTERM'); await exit;
        }
      },
    ]) {
      try { await Promise.resolve(release()); } catch (error) { errors.push(error); }
    }
    connectSpy.mockRestore(); vi.unstubAllGlobals();
    delete process.env.REDIS_URL;
    if (errors.length) throw new AggregateError(errors, 'Workflow cleanup failed');
  }
  try {
    runtime = await import('../../server/db');
    const role = await runtime.pool.query('select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname=current_user');
    expect(role.rows[0]).toEqual({ name: 'tsp_app', rolsuper: false, rolbypassrls: false });
    const ledger = await owner.query('select filename, checksum from schema_migrations');
    const applied = new Map(ledger.rows.map(r => [r.filename, r.checksum]));
    const directory = resolve('migrations');
    for (const file of readdirSync(directory).filter(f => /^\d{4}_.*\.sql$/.test(f))) {
      expect(applied.get(file), `Pre-applied migration ${file}`).toBe(createHash('sha256').update(readFileSync(resolve(directory, file), 'utf8')).digest('hex').slice(0, 16));
    }
    expect(applied.has('0037_social_oauth_credentials.sql')).toBe(true);
    expect(applied.has('0038_repair_legacy_keyword_wrappers.sql')).toBe(true);
    const plans = await owner.query("select id from billing_plans where key='pro_monthly' and is_active=true");
    expect(plans.rowCount).toBe(1);
    expect((await owner.query("select enabled from platform_integrations where key='mastodon'")).rows[0]?.enabled).toBe(true);
    const binary = ['/opt/homebrew/bin/redis-server', '/usr/local/bin/redis-server', '/usr/bin/redis-server'].find(existsSync);
    if (!binary) throw new Error('Private redis-server prerequisite missing');
    const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>(ok => probe.close(() => ok())); allowedPorts.add(port);
    const password = randomUUID();
    redisChild = spawn(binary, ['--bind', '127.0.0.1', '--port', String(port), '--requirepass', password, '--save', '', '--appendonly', 'no'], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error('Private Redis startup timeout')), 5000);
      redisChild!.once('error', e => { clearTimeout(timer); fail(e); });
      redisChild!.once('exit', () => { clearTimeout(timer); fail(new Error('Private Redis exited')); });
      redisChild!.stdout!.on('data', data => { if (String(data).includes('Ready to accept connections')) { clearTimeout(timer); ok(); } });
    });
    process.env.REDIS_URL = `redis://:${password}@127.0.0.1:${port}`;
    redisModule = await import('../../server/lib/redis'); await redisModule.redis!.ping();
    queues = await import('../../server/jobs/queue');
    const inboxQueue = queues.initializeQueues()!;
    const { handleInboxRefresh } = await import('../../server/jobs/handlers/inbox-refresh');
    await inboxQueue.isReady();
    // Bull.process resolves when the worker stops, not when startup completes.
    void inboxQueue.process(1, handleInboxRefresh).catch(error => { workerErrors.push(error); });
    // Global pause before the real editorial worker starts. Tests decide when to
    // resume; no fake queue, work function or authorization injection.
    control = new Bull('editorial_generation', queues.queueOptions(process.env.REDIS_URL));
    await control.pause();
    editorial = await import('../../server/jobs/editorial'); editorial.initializeEditorialJobs();
    const app = express();
    const { toNodeHandler } = await import('better-auth/node');
    const { auth } = await import('../../server/authentication');
    app.all('/api/auth/*', toNodeHandler(auth)); app.use(express.json());
    (await import('../../server/routes/auth')).registerAuthRoutes(app);
    (await import('../../server/routes/profile')).registerProfileRoutes(app);
    (await import('../../server/routes/inbox')).registerInboxRoutes(app);
    (await import('../../server/routes/ai')).registerAiRoutes(app);
    (await import('../../server/routes/editorial-jobs')).registerEditorialJobsRoutes(app);
    (await import('../../server/routes/drafts')).registerDraftsRoutes(app);
    api = createServer(app); api.listen(0, '127.0.0.1'); await once(api, 'listening');
    const portApi = (api.address() as AddressInfo).port; allowedPorts.add(portApi);
    const storage = (await import('../../server/storage')).storage;
    const { handlePublishDraft } = await import('../../server/jobs/handlers/publish-draft');

    async function actor() {
      const a: Actor = { userId: randomUUID(), tenantId: randomUUID(), cookie: '', keyword: `latency${randomUUID().replaceAll('-', '')}`, articleUrl: `https://research.test/pilot/${randomUUID()}` };
      owned.push(a);
      const token = randomUUID();
      await owner.query('insert into users(id,email,name,email_verified) values($1,$2,$3,true)', [a.userId, `${a.userId}@example.invalid`, 'Workflow Person']);
      await owner.query("insert into tenants(id,name,kind,status) values($1,'Workflow fixture','personal','active')", [a.tenantId]);
      await owner.query("insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')", [a.tenantId, a.userId]);
      await owner.query("insert into sessions(id,user_id,token,expires_at) values($1,$2,$3,now()+interval '1 hour')", [randomUUID(), a.userId, token]);
      const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(token).digest('base64');
      a.cookie = 'better-auth.session_token=' + encodeURIComponent(`${token}.${signature}`);
      resetBoundaries(a.keyword, a.articleUrl);
      return a;
    }
    const http = (a: Actor) => ({
      get: (url: string) => request(api!).get(url).set('Cookie', a.cookie).set('x-tenant-id', a.tenantId),
      post: (url: string) => request(api!).post(url).set('Cookie', a.cookie).set('x-tenant-id', a.tenantId),
      patch: (url: string) => request(api!).patch(url).set('Cookie', a.cookie).set('x-tenant-id', a.tenantId),
      put: (url: string) => request(api!).put(url).set('Cookie', a.cookie).set('x-tenant-id', a.tenantId),
      delete: (url: string) => request(api!).delete(url).set('Cookie', a.cookie).set('x-tenant-id', a.tenantId),
    });
    async function paid(a: Actor) {
      const c = await owner.connect();
      try {
        await c.query('BEGIN'); await c.query("select set_config('app.tenant_id',$1,true)", [a.tenantId]);
        const customer = await c.query('insert into billing_customers(tenant_id,razorpay_customer_id,email,name) values($1,$2,$3,$4) returning id', [a.tenantId, `fixture_${a.userId}`, `${a.userId}@example.invalid`, 'Workflow']);
        await c.query("insert into subscriptions(tenant_id,billing_customer_id,plan_id,status,current_period_start,current_period_end) values($1,$2,$3,'active',now()-interval '1 day',now()+interval '1 day')", [a.tenantId, customer.rows[0].id, plans.rows[0].id]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      await storage.createSocialAccount(a, { provider: 'mastodon', providerAccountId: 'https://instance.test', accessToken: 'fixture-only-token', isActive: true, scopes: [] });
    }
    return { app, api, owner, runtime, control, editorial, queues, storage, handlePublishDraft, http, actor, paid, cleanupActors, close, blocked,
      origin: `http://127.0.0.1:${portApi}` };
  } catch (e) { await close(); throw e; }
}
export type WorkflowFixture = Awaited<ReturnType<typeof createWorkflowFixture>>;