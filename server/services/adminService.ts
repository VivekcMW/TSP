import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { tenants, tenantMembers, auditLog } from "@shared/models/tenancy";
import { users } from "@shared/models/auth";
import { inboxItems, drafts, engineRunLogs, draftSchedules, publishJobLogs, type EngineRunLog } from "@shared/schema";
import { getInboxRefreshQueue, getPublishDraftQueue, getQueueHealth } from "../jobs/queue";

/**
 * Cross-tenant reads for the Super Admin surface.
 *
 * `tenants`/`tenant_members`/`users`/`audit_log` carry no Row-Level Security
 * policy (see migrations/0002_rls.sql) and can be queried directly. But
 * `inbox_items`/`drafts`/`engine_run_logs` are FORCE RLS with a strict
 * `tenant_id = current_setting('app.tenant_id')` policy — there is no
 * platform-role bypass at the database layer, by design (the tenant-scoped
 * repository is isolation layer 1; this is layer 2 holding even for an admin
 * connection). Reading across tenants for those tables means setting
 * app.tenant_id once per tenant and unioning the results in application code.
 *
 * This is an N-queries-per-request cost, acceptable at the current tenant
 * count. The fix if it stops being acceptable is a dedicated read-replica
 * view or a materialized rollup table — not a bypass policy.
 */

async function withTenantRls<T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(`select set_config('app.tenant_id', '${tenantId.replaceAll("'", "''")}', true)`);
    return fn(tx);
  });
}

export async function listTenants(limit = 200) {
  return db
    .select({
      id: tenants.id,
      kind: tenants.kind,
      name: tenants.name,
      status: tenants.status,
      createdAt: tenants.createdAt,
      memberCount: count(tenantMembers.userId),
    })
    .from(tenants)
    .leftJoin(tenantMembers, eq(tenantMembers.tenantId, tenants.id))
    .groupBy(tenants.id)
    .orderBy(desc(tenants.createdAt))
    .limit(limit);
}

export async function listUsers(limit = 200) {
  return db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      industry: users.industry,
      platformRole: users.platformRole,
      registrationCompleted: users.registrationCompleted,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

export async function listAuditLog(limit = 200) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}

export async function getPlatformUsage() {
  const allTenants = await db.select({ id: tenants.id }).from(tenants);

  const [[{ value: tenantCount }], [{ value: userCount }]] = await Promise.all([
    db.select({ value: count() }).from(tenants),
    db.select({ value: count() }).from(users),
  ]);

  const perTenant = await Promise.all(
    allTenants.map((t) =>
      withTenantRls(t.id, async (tx) => {
        const [inboxCount] = await tx.select({ value: count() }).from(inboxItems).where(eq(inboxItems.tenantId, t.id));
        const [draftCount] = await tx.select({ value: count() }).from(drafts).where(eq(drafts.tenantId, t.id));
        const [runCount] = await tx.select({ value: count() }).from(engineRunLogs).where(eq(engineRunLogs.tenantId, t.id));
        return {
          inboxItems: inboxCount.value,
          drafts: draftCount.value,
          engineRuns: runCount.value,
        };
      }),
    ),
  );

  return {
    tenants: tenantCount,
    users: userCount,
    inboxItems: perTenant.reduce((sum, t) => sum + t.inboxItems, 0),
    drafts: perTenant.reduce((sum, t) => sum + t.drafts, 0),
    engineRuns: perTenant.reduce((sum, t) => sum + t.engineRuns, 0),
  };
}

export async function listEngineRunsAcrossTenants(limit = 50): Promise<EngineRunLog[]> {
  const allTenants = await db.select({ id: tenants.id }).from(tenants);

  const perTenant = await Promise.all(
    allTenants.map((t) =>
      withTenantRls(t.id, (tx) =>
        tx
          .select()
          .from(engineRunLogs)
          .where(eq(engineRunLogs.tenantId, t.id))
          .orderBy(desc(engineRunLogs.startedAt))
          .limit(limit),
      ),
    ),
  );

  return perTenant
    .flat()
    .sort((a, b) => (b.startedAt ? new Date(b.startedAt).getTime() : 0) - (a.startedAt ? new Date(a.startedAt).getTime() : 0))
    .slice(0, limit);
}

export async function getEngineRunById(id: string, tenantId: string): Promise<EngineRunLog | undefined> {
  return withTenantRls(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(engineRunLogs)
      .where(and(eq(engineRunLogs.id, id), eq(engineRunLogs.tenantId, tenantId)));
    return row;
  });
}

export async function getPlatformMonitoring() {
  const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const overdueCutoff = new Date(Date.now() - 5 * 60 * 1000);
  const tenantResults = await Promise.all(allTenants.map((tenant) => withTenantRls(tenant.id, async (tx) => {
    const schedules = await tx.select().from(draftSchedules).where(eq(draftSchedules.tenantId, tenant.id));
    const failures = await tx.select().from(publishJobLogs).where(and(eq(publishJobLogs.tenantId, tenant.id), eq(publishJobLogs.status, "failed"))).orderBy(desc(publishJobLogs.startedAt)).limit(10);
    const engineFailures = await tx.select().from(engineRunLogs).where(and(eq(engineRunLogs.tenantId, tenant.id), eq(engineRunLogs.status, "failed"))).orderBy(desc(engineRunLogs.startedAt)).limit(10);
    return { tenant, schedules, failures, engineFailures };
  })));

  const queue = await getQueueHealth();
  const [inboxCounts, publishCounts] = await Promise.all([
    getInboxRefreshQueue()?.getJobCounts() ?? Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 }),
    getPublishDraftQueue()?.getJobCounts() ?? Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 }),
  ]);
  const recentFailures = tenantResults.flatMap(({ tenant, failures }) => failures.map((failure) => ({ ...failure, tenantName: tenant.name })));
  const engineFailures = tenantResults.flatMap(({ tenant, engineFailures }) => engineFailures.map((failure) => ({ ...failure, tenantName: tenant.name })));
  const schedules = tenantResults.flatMap(({ schedules }) => schedules);
  const sortedRecentFailures = recentFailures.toSorted((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));
  const sortedEngineFailures = engineFailures.toSorted((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));
  return {
    generatedAt: new Date().toISOString(),
    tenantCount: allTenants.length,
    queue,
    scheduler: { enabled: process.env.BACKGROUND_JOBS_ENABLED === "true", designated: process.env.CRON_SCHEDULER === "true" },
    jobs: { inbox: inboxCounts, publishing: publishCounts },
    scheduled: schedules.filter((schedule) => ["scheduled", "queued"].includes(schedule.status)).length,
    publishing: schedules.filter((schedule) => schedule.status === "publishing").length,
    failed: schedules.filter((schedule) => schedule.status === "failed").length,
    overdue: schedules.filter((schedule) => ["scheduled", "queued"].includes(schedule.status) && schedule.scheduledPublishAt < overdueCutoff).length,
    recentFailures: sortedRecentFailures.slice(0, 25),
    engineFailures: sortedEngineFailures.slice(0, 25),
  };
}
