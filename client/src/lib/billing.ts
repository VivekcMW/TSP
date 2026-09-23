export interface PublicBillingPlan {
  id: string; key: string; name: string; description: string | null;
  amount: number; currency: string; interval: string; features: string[]; recurringAvailable: boolean;
}
export interface BillingSubscription {
  status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; razorpaySubscriptionId?: string | null;
}
export function formatBillingAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
}
const INDIA_TIME_ZONES = new Set(["Asia/Kolkata", "Asia/Calcutta"]);
/** INR for visitors in India (time zone or an -IN locale); USD for everyone else. */
export function defaultBillingCurrency(env: { timeZone?: string; locales?: readonly string[] }): "INR" | "USD" {
  const inIndia = (env.timeZone !== undefined && INDIA_TIME_ZONES.has(env.timeZone))
    || (env.locales ?? []).some(locale => /-IN$/i.test(locale));
  return inIndia ? "INR" : "USD";
}
const INTERVAL_ORDER: Record<string, number> = { monthly: 0, quarterly: 1, annual: 2 };
/** Paid plans in one currency, shortest billing interval first. */
export function plansForCurrency(plans: PublicBillingPlan[], currency: string) {
  return plans.filter(plan => plan.amount > 0 && plan.currency === currency)
    .sort((a, b) => (INTERVAL_ORDER[a.interval] ?? 9) - (INTERVAL_ORDER[b.interval] ?? 9) || a.amount - b.amount);
}
/** Currencies that have at least one paid plan, in catalog order. */
export function billingCurrencies(plans: PublicBillingPlan[]) {
  return [...new Set(plans.filter(plan => plan.amount > 0).map(plan => plan.currency))];
}
export function billingStatusLabel(subscription: BillingSubscription | null, now = Date.now()) {
  if (!subscription) return "No paid subscription";
  if (subscription.status !== "active") return subscription.status;
  if (subscription.currentPeriodEnd && Date.parse(subscription.currentPeriodEnd) <= now) return "expired";
  return subscription.razorpaySubscriptionId && subscription.cancelAtPeriodEnd ? "Cancellation scheduled" : subscription.status;
}
export function billingPeriodLabel(subscription: BillingSubscription | null, now = Date.now()) {
  if (!subscription?.currentPeriodEnd || !Number.isFinite(Date.parse(subscription.currentPeriodEnd))) return null;
  if (Date.parse(subscription.currentPeriodEnd) <= now) return "Period ended";
  if (subscription.status !== "active") return "Recorded period end";
  if (!subscription.razorpaySubscriptionId || subscription.cancelAtPeriodEnd) return "Access ends";
  return "Current cycle ends";
}
export function canCancelSubscription(subscription: BillingSubscription | null) {
  return Boolean(subscription?.razorpaySubscriptionId && ["active", "authenticated", "pending", "halted", "paused"].includes(subscription.status) && !subscription.cancelAtPeriodEnd);
}
export type CheckoutMode = "order" | "subscription";
export function checkoutRequest(planId: string, mode: CheckoutMode, cycles: string) {
  if (mode === "order") return { planId };
  const totalCount = Number(cycles);
  if (!Number.isSafeInteger(totalCount) || totalCount < 1 || totalCount > 100) throw new Error("Choose 1–100 recurring billing cycles.");
  return { planId, totalCount };
}
export function checkoutVerification(mode: CheckoutMode, checkoutId: string, response: {
  razorpay_order_id?: string; razorpay_subscription_id?: string; razorpay_payment_id: string; razorpay_signature: string;
}) {
  const returnedId = mode === "order" ? response.razorpay_order_id : response.razorpay_subscription_id;
  if (returnedId !== checkoutId) throw new Error("Checkout response does not match. Refresh billing before paying again.");
  return { ...(mode === "order" ? { razorpayOrderId: checkoutId } : { razorpaySubscriptionId: checkoutId }),
    razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature };
}