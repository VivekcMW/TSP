import { z } from "zod";

export const quotaGrantSchema = z.object({
  operationId: z.string().uuid(),
  additional: z.number().int().min(1).max(1000),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export const flagPolicySchema = z.object({
  owner: z.string().trim().email().max(254),
  expiresAt: z.string().datetime({ offset: true }),
  tenantIds: z.array(z.string().uuid()).max(100).refine(ids => new Set(ids).size === ids.length, "Remove duplicate tenants"),
  revision: z.number().int().positive(),
}).strict();
export const incidentTransitionSchema = z.object({
  state: z.enum(["acknowledged", "resolved"]),
  version: z.number().int().positive(),
}).strict();
export function validControlExpiry(value: string, now = Date.now()): boolean {
  const expiry = Date.parse(value);
  return Number.isFinite(expiry) && expiry > now && expiry <= now + 30 * 86_400_000;
}
export type AdminFlagPolicy = z.infer<typeof flagPolicySchema>;
export interface AdminJobRecord {
  id: string; queue: "inbox" | "publishing"; state: string; tenantId: string; userId: string | null;
  attemptsMade: number; createdAt: string; finishedAt: string | null; recoveryEligible: boolean; operationId: string | null;
}
export interface AdminIncident {
  id: string; signal: string; severity: string; state: "open" | "acknowledged" | "resolved"; summary: string;
  lastSeenAt: string; version: number;
}
export interface AdminQuotaGrant {
  id: string; additional: number; reason: string; createdBy: string; expiresAt: string; revokedAt: string | null;
}
export interface AdminOperationalHealth {
  generatedAt: string;
  queue: { configured: boolean; reachable: boolean; queuesReady: boolean };
  workers: { available: boolean; inbox: number | null; publishing: number | null };
  expected: boolean;
  ages: Record<"inbox" | "publishing", { available: boolean; oldestMs: number | null; scanned: number; complete: boolean }> | null;
}
export interface AdminTenantInsights {
  generatedAt: string; windowStart: string;
  generation: { status: string; count: number }[];
  payments: { status: string; currency: string; count: number; minorUnits: string }[];
  ai: { provider: string; model: string | null; outcome: string; count: number; tokenObserved: number;
    inputTokens: string | null; outputTokens: string | null; costObserved: number; providerCostUsd: string | null; averageMs: number }[];
  sourceStates: { active: boolean; status: string | null; count: number; lastFetchedAt: string | null }[];
  content: { articles: number; canonicalIdentified: number; distinctCanonicals: number; qualityMeasured: number; averageRelevance: string | null; fresh: number };
  feedback: { event: string; count: number }[] | null;
}
