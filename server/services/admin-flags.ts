import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { adminFlagHistory, featureFlags } from "@shared/schema";
import { flagPolicySchema, validControlExpiry } from "@shared/admin-controls";
import { AdminControlConflict } from "./admin-quotas";
import { clearFeatureFlagCache } from "./featureFlags";

export async function mutateFlag(id: string, actorId: string, reason: string,
  change: { operation: "toggle"; enabled: boolean; revision: number } | { operation: "policy"; policy: unknown } | { operation: "delete"; revision: number }) {
  const result = await db.transaction(async tx => {
    const [row] = await tx.select().from(featureFlags).where(eq(featureFlags.id, id)).for("update");
    if (!row) return null;
    const policy = change.operation === "policy" ? flagPolicySchema.parse(change.policy) : null;
    const revision = policy ? policy.revision : change.operation !== "policy" ? change.revision : 0;
    if (row.revision !== revision) throw new AdminControlConflict("Flag changed. Refresh its revision before acting.");
    if (policy && !validControlExpiry(policy.expiresAt)) throw new AdminControlConflict("Flag expiry must be within the next 30 days");
    if (change.operation === "toggle" && change.enabled && (!row.owner || !row.expiresAt || row.expiresAt.getTime() <= Date.now())) {
      throw new AdminControlConflict("Set a current owner and expiry before enabling");
    }
    const next = change.operation === "delete" ? null : {
      ...(policy ? { owner: policy.owner, expiresAt: new Date(policy.expiresAt), tenantIds: policy.tenantIds } : {}),
      ...(change.operation === "toggle" ? { enabled: change.enabled } : {}), revision: row.revision + 1, updatedAt: new Date(),
    };
    await tx.insert(adminFlagHistory).values({ flagKey: row.key, actorId, reason, operation: change.operation,
      snapshot: { before: row, after: next ? { ...row, ...next } : null } });
    if (!next) { await tx.delete(featureFlags).where(eq(featureFlags.id, id)); return { deleted: true }; }
    const [updated] = await tx.update(featureFlags).set(next).where(eq(featureFlags.id, id)).returning();
    return updated;
  });
  clearFeatureFlagCache();
  return result;
}
export function flagHistory(key: string) {
  return db.select().from(adminFlagHistory).where(eq(adminFlagHistory.flagKey, key)).orderBy(desc(adminFlagHistory.createdAt), adminFlagHistory.id).limit(50);
}
