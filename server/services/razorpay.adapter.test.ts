import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelSubscription, createSubscription, fetchInvoice, fetchPlan, fetchSubscription, verifyCheckoutSignature, verifySubscriptionSignature, verifyWebhookSignature } from "./razorpay";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RAZORPAY_KEY_ID", "test_key"); vi.stubEnv("RAZORPAY_KEY_SECRET", "test_secret"); vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Razorpay subscription adapter (no network)", () => {
  it("sends real cycle-end cancellation semantics and a bounded timeout", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "sub_1", status: "active" })));
    await expect(cancelSubscription("sub_1")).resolves.toMatchObject({ status: "active" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.razorpay.com/v1/subscriptions/sub_1/cancel");
    expect(init.method).toBe("POST"); expect(JSON.parse(init.body)).toEqual({ cancel_at_cycle_end: true });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("propagates provider failure without inventing a cancellation result", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { description: "Cannot cancel" } }), { status: 400 }));
    await expect(cancelSubscription("sub_1")).rejects.toThrow("Cannot cancel");
  });
  it("fails closed without credentials before HTTP", async () => {
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    await expect(cancelSubscription("sub_1")).rejects.toThrow("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(verifyCheckoutSignature("o", "p", "anything")).toBe(false);
    expect(verifySubscriptionSignature("s", "p", "anything")).toBe(false);
    expect(verifyWebhookSignature(Buffer.from("{}"), "anything")).toBe(false);
  });
  it("verifies the distinct subscription signature ordering", () => {
    const signature = crypto.createHmac("sha256", "test_secret").update("pay_1|sub_1").digest("hex");
    expect(verifySubscriptionSignature("sub_1", "pay_1", signature)).toBe(true);
    expect(verifySubscriptionSignature("sub_2", "pay_1", signature)).toBe(false);
    expect(verifyCheckoutSignature("sub_1", "pay_1", signature)).toBe(false);
  });
  it("encodes IDs and uses the invoice/plan/subscription endpoints", async () => {
    fetchMock.mockImplementation(async () => new Response("{}"));
    await fetchSubscription("sub/1"); await fetchInvoice("inv/1"); await fetchPlan("plan/1");
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["https://api.razorpay.com/v1/subscriptions/sub%2F1", "https://api.razorpay.com/v1/invoices/inv%2F1", "https://api.razorpay.com/v1/plans/plan%2F1"]);
  });
  it("creates a provider subscription with explicit cycles and no invented start period", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    const input = { plan_id: "plan_1", total_count: 12, quantity: 1, notes: { tenantId: "a" } };
    await createSubscription(input);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });
});