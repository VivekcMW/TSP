import { afterEach, describe, expect, it, vi } from "vitest";
import { authReturnEvent, beginCheckoutParams, editorialEvent, purchaseParams, rememberAuthMethod, takeAuthMethod } from "./analytics-events";

describe("auth method hand-off across the sign-in redirect", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("remembers the method once and hands it back exactly once", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    rememberAuthMethod("google");
    expect(takeAuthMethod()).toBe("google");
    expect(takeAuthMethod()).toBeNull();
  });
  it("forgets a method remembered more than 15 minutes ago (abandoned sign-in)", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-15T12:00:00Z"));
    rememberAuthMethod("linkedin");
    now.mockReturnValue(Date.parse("2026-10-15T12:16:00Z"));
    expect(takeAuthMethod()).toBeNull();
    now.mockRestore();
  });
  it("is harmless when storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });
    expect(() => rememberAuthMethod("email")).not.toThrow();
    expect(takeAuthMethod()).toBeNull();
  });
});

const plan = { id: "pro_monthly_inr", key: "pro_monthly_inr", name: "Pro (monthly)", description: null, amount: 99900, currency: "INR", interval: "monthly", features: [], recurringAvailable: true };
const payment = { razorpayPaymentId: "pay_ABC123", status: "captured", amount: 99900, currency: "INR" };

describe("checkout events", () => {
  it("describes the plan in GA4 ecommerce shape with the price in major units", () => {
    expect(beginCheckoutParams(plan)).toEqual({
      currency: "INR", value: 999,
      items: [{ item_id: "pro_monthly_inr", item_name: "Pro (monthly)", item_variant: "monthly", price: 999, quantity: 1 }],
    });
  });

  it("adds the payment id as the transaction id on purchase", () => {
    expect(purchaseParams(plan, payment)).toEqual({
      transaction_id: "pay_ABC123", currency: "INR", value: 999,
      items: [{ item_id: "pro_monthly_inr", item_name: "Pro (monthly)", item_variant: "monthly", price: 999, quantity: 1 }],
    });
  });

  it("keeps cents when the price has them", () => {
    expect(purchaseParams(plan, { ...payment, amount: 1999, currency: "USD" })?.value).toBe(19.99);
    expect(purchaseParams(plan, { ...payment, amount: 1999, currency: "USD" })?.items[0].price).toBe(19.99);
  });
  it.each(["authorized", "created", "failed", "refunded"])("does not count %s payments as purchases", status => {
    expect(purchaseParams(plan, { ...payment, status })).toBeNull();
  });
});

describe("editorialEvent", () => {
  it("maps a Create generation to generate_post with platform and tone", () => {
    expect(editorialEvent("/api/ai/generate-post", { platform: "linkedin", tones: ["confident"], content: "secret draft" }))
      .toEqual({ name: "generate_post", params: { surface: "create", platform: "linkedin", tone: "confident" } });
  });

  it("maps Instant Review generations and joins several platforms", () => {
    expect(editorialEvent("/api/instant-review/selected", { platforms: ["linkedin", "twitter"], articleIds: ["a1"] }))
      .toEqual({ name: "generate_post", params: { surface: "instant_review", platform: "linkedin,twitter" } });
    expect(editorialEvent("/api/instant-review/manual", { platforms: ["threads"], url: "https://x.test" })?.params.surface).toBe("instant_review");
  });

  it("ignores endpoints that are not generations", () => {
    expect(editorialEvent("/api/editorial/jobs/1", {})).toBeNull();
    expect(editorialEvent("/api/drafts", { platform: "linkedin" })).toBeNull();
  });
});

describe("authReturnEvent", () => {
  it.each(["email", "google", "linkedin"])("does not infer registration from a %s login", method => {
    expect(authReturnEvent(method)).toEqual({ name: "login", params: { method } });
    expect(authReturnEvent(method)).toEqual({ name: "login", params: { method } });
  });
});
