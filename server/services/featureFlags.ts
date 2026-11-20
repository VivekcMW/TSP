import { eq } from "drizzle-orm";
import { db } from "../db";
import { featureFlags } from "@shared/schema";

/**
 * Reads for `feature_flags` rows that the admin CRUD UI (server/routes/admin.ts)
 * already writes. Previously nothing in the app ever read these — toggling a
 * flag had zero runtime effect. This is the first real consumer.
 *
 * A missing row resolves to `fallback` (default enabled): these flags are
 * meant as off-switches for already-shipped features (an operator can disable
 * one without a deploy), not opt-in launch gates — so an unconfigured flag
 * must never silently turn a feature off.
 */

interface FlagRow { enabled: boolean; expiresAt?: Date | null; tenantIds?: string[] }
interface CacheEntry { row: FlagRow | undefined; expiresAt: number }
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

export function evaluateFlag(row: FlagRow | undefined, fallback: boolean, tenantId?: string, now = Date.now()): boolean {
  if (!row) return fallback;
  if (!row.enabled || (row.expiresAt && row.expiresAt.getTime() <= now)) return false;
  return !row.tenantIds?.length || (!!tenantId && row.tenantIds.includes(tenantId));
}
export async function isFeatureEnabled(key: string, fallback = true, tenantId?: string): Promise<boolean> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return evaluateFlag(cached.row, fallback, tenantId);
  const [row] = await db.select({ enabled: featureFlags.enabled, expiresAt: featureFlags.expiresAt, tenantIds: featureFlags.tenantIds })
    .from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  if (cache.size >= 256) cache.clear();
  cache.set(key, { row, expiresAt: Date.now() + CACHE_TTL_MS });
  return evaluateFlag(row, fallback, tenantId);
}

/** Test-only: avoid a stale cached value leaking across cases that toggle the same key. */
export function clearFeatureFlagCache(): void {
  cache.clear();
}
