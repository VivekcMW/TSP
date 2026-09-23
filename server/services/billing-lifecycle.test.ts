import { describe, expect, it, vi } from "vitest";
import type { BillingPlan, Subscription } from "@shared/schema";
import { orderPeriodEnd, paymentCanAdvance, providerDate, subscriptionPatch } from "./billing-lifecycle";
import type { RazorpaySubscription } from "./razorpay";
vi.mock("./billing-repository", () => ({ readEntitlementState: vi.fn() }));
import { assertResolvedEntitlement, resolveTenantEntitlements, subscriptionIsActive } from "./entitlements";

const now = new Date("2026-09-19T00:00:00Z");
const pro = { id: "plan_pro_monthly", key: "pro_monthly", name: "Pro Monthly", amount: 4900, currency: "INR", isActive: true } as BillingPlan;
const free = { id: "plan_free", key: "free", name: "Free", amount: 0, isActive: true } as BillingPlan;
const active = { id: "local", planId: pro.id, status: "active", currentPeriodStart: new Date("2026-09-01"), currentPeriodEnd: new Date("2026-10-01"), cancelAtPeriodEnd: false } as Subscription;
const remote = { id: "sub_1", plan_id: "rp_plan", status: "active", current_start: Date.parse("2026-09-01") / 1000, current_end: Date.parse("2026-10-01") / 1000 } as RazorpaySubscription;

describe("billing period and transition rules", () => {
  it.each([
    ["2026-01-31T12:00:00Z", "monthly", "2026-02-28T12:00:00.000Z"],
    ["2024-01-31T12:00:00Z", "monthly", "2024-02-29T12:00:00.000Z"],
    ["2024-02-29T12:00:00Z", "yearly", "2025-02-28T12:00:00.000Z"],
    ["2026-08-31T12:00:00Z", "quarterly", "2026-11-30T12:00:00.000Z"],
    ["2026-09-19T12:00:00Z", "weekly", "2026-09-26T12:00:00.000Z"],
    ["2026-09-19T12:00:00Z", "daily", "2026-09-20T12:00:00.000Z"],
  ])("uses calendar periods %s %s", (start, interval, end) => expect(orderPeriodEnd(new Date(start), interval).toISOString()).toBe(end));
  it("rejects unsupported intervals and invalid dates", () => {
    expect(() => orderPeriodEnd(now, "made_up")).toThrow();
    expect(() => orderPeriodEnd(new Date(NaN), "monthly")).toThrow();
  });
  it.each([undefined, null, 0, -1, Infinity, 1.5])("rejects invalid provider timestamp %s", value => expect(providerDate(value)).toBeNull());
  it("keeps actual provider periods and scheduled cancellation", () => {
    expect(subscriptionPatch({ ...active, cancelAtPeriodEnd: true }, { ...remote, current_end: Date.parse("2026-10-03") / 1000 })).toMatchObject({ currentPeriodEnd: new Date("2026-10-03"), cancelAtPeriodEnd: true });
  });
  it("does not resurrect terminal subscriptions", () => expect(subscriptionPatch({ ...active, status: "cancelled" }, remote)).toEqual({}));
  it("honors immediate cancellation even if the provider shortens its period", () => expect(subscriptionPatch(active, { ...remote, status: "cancelled", current_end: Date.parse("2026-09-19") / 1000 }).status).toBe("cancelled"));
  it("does not move the provider period backwards", () => expect(subscriptionPatch(active, { ...remote, current_end: Date.parse("2026-09-20") / 1000 })).toEqual({}));
  it("rejects active state without a complete valid provider period", () => {
    expect(() => subscriptionPatch(active, { ...remote, current_end: null })).toThrow();
    expect(() => subscriptionPatch(active, { ...remote, current_start: remote.current_end })).toThrow();
  });
  it.each(["pending", "halted", "paused", "cancelled", "completed", "expired"])("applies current provider %s state", status => expect(subscriptionPatch(active, { ...remote, status }).status).toBe(status));
  it.each([
    [undefined, "failed", true], ["failed", "captured", true], ["captured", "failed", false],
    ["captured", "authorized", false], ["captured", "captured", false], ["failed", "authorized", false],
    ["refunded", "captured", false], ["captured", "refunded", true], [undefined, "unknown", false],
  ])("payment transition %s → %s = %s", (before, after, allowed) => expect(paymentCanAdvance(before, after)).toBe(allowed));
});

