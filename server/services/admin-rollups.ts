import { count, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { tenants, adminTenantRollups, inboxItems, drafts, engineRunLogs, draftSchedules } from "@shared/schema";

export async function collectTenantRollup(tenantId: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`select set_config('statement_timeout', '10000', true)`);
    const result = await tx.execute<{ inboxItems: number; drafts: number; engineRuns: number; failedSchedules: number }>(sql`select
      (select count(*)::int from ${inboxItems} where ${inboxItems.tenantId}=${tenantId}) as "inboxItems",
      (select count(*)::int from ${drafts} where ${drafts.tenantId}=${tenantId}) as drafts,
      (select count(*)::int from ${engineRunLogs} where ${engineRunLogs.tenantId}=${tenantId}) as "engineRuns",
      (select count(*)::int from ${draftSchedules} where ${draftSchedules.tenantId}=${tenantId} and ${draftSchedules.status}='failed') as "failedSchedules"`);
    const row = result.rows[0];
    if (!row || [row.inboxItems, row.drafts, row.engineRuns, row.failedSchedules].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("Invalid rollup measurement");
    const values = { tenantId, ...row, observedAt: new Date() };
    await tx.insert(adminTenantRollups).values(values).onConflictDoUpdate({ target: adminTenantRollups.tenantId, set: values });
    return values;
  });
}
export async function collectAdminRollups(assertConnected: () => Promise<void> = async () => undefined) {
  let cursor: string | undefined;
  let collected = 0, failed = 0;
  for (;;) {
    const page = await db.select({ id: tenants.id }).from(tenants).where(cursor ? gt(tenants.id, cursor) : undefined).orderBy(tenants.id).limit(100);
    if (!page.length) break;
    for (let offset = 0; offset < page.length; offset += 4) {
      await assertConnected();
      const results = await Promise.allSettled(page.slice(offset, offset + 4).map(row => collectTenantRollup(row.id)));
      for (const result of results) {
        if (result.status === "fulfilled") collected++;
        else { failed++; console.error("[admin:rollups] Workspace collection unavailable; prior observation retained"); }
      }
    }
    cursor = page[page.length - 1].id;
  }
  if (failed) throw new Error(`Rollup collection incomplete: ${failed} workspaces unavailable`);
  return { collected };
}
export async function listAdminRollups(page: number) {
  const rows = await db.select({ tenantId: tenants.id, name: tenants.name, inboxItems: adminTenantRollups.inboxItems,
    drafts: adminTenantRollups.drafts, engineRuns: adminTenantRollups.engineRuns, failedSchedules: adminTenantRollups.failedSchedules,
    observedAt: adminTenantRollups.observedAt }).from(tenants).leftJoin(adminTenantRollups, eq(adminTenantRollups.tenantId, tenants.id))
    .orderBy(tenants.id).limit(26).offset((page - 1) * 25);
  const [total] = await db.select({ value: count() }).from(tenants);
  if (!total) throw new Error("Rollup directory total unavailable");
  return { items: rows.slice(0, 25), hasMore: rows.length > 25, page, total: total.value, staleAfterMinutes: 30 };
}
