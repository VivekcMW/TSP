import type { BillingPlan, Subscription } from "@shared/schema";
import { readEntitlementState, type BillingTransaction } from "./billing-repository";

export interface TenantEntitlements {
  planKey: string;
  planName: string;
  status: string;
  canPublish: boolean;
  canSchedule: boolean;
  canUseAnalytics: boolean;
  maxDailyGenerations: number | null;
  currentPeriodEnd: Date | null;
  currentPeriodStart?: Date | null;
}

// Only actual catalog keys (seeded by 0014 and 0039) are mapped. Price is NOT a
// tier: every Pro billing interval and currency grants the same Pro access.
const PRO = { canPublish: true, canSchedule: true, canUseAnalytics: true, maxDailyGenerations: null };
const TIERS: Record<string, Pick<TenantEntitlements, "canPublish" | "canSchedule" | "canUseAnalytics" | "maxDailyGenerations">> = {
  free: { canPublish: false, canSchedule: false, canUseAnalytics: false, maxDailyGenerations: 3 },
  pro_monthly: PRO,
  pro_yearly: PRO,
  pro_monthly_inr: PRO,
  pro_yearly_inr: PRO,
};
const denied = { canPublish: false, canSchedule: false, canUseAnalytics: false, maxDailyGenerations: 0 };

export function subscriptionIsActive(status: string | null | undefined, currentPeriodEnd?: Date | null, now = new Date(), currentPeriodStart?: Date | null): boolean {
  return status === "active" && !!currentPeriodEnd && currentPeriodEnd.getTime() > now.getTime()
    && (!currentPeriodStart || currentPeriodStart.getTime() <= now.getTime());
}

export function resolveTenantEntitlements(plans: BillingPlan[], rows: Subscription[], now = new Date()): TenantEntitlements {
  const current = rows.find(row => row.currentPeriodStart && subscriptionIsActive(row.status, row.currentPeriodEnd, now, row.currentPeriodStart));
  const plan = current ? plans.find(candidate => candidate.id === current.planId) : plans.find(candidate => candidate.key === "free" && candidate.isActive && candidate.amount === 0);
  let limits = plan?.isActive && Object.hasOwn(TIERS, plan.key) ? TIERS[plan.key] : denied;
  // PLAN_LIMITS_ENABLED=false gives Free accounts Pro access (a temporary, all-access period).
  // A missing or inactive catalog still denies access.
  if (limits === TIERS.free && process.env.PLAN_LIMITS_ENABLED === "false") limits = PRO;
  return {
    planKey: plan?.key ?? "unavailable", planName: plan?.name ?? "Unavailable",
    status: current?.status ?? (plan ? "free" : "unavailable"),
    ...limits, currentPeriodStart: current?.currentPeriodStart ?? null, currentPeriodEnd: current?.currentPeriodEnd ?? null,
  };
}

export async function getTenantEntitlements(tenantId: string, transaction?: BillingTransaction, now = new Date()): Promise<TenantEntitlements> {
  const state = transaction ? await readEntitlementState(tenantId, transaction) : await readEntitlementState(tenantId);
  return resolveTenantEntitlements(state.plans, state.subscriptions, now);
}

export type TenantCapability = "publish" | "schedule" | "analytics" | "generate";
export class EntitlementError extends Error {
  readonly statusCode = 403;
  readonly code = "entitlement_required";
  constructor(public readonly capability: TenantCapability) { super(`Your current plan does not permit ${capability}`); }
}

/** Limited generation needs authoritative usage under the caller's atomic quota
 * reservation lock. This assertion is not itself a usage counter. */
export function assertResolvedEntitlement(entitlements: TenantEntitlements, capability: TenantCapability, dailyGenerationsUsed?: number): void {
  if (capability === "generate") {
    const limit = entitlements.maxDailyGenerations;
    if (limit === null) return;
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new EntitlementError(capability);
    if (!Number.isSafeInteger(dailyGenerationsUsed) || dailyGenerationsUsed! < 0 || dailyGenerationsUsed! >= limit) throw new EntitlementError(capability);
    return;
  }
  const key = { publish: "canPublish", schedule: "canSchedule", analytics: "canUseAnalytics" } as const;
  if (!entitlements[key[capability]]) throw new EntitlementError(capability);
}

/** Re-resolve server/job access immediately before expensive work. */
export async function assertTenantEntitlement(tenantId: string, capability: TenantCapability, options: { dailyGenerationsUsed?: number; transaction?: BillingTransaction; now?: Date } = {}): Promise<TenantEntitlements> {
  const entitlements = await getTenantEntitlements(tenantId, options.transaction, options.now);
  assertResolvedEntitlement(entitlements, capability, options.dailyGenerationsUsed);
  return entitlements;
}
