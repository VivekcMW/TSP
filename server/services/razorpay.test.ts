import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { maskVpa, verifyCheckoutSignature, verifyWebhookSignature } from "./razorpay";

describe("Razorpay security helpers", () => {
  const originalKey = process.env.RAZORPAY_KEY_SECRET;
  const originalWebhook = process.env.RAZORPAY_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.RAZORPAY_KEY_SECRET = originalKey;
    process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhook;
  });

  it("verifies checkout signatures and rejects malformed or changed signatures", () => {
    process.env.RAZORPAY_KEY_SECRET = "test-secret";
    const signature = crypto.createHmac("sha256", "test-secret").update("order_1|pay_1").digest("hex");
    expect(verifyCheckoutSignature("order_1", "pay_1", signature)).toBe(true);
    expect(verifyCheckoutSignature("order_1", "pay_2", signature)).toBe(false);
    expect(verifyCheckoutSignature("order_1", "pay_1", "bad")).toBe(false);
  });

  it("verifies webhook signatures against the raw payload", () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-secret";
    const payload = Buffer.from('{"event":"order.paid"}');
    const signature = crypto.createHmac("sha256", "webhook-secret").update(payload).digest("hex");
    expect(verifyWebhookSignature(payload, signature)).toBe(true);
    expect(verifyWebhookSignature(payload, `${signature.slice(0, -1)}0`)).toBe(false);
  });

  it("masks UPI identifiers before they reach the client", () => {
    expect(maskVpa("person@example.com")).toBe("p••••@example.com");
    expect(maskVpa()).toBeNull();
  });
});
