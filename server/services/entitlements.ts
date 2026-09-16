import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { billingPlans, subscriptions } from "@shared/schema";

export interface TenantEntitlements {
  planKey: string;
  planName: string;
  status: string;
  canPublish: boolean;
  canSchedule: boolean;
  canUseAnalytics: boolean;
  maxDailyGenerations: number | null;
  currentPeriodEnd: Date | null;
}

export async function getTenantEntitlements(tenantId: string): Promise<TenantEntitlements> {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).orderBy(desc(subscriptions.updatedAt)).limit(1);
  const planId = subscription?.planId ?? "plan_free";
  const [plan] = await db.select().from(billingPlans).where(eq(billingPlans.id, planId));
  const active = !subscription || ["active", "authenticated"].includes(subscription.status);
  const isPaid = Boolean(plan && plan.amount > 0);
  return {
    planKey: plan?.key ?? "free",
    planName: plan?.name ?? "Free",
    status: subscription?.status ?? "active",
    canPublish: active && (isPaid || !subscription),
    canSchedule: active && isPaid,
    canUseAnalytics: active,
    maxDailyGenerations: isPaid ? null : 3,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
  };
}

export function subscriptionIsActive(status: string | null | undefined): boolean {
  return !status || ["active", "authenticated"].includes(status);
}
