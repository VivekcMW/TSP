import { db } from "../db";
import { billingPlans } from "@shared/schema";
import type { PublicBillingPlan } from "@shared/public-billing";

export function safePlan(plan: typeof billingPlans.$inferSelect): PublicBillingPlan {
  return {
    id: plan.id, key: plan.key, name: plan.name, description: plan.description ?? null,
    amount: plan.amount, currency: plan.currency, interval: plan.interval, features: plan.features ?? [],
    recurringAvailable: Boolean(plan.razorpayPlanId), available: plan.isActive,
  };
}

export async function readPublicBillingPlans(): Promise<PublicBillingPlan[]> {
  const plans = await db.select().from(billingPlans);
  return plans.filter(plan => plan.listed).map(safePlan);
}
