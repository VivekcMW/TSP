import express, { type Request } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser(req: Request, _res: express.Response, next: express.NextFunction) {
    req.dbUser = { id: "acceptance-actor", email: "hello@thesocialpundit.com", emailVerified: true, platformRole: "platform_admin" } as Request["dbUser"];
    req.tenant = { tenantId: req.get("x-tenant-id") ?? tenant, userId: "acceptance-actor", role: "owner",
      platformRole: "platform_admin", viaPlatformRole: !!req.get("x-tenant-id") } as Request["tenant"]; next();
  },
}));
vi.mock("../lib/redis", () => ({ redis: undefined }));
import { pool } from "../db";
import { ownerPool } from "../../test/db-owner";
import { registerAdminRecordRoutes } from "./admin-records";
import { registerAdminTenantRoutes } from "./admin-tenants";
import { registerAdminOperationRoutes } from "./admin-operations";
import { mutateFlag } from "../services/admin-flags";
import { isFeatureEnabled } from "../services/featureFlags";
import { reserveGeneration } from "../services/generation-quota";
import { synchronizeIncidents, transitionIncident } from "../services/admin-incidents";
import { collectAdminRollups } from "../services/admin-rollups";
import { recordAIAttempt } from "../services/ai-observations";

const enabled = process.env.ADMIN_ACCEPTANCE_ENABLED === "true";
const app = express(); app.use(express.json()); registerAdminRecordRoutes(app); registerAdminTenantRoutes(app); registerAdminOperationRoutes(app);
let tenant: string, flag: string;
beforeAll(async () => {
  if (!enabled) return;
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/tsp_admin_acceptance_[0-9a-f]{16}_test$/.test(url.pathname) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Acceptance refuses any database not created by its disposable wrapper");
  }
  await ownerPool.query(`insert into users(id,name,email,email_verified) values ('acceptance-actor','Acceptance actor','acceptance-actor@example.invalid',true)`);
  const tenants = await ownerPool.query<{ id: string }>(`insert into tenants(kind,name,status) select 'corporate','Acceptance workspace '||n,'active' from generate_series(1,100) n returning id`);
  tenant = tenants.rows[0].id;
  await ownerPool.query(`insert into tenant_members(tenant_id,user_id,role) select id,'acceptance-actor','owner' from tenants`);
  await ownerPool.query(`insert into email_deliveries(id,user_id,recipient,type,status,created_at)
    select 'acceptance-email-'||n,'acceptance-actor','reader'||n||'@example.invalid','daily_digest',case when n%2=0 then 'sent' else 'unknown' end, now()-(n||' seconds')::interval from generate_series(1,10000) n`);
  await ownerPool.query(`insert into audit_log(action,actor_user_id,tenant_id,resource_type,resource_id,justification)
    select 'acceptance.read','acceptance-actor',$1,'GET','/acceptance/'||n,'Disposable benchmark fixture' from generate_series(1,10000) n`, [tenant]);
  const flags = await ownerPool.query<{ id: string }>(`insert into feature_flags(key,enabled,owner,expires_at) values ('team_workspaces',false,'hello@thesocialpundit.com',now()+interval '1 day') returning id`);
  flag = flags.rows[0].id;
}, 90_000);
afterAll(async () => { if (enabled) { await pool.end(); await ownerPool.end(); } });
describe.skipIf(!enabled)("disposable local admin database and API acceptance", () => {
  it("preserves real FORCE RLS on grant/AI records and atomically enforces a saved extra allowance", async () => {
    const roles = await pool.query("select current_user");
    expect(roles.rows[0].current_user).toBe("tsp_app");
    const intent = randomUUID();
    const body = { operationId: intent, additional: 2, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    const grant = () => request(app).post(`/api/admin/operations/quotas/${tenant}`).set("x-tenant-id", tenant).set("x-access-reason", "Disposable grant acceptance").send(body);
    await grant().expect(200); await grant().expect(200);
    const persisted = await ownerPool.query("select count(*)::int as total from admin_quota_grants where tenant_id=$1", [tenant]);
    expect(persisted.rows[0].total).toBe(1);
    expect((await pool.query("select count(*)::int as total from admin_quota_grants")).rows[0].total).toBe(0);
    const old = process.env.PLAN_LIMITS_ENABLED; process.env.PLAN_LIMITS_ENABLED = "true";
    try {
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => reserveGeneration({ tenantId: tenant, userId: "acceptance-actor" }, randomUUID(), "manual", "a".repeat(64))));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(5);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    } finally { if (old === undefined) delete process.env.PLAN_LIMITS_ENABLED; else process.env.PLAN_LIMITS_ENABLED = old; }
    await request(app).post(`/api/admin/operations/quotas/${tenant}/${intent}/revoke`).set("x-tenant-id", tenant)
      .set("x-access-reason", "Revoke disposable allowance").send({ confirm: true }).expect(200);
    await expect(reserveGeneration({ tenantId: tenant, userId: "acceptance-actor" }, randomUUID(), "manual", "a".repeat(64))).rejects.toMatchObject({ code: "generation_quota_exceeded" });
  }, 30_000);
  it("commits rollout history with revision fencing and enforces real tenant targeting", async () => {
    const policy = { owner: "hello@thesocialpundit.com", expiresAt: new Date(Date.now() + 3600_000).toISOString(), tenantIds: [tenant], revision: 1 };
    await mutateFlag(flag, "acceptance-actor", "Targeted acceptance rollout", { operation: "policy", policy });
    await expect(mutateFlag(flag, "acceptance-actor", "Stale revision", { operation: "toggle", enabled: true, revision: 1 })).rejects.toThrow("Flag changed");
    await mutateFlag(flag, "acceptance-actor", "Enable scoped acceptance rollout", { operation: "toggle", enabled: true, revision: 2 });
    expect(await isFeatureEnabled("team_workspaces", true, tenant)).toBe(true);
    expect(await isFeatureEnabled("team_workspaces", true, randomUUID())).toBe(false);
    expect((await ownerPool.query("select count(*)::int as total from admin_flag_history")).rows[0].total).toBe(2);
  });
  it("reads scoped insights against actual migrated SQL without inventing absent AI costs", async () => {
    const response = await request(app).get(`/api/admin/operations/insights/${tenant}`).set("x-tenant-id", tenant).set("x-access-reason", "Inspect disposable measurements").expect(200);
    expect(response.body).toMatchObject({ ai: [], payments: [], feedback: [], content: { articles: 0 } });
    await synchronizeIncidents();
    await recordAIAttempt({ tenantId: tenant, provider: "openrouter", model: "openai/gpt-4o-mini", outcome: "succeeded",
      inputTokens: 12, outputTokens: 3, providerCostUsd: 0.0012, durationMs: 50 });
    expect((await pool.query("select count(*)::int as total from ai_attempt_observations")).rows[0].total).toBe(0);
    const observed = await request(app).get(`/api/admin/operations/insights/${tenant}`).set("x-tenant-id", tenant).set("x-access-reason", "Verify isolated observations").expect(200);
    expect(observed.body.ai[0]).toMatchObject({ tokenObserved: 1, costObserved: 1, inputTokens: "12", outputTokens: "3", providerCostUsd: "0.0012000000" });
  });
  it("persists and fences incident acknowledgment/resolution and reopens an active signal", async () => {
    const oldMode = process.env.NODE_ENV, oldJobs = process.env.BACKGROUND_JOBS_ENABLED;
    process.env.NODE_ENV = "production"; process.env.BACKGROUND_JOBS_ENABLED = "true";
    try {
      await synchronizeIncidents(); await synchronizeIncidents();
      const rows = await ownerPool.query("select id,version,state from admin_incidents where signal='queue:unavailable'");
      expect(rows.rows).toHaveLength(1); expect(rows.rows[0].state).toBe("open");
      const incident = rows.rows[0];
      const acknowledged = await transitionIncident(incident.id, "acknowledged", incident.version, "acceptance-actor", "Investigating queue outage");
      await expect(transitionIncident(incident.id, "resolved", incident.version, "acceptance-actor", "Stale operator view")).rejects.toThrow("Incident changed");
      await transitionIncident(incident.id, "resolved", acknowledged.version, "acceptance-actor", "Reviewed mitigation");
      const history = await ownerPool.query("select action from audit_log where resource_id=$1 order by created_at", [incident.id]);
      expect(history.rows.map(row => row.action)).toEqual(["incident.acknowledged", "incident.resolved"]);
      await synchronizeIncidents();
      const reopened = await ownerPool.query("select state from admin_incidents where id=$1", [incident.id]);
      expect(reopened.rows[0].state).toBe("open");
    } finally { process.env.NODE_ENV = oldMode; process.env.BACKGROUND_JOBS_ENABLED = oldJobs; }
  });
  it("collects 100 count-only workspace rollups with isolated reads and serves absent measurements explicitly", async () => {
    const initial = await request(app).get("/api/admin/operations/rollups").expect(200);
    expect(initial.body.items[0]).toMatchObject({ inboxItems: null, observedAt: null });
    await ownerPool.query("insert into engine_run_logs(tenant_id,user_id,industry,status) values ($1,'acceptance-actor','other','success')", [tenant]);
    expect(await collectAdminRollups()).toEqual({ collected: 100 });
    const isolated = await ownerPool.query("select tenant_id,engine_runs from admin_tenant_rollups");
    expect(isolated.rows.find(row => row.tenant_id === tenant).engine_runs).toBe(1);
    expect(isolated.rows.filter(row => row.tenant_id !== tenant).every(row => row.engine_runs === 0)).toBe(true);
    const measured = await request(app).get("/api/admin/operations/rollups").expect(200);
    expect(measured.body).toMatchObject({ total: 100, hasMore: true });
    expect(measured.body.items).toHaveLength(25);
    expect(measured.body.items[0]).toMatchObject({ inboxItems: 0, drafts: 0, engineRuns: expect.any(Number), failedSchedules: 0 });
  });
  it("meets the one-second p95 budget on actual paginated routes with 100 tenants and 10000 audit/email records", async () => {
    const endpoints = ["/api/admin/tenant-directory?page=4", "/api/admin/users-directory?q=Acceptance",
      "/api/admin/audit-directory?page=200", "/api/admin/email-directory?page=200&status=unknown", "/api/admin/operations/rollups?page=4"];
    const metrics = [];
    for (const endpoint of endpoints) {
      const samples: number[] = [];
      await request(app).get(endpoint).expect(200);
      for (let index = 0; index < 25; index++) {
        const start = performance.now();
        const response = await request(app).get(endpoint).expect(200);
        samples.push(performance.now() - start);
        if (endpoint.includes("rollups")) expect(response.body.page).toBe(4);
        else expect(response.body.pageSize).toBe(25);
        expect(response.body.items.length).toBeLessThanOrEqual(25);
        expect(response.body.total).toBeGreaterThan(0);
        expect(response.headers["cache-control"]).toBe("no-store");
      }
      samples.sort((a,b) => a-b);
      const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
      metrics.push({ endpoint, samples: samples.length, p95Ms: Math.round(p95 * 100) / 100 });
      expect(p95, endpoint).toBeLessThan(1000);
    }
    const report = { generatedAt: new Date().toISOString(), tenants: 100, emailRecords: 10000, auditRecords: 10000,
      authentication: "stubbed fixture identity; real permission and audit middleware", productionCertification: false, metrics };
    console.log(`ADMIN_LOCAL_ACCEPTANCE ${JSON.stringify(report)}`);
    if (process.env.ADMIN_ACCEPTANCE_REPORT) writeFileSync(process.env.ADMIN_ACCEPTANCE_REPORT, JSON.stringify(report, null, 2));
  }, 90_000);
});
