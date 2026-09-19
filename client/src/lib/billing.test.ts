import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingPeriodLabel, billingStatusLabel, canCancelSubscription, checkoutRequest, checkoutVerification, formatBillingAmount } from "./billing";
const subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: "2026-10-01" };
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-19T12:00:00Z")));
afterEach(() => vi.restoreAllMocks());
describe("truthful catalog checkout UI contracts", () => {
  it("never calls one-time orders renewals or offers provider cancellation", () => {
    expect(billingPeriodLabel(subscription)).toBe("Access ends");
    expect(canCancelSubscription(subscription)).toBe(false);
    expect(billingPeriodLabel(null)).toBeNull();
  });
  it("allows cancellation only for a real recurring subscription", () => {
    const recurring = { ...subscription, razorpaySubscriptionId: "sub_1" };
    expect(canCancelSubscription(recurring)).toBe(true);
    expect(billingPeriodLabel(recurring)).toBe("Current cycle ends");
    expect(canCancelSubscription({ ...recurring, cancelAtPeriodEnd: true })).toBe(false);
    expect(billingPeriodLabel({ ...recurring, cancelAtPeriodEnd: true })).toBe("Access ends");
    expect(canCancelSubscription({ ...recurring, status: "cancelled" })).toBe(false);
  });
  it.each(["cancelled", "expired", "completed"].flatMap(status => [false, true].map(cancelAtPeriodEnd => ({ status, cancelAtPeriodEnd }))))("preserves terminal $status with cancellation flag $cancelAtPeriodEnd", state => {
    const ended = { ...subscription, ...state, razorpaySubscriptionId: "sub_1" };
    expect(billingStatusLabel(ended)).toBe(state.status);
    expect(billingPeriodLabel(ended)).toBe("Recorded period end");
    expect(canCancelSubscription(ended)).toBe(false);
    expect(billingPeriodLabel({ ...ended, currentPeriodEnd: "2026-09-01" })).toBe("Period ended");
  });
  it("distinguishes active recurring cancellation, one-time access, and absent subscriptions", () => {
    expect(billingStatusLabel({ ...subscription, razorpaySubscriptionId: "sub_1", cancelAtPeriodEnd: true })).toBe("Cancellation scheduled");
    expect(billingStatusLabel({ ...subscription, cancelAtPeriodEnd: true })).toBe("active");
    expect(billingStatusLabel(subscription)).toBe("active");
    expect(billingStatusLabel(null)).toBe("No paid subscription");
  });
  it.each([false, true])("shows elapsed active periods as expired, including the exact end boundary (cancellation %s)", cancelAtPeriodEnd => {
    const elapsed = { ...subscription, cancelAtPeriodEnd, razorpaySubscriptionId: "sub_1", currentPeriodEnd: "2026-09-19T12:00:00Z" };
    expect(billingStatusLabel(elapsed)).toBe("expired");
    expect(billingPeriodLabel(elapsed)).toBe("Period ended");
  });
  it.each([null, "not-a-date"])("omits missing/invalid period dates (%s)", currentPeriodEnd => {
    expect(billingPeriodLabel({ ...subscription, currentPeriodEnd })).toBeNull();
  });
  it("sends only catalog identity, not client price, and requires explicit recurring cycles", () => {
    expect(checkoutRequest("catalog-plan", "order", "")).toEqual({ planId: "catalog-plan" });
    expect(checkoutRequest("catalog-plan", "subscription", "12")).toEqual({ planId: "catalog-plan", totalCount: 12 });
    expect(formatBillingAmount(7311, "USD")).toBe("$73.11");
  });
  it.each(["", "0", "101", "NaN", "1.5", "-1", "Infinity"])("rejects invalid cycle count %s", cycles => {
    expect(() => checkoutRequest("p", "subscription", cycles)).toThrow();
  });
  it.each(["order", "subscription"] as const)("verifies only the selected owned %s identity", mode => {
    const response = { razorpay_order_id: "order_1", razorpay_subscription_id: "sub_1", razorpay_payment_id: "pay_1", razorpay_signature: "signature" };
    const id = mode === "order" ? "order_1" : "sub_1";
    const payload = checkoutVerification(mode, id, response);
    expect(payload).toEqual({ [mode === "order" ? "razorpayOrderId" : "razorpaySubscriptionId"]: id, razorpayPaymentId: "pay_1", razorpaySignature: "signature" });
    expect(() => checkoutVerification(mode, "foreign_checkout", response)).toThrow();
  });
});