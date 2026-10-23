import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { adminQuotaGrants } from "@shared/schema";
import { tenantBilling, type BillingTransaction } from "./billing-repository";
import { quotaGrantSchema, validControlExpiry } from "@shared/admin-controls";

export class AdminControlConflict extends Error {}

export async function activeQuotaAdditional(tx: BillingTransaction, tenantId: string, now: Date): Promise<number> {
  const [row] = await tx.select({ additional: sql<string>`coalesce(sum(${adminQuotaGrants.additional}), 0)::text` })
    .from(adminQuotaGrants).where(and(eq(adminQuotaGrants.tenantId, tenantId), gt(adminQuotaGrants.expiresAt, now), isNull(adminQuotaGrants.revokedAt)));
  const additional = Number(row?.additional);
  if (!row || !Number.isSafeInteger(additional) || additional < 0 || additional > 1000) throw new Error("Quota grant total unavailable");
  return additional;
}
export async function listQuotaGrants(tenantId: string) {
  return tenantBilling(tenantId, tx => tx.select().from(adminQuotaGrants).where(eq(adminQuotaGrants.tenantId, tenantId))
    .orderBy(sql`${adminQuotaGrants.createdAt} desc`, adminQuotaGrants.id).limit(50));
}
export async function grantQuota(tenantId: string, actorId: string, reason: string, input: unknown) {
  const data = quotaGrantSchema.parse(input);
  return tenantBilling(tenantId, async tx => {
    const [existing] = await tx.select().from(adminQuotaGrants).where(and(eq(adminQuotaGrants.tenantId, tenantId), eq(adminQuotaGrants.id, data.operationId)));
    if (existing) {
      if (existing.additional !== data.additional || existing.expiresAt.toISOString() !== new Date(data.expiresAt).toISOString() || existing.createdBy !== actorId) {
        throw new AdminControlConflict("Operation ID is already bound to another grant");
      }
      return existing;
    }
    const time = await tx.execute(sql`select clock_timestamp() as now`);
    const now = new Date(time.rows[0].now as string | Date);
    if (!validControlExpiry(data.expiresAt, now.getTime())) throw new AdminControlConflict("Expiry must be in the next 30 days");
    const active = await activeQuotaAdditional(tx, tenantId, now);
    if (active + data.additional > 1000) throw new AdminControlConflict("Active additional allowance cannot exceed 1000");
    const [created] = await tx.insert(adminQuotaGrants).values({ id: data.operationId, tenantId, additional: data.additional,
      createdBy: actorId, reason, createdAt: now, expiresAt: new Date(data.expiresAt) }).returning();
    if (!created) throw new Error("Quota grant not persisted");
    return created;
  });
}
export async function revokeQuota(tenantId: string, id: string) {
  return tenantBilling(tenantId, async tx => {
    const [row] = await tx.update(adminQuotaGrants).set({ revokedAt: new Date() })
      .where(and(eq(adminQuotaGrants.tenantId, tenantId), eq(adminQuotaGrants.id, id), isNull(adminQuotaGrants.revokedAt))).returning();
    if (row) return row;
    const [existing] = await tx.select().from(adminQuotaGrants).where(and(eq(adminQuotaGrants.tenantId, tenantId), eq(adminQuotaGrants.id, id)));
    return existing ?? null;
  });
}