describe("expiry-aware catalog entitlements", () => {
  it("denies inactive paid catalog entries even during a paid period", () => expect(resolveTenantEntitlements([{ ...pro, isActive: false }], [active], now).canPublish).toBe(false));
  it("does not invent free access when the catalog is missing", () => expect(resolveTenantEntitlements([], [], now)).toMatchObject({ planKey: "unavailable", canPublish: false, canSchedule: false, canUseAnalytics: false, maxDailyGenerations: 0 }));
  it("uses the actual free tier but never gives it paid capabilities", () => expect(resolveTenantEntitlements([free, pro], [], now)).toMatchObject({ planKey: "free", canPublish: false, canSchedule: false, canUseAnalytics: false, maxDailyGenerations: 3 }));
  it("preserves paid access until the exclusive expiry boundary after scheduled cancellation", () => {
    const row = { ...active, cancelAtPeriodEnd: true };
    expect(resolveTenantEntitlements([free, pro], [row], now).canPublish).toBe(true);
    expect(resolveTenantEntitlements([free, pro], [row], row.currentPeriodEnd!).canPublish).toBe(false);
  });
  it.each(["created", "authenticated", "pending", "halted", "paused", "cancelled", "completed", "expired"])("does not grant paid access for %s", status => expect(resolveTenantEntitlements([free, pro], [{ ...active, status }], now).canSchedule).toBe(false));
  it("does not let a newer unpaid checkout shadow paid access", () => expect(resolveTenantEntitlements([free, pro], [{ ...active, status: "created", currentPeriodStart: null }, active], now).canPublish).toBe(true));
  it.each(["pro_monthly", "pro_yearly", "pro_monthly_inr", "pro_yearly_inr"])("grants full Pro access for an active %s subscription", key => {
    const plan = { ...pro, id: `plan_${key}`, key };
    expect(resolveTenantEntitlements([free, plan], [{ ...active, planId: plan.id }], now))
      .toMatchObject({ planKey: key, canPublish: true, canSchedule: true, canUseAnalytics: true, maxDailyGenerations: null });
  });
  it("does not infer a tier from price", () => expect(resolveTenantEntitlements([{ ...pro, key: "unknown_paid" }], [active], now).maxDailyGenerations).toBe(0));
  it.each(["constructor", "__proto__", "toString"])("does not inherit tier or interval %s", key => {
    expect(resolveTenantEntitlements([{ ...pro, key }], [active], now).maxDailyGenerations).toBe(0);
    expect(() => orderPeriodEnd(now, key)).toThrow();
  });
  it("denies missing plan and missing/future/invalid periods", () => {
    expect(resolveTenantEntitlements([free], [active], now).canPublish).toBe(false);
    for (const row of [{ ...active, currentPeriodEnd: null }, { ...active, currentPeriodStart: new Date("2027-01-01") }, { ...active, currentPeriodEnd: new Date(NaN) }]) expect(resolveTenantEntitlements([pro], [row], now).canPublish).toBe(false);
    expect(subscriptionIsActive(undefined)).toBe(false);
    expect(subscriptionIsActive("active")).toBe(false);
  });
  it("does not grant a mispriced/inactive free catalog row", () => {
    expect(resolveTenantEntitlements([{ ...free, amount: 10 }], [], now).maxDailyGenerations).toBe(0);
    expect(resolveTenantEntitlements([{ ...free, isActive: false }], [], now).maxDailyGenerations).toBe(0);
  });
  it("enforces every capability and requires usage for limited generation", () => {
    const missing = resolveTenantEntitlements([], [], now);
    for (const capability of ["publish", "schedule", "analytics", "generate"] as const) expect(() => assertResolvedEntitlement(missing, capability, 0)).toThrow();
    const limits = resolveTenantEntitlements([free], [], now);
    for (const count of [undefined, NaN, -1, 3, 4]) expect(() => assertResolvedEntitlement(limits, "generate", count)).toThrow();
    expect(() => assertResolvedEntitlement(limits, "generate", 2)).not.toThrow();
    const paid = resolveTenantEntitlements([pro], [active], now);
    for (const capability of ["publish", "schedule", "analytics", "generate"] as const) expect(() => assertResolvedEntitlement(paid, capability)).not.toThrow();
  });
});