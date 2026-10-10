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

interface CacheEntry { value: boolean; expiresAt: number }
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

export async function isFeatureEnabled(key: string, fallback = true): Promise<boolean> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [row] = await db.select({ enabled: featureFlags.enabled }).from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  const value = row?.enabled ?? fallback;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Test-only: avoid a stale cached value leaking across cases that toggle the same key. */
export function clearFeatureFlagCache(): void {
  cache.clear();
}
