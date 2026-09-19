import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ checkout: vi.fn(), verify: vi.fn(), cancel: vi.fn(), webhook: vi.fn(), readBillingState: vi.fn(), readEntitlementState: vi.fn(), plans: vi.fn(), email: vi.fn() }));
vi.mock("../db", () => ({ db: { select: () => ({ from: () => ({ where: mocks.plans, then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.plans()).then(resolve) }) }) } }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser(req: Request, res: Response, next: NextFunction) {
    if (!req.headers["x-test-user"]) return res.status(401).json({ message: "Unauthorized" });
    req.dbUser = { id: "user", name: "User", email: "u@example.test" } as Request["dbUser"];
    req.tenant = { tenantId: req.headers["x-tenant-id"] ?? "a" } as Request["tenant"];
    next();
  },
  authedOf: (req: Request) => ({ dbUser: req.dbUser, tenant: req.tenant }),
}));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (req: Request, res: Response, next: NextFunction) => req.headers["x-test-user"] === "owner" ? next() : res.status(403).json({ message: "Forbidden" }) }));
vi.mock("../services/billing-repository", () => ({ billingRepository: mocks, readBillingState: mocks.readBillingState, readEntitlementState: mocks.readEntitlementState }));
vi.mock("../services/email", () => ({ sendAppEmail: mocks.email, emailTemplates: { paymentSucceeded: () => ({}), subscriptionCancelled: () => ({}) } }));
import { registerBillingRoutes } from "./billing";
import { BillingError } from "../services/billing-lifecycle";
import { requireEntitlement } from "../middlewares/requireEntitlement";
import { requireDbUser } from "../middlewares/requireDbUser";

function app(raw = true, tamper = false) {
  const app = express();
  app.use(express.json({ verify: (req, _res, body) => { if (raw) (req as Request).rawBody = body; } }));
  if (tamper) app.use((req, _res, next) => { req.body = { event: "attacker.changed" }; next(); });
  registerBillingRoutes(app);
  app.post("/test/publish", requireDbUser, requireEntitlement("publish"), (_req, res) => res.json({ ok: true }));
  return app;
}
const signature = (body: string, secret = "webhook-test") => crypto.createHmac("sha256", secret).update(body).digest("hex");
const checkoutSignature = () => crypto.createHmac("sha256", "checkout-test").update("order_1|pay_1").digest("hex");
const verifyBody = () => ({ razorpayOrderId: "order_1", razorpayPaymentId: "pay_1", razorpaySignature: checkoutSignature() });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RAZORPAY_KEY_ID", "test_key"); vi.stubEnv("RAZORPAY_KEY_SECRET", "checkout-test"); vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "webhook-test");
  mocks.plans.mockResolvedValue([]); mocks.email.mockResolvedValue(undefined);
  mocks.readEntitlementState.mockResolvedValue({ plans: [], subscriptions: [] });
  mocks.readBillingState.mockResolvedValue({ subscriptionRows: [], methods: [], recentPayments: [] });
  mocks.webhook.mockResolvedValue({ duplicate: false });
});
afterEach(() => vi.unstubAllEnvs());

describe("billing HTTP security", () => {
  it("serves only safe public catalog fields without authentication", async () => {
    mocks.plans.mockResolvedValue([{ id: "catalog", key: "pro_monthly", name: "Catalog plan", amount: 7311, currency: "INR", interval: "monthly", features: ["Catalog feature"], razorpayPlanId: "private_provider_plan" }]);
    const result = await request(app()).get("/api/public/billing/plans").expect(200);
    expect(result.body.plans[0]).toMatchObject({ id: "catalog", amount: 7311, features: ["Catalog feature"], recurringAvailable: true });
    expect(result.text).not.toContain("private_provider_plan");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(mocks.readBillingState).not.toHaveBeenCalled();
  });
  it("returns unavailable rather than invented prices when the public catalog fails", async () => {
    mocks.plans.mockRejectedValue(new Error("private database message"));
    const response = await request(app()).get("/api/public/billing/plans").expect(503);
    expect(response.body).toEqual({ message: "Plan catalog is unavailable" });
  });
  it.each(["order", "subscription"])("uses only server plan and explicit cycles for %s checkout", async kind => {
    mocks.checkout.mockResolvedValue({ plan: { id: "plan", key: "pro_monthly", name: "Catalog", amount: 12345, currency: "INR", interval: "monthly" } });
    await request(app()).post(`/api/billing/checkout/${kind}`).set("x-test-user", "owner").send({ planId: "plan", totalCount: 6, amount: 1, currency: "FAKE", tenantId: "evil" }).expect(201);
    expect(mocks.checkout).toHaveBeenCalledWith("a", { name: "User", email: "u@example.test" }, "plan", kind === "subscription" ? 6 : undefined);
  });
  it.each(["/api/billing", "/api/billing/plans", "/api/billing/entitlements"])("requires authentication for GET %s", async url => { await request(app()).get(url).expect(401); });
  it.each(["/api/billing/checkout/order", "/api/billing/checkout/subscription", "/api/billing/checkout/verify", "/api/billing/subscription/cancel"])("requires authentication and billing ownership for POST %s", async url => {
    await request(app()).post(url).send({}).expect(401);
    await request(app()).post(url).set("x-test-user", "member").send({}).expect(403);
    expect(mocks.checkout).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("rejects manager-only billing reads while allowing a member to inspect their entitlements", async () => {
    await request(app()).get("/api/billing").set("x-test-user", "member").expect(403);
    const result = await request(app()).get("/api/billing/entitlements").set("x-test-user", "member").set("x-tenant-id", "b").expect(200);
    expect(mocks.readEntitlementState).toHaveBeenCalledWith("b");
    expect(result.body).toMatchObject({ planKey: "unavailable", canPublish: false, maxDailyGenerations: 0 });
    expect(result.headers["cache-control"]).toBe("no-store");
  });
  it("binds verification to authenticated tenant, not a body tenant", async () => {
    mocks.verify.mockRejectedValue(new BillingError(404, "checkout_not_found", "Checkout not found in this tenant"));
    await request(app()).post("/api/billing/checkout/verify").set("x-test-user", "owner").set("x-tenant-id", "b").send({ ...verifyBody(), tenantId: "a" }).expect(404);
    expect(mocks.verify).toHaveBeenCalledWith("b", "order_1", "pay_1", false);
  });
  it("rejects bad/missing signatures or two checkout identities before repository calls", async () => {
    for (const body of [{ ...verifyBody(), razorpaySignature: "bad" }, { ...verifyBody(), razorpaySignature: "0".repeat(64) }, { ...verifyBody(), razorpaySubscriptionId: "sub_1" }]) await request(app()).post("/api/billing/checkout/verify").set("x-test-user", "owner").send(body).expect(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("supports signed recurring checkout verification", async () => {
    mocks.verify.mockResolvedValue({ payment: { id: "pay" }, capturedNow: false });
    const sig = crypto.createHmac("sha256", "checkout-test").update("pay_1|sub_1").digest("hex");
    await request(app()).post("/api/billing/checkout/verify").set("x-test-user", "owner").send({ razorpaySubscriptionId: "sub_1", razorpayPaymentId: "pay_1", razorpaySignature: sig }).expect(200);
    expect(mocks.verify).toHaveBeenCalledWith("a", "sub_1", "pay_1", true);
  });
  it("does not fabricate success or leak a provider error on cancellation", async () => {
    mocks.cancel.mockRejectedValue(new Error("secret payment customer info"));
    const result = await request(app()).post("/api/billing/subscription/cancel").set("x-test-user", "owner").send({}).expect(502);
    expect(JSON.stringify(result.body)).not.toContain("secret"); expect(result.body.success).toBeUndefined(); expect(mocks.email).not.toHaveBeenCalled();
  });
  it("fails checkout closed when credentials are absent", async () => {
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    await request(app()).post("/api/billing/checkout/order").set("x-test-user", "owner").send({ planId: "plan_pro_monthly" }).expect(503);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
});

describe("signed raw webhook boundary", () => {
  const body = '{ "event": "payment.captured", "payload": { "payment": { "entity": { "id": "pay_1", "order_id": "order_1" } } } }';
  it("requires original raw bytes even with a valid signature", async () => {
    await request(app(false)).post("/api/webhooks/razorpay").set("content-type", "application/json").set("x-razorpay-signature", signature(body)).send(body).expect(400);
    expect(mocks.webhook).not.toHaveBeenCalled();
  });
  it("parses the signed raw bytes rather than a mutated request body", async () => {
    await request(app(true, true)).post("/api/webhooks/razorpay").set("content-type", "application/json").set("x-razorpay-signature", signature(body)).send(body).expect(200);
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    expect(mocks.webhook).toHaveBeenCalledWith(hash, hash, expect.objectContaining({ event: "payment.captured" }));
  });
  it("rejects reserialized byte signatures", async () => {
    await request(app()).post("/api/webhooks/razorpay").set("content-type", "application/json").set("x-razorpay-signature", signature(JSON.stringify(JSON.parse(body)))).send(body).expect(400);
    expect(mocks.webhook).not.toHaveBeenCalled();
  });
  it("fails closed without webhook secret", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    await request(app()).post("/api/webhooks/razorpay").send({}).expect(503);
    expect(mocks.webhook).not.toHaveBeenCalled();
  });
  it("rejects missing signatures and signed malformed envelopes", async () => {
    await request(app()).post("/api/webhooks/razorpay").send({}).expect(400);
    await request(app()).post("/api/webhooks/razorpay").set("content-type", "application/json").set("x-razorpay-signature", signature("{}")).send("{}").expect(400);
    expect(mocks.webhook).not.toHaveBeenCalled();
  });
  it("returns retryable failure rather than acknowledging a failed transaction", async () => {
    mocks.webhook.mockRejectedValue(new Error("db error"));
    const result = await request(app()).post("/api/webhooks/razorpay").set("content-type", "application/json").set("x-razorpay-signature", signature(body)).send(body).expect(502);
    expect(result.body).toEqual({ message: "Webhook processing failed; retry required" });
  });
  it("forwards provider event identity and bounded payload hash", async () => {
    await request(app()).post("/api/webhooks/razorpay").set("content-type", "application/json").set("x-razorpay-event-id", "evt_1").set("x-razorpay-signature", signature(body)).send(body).expect(200);
    expect(mocks.webhook).toHaveBeenCalledWith("evt_1", expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Object));
  });
});

describe("reusable billing enforcement middleware", () => {
  it("denies anonymous and zero/missing entitlements", async () => {
    await request(app()).post("/test/publish").expect(401);
    await request(app()).post("/test/publish").set("x-test-user", "member").expect(403);
  });
  it("fails closed on entitlement repository outages", async () => {
    mocks.readEntitlementState.mockRejectedValue(new Error("outage"));
    const result = await request(app()).post("/test/publish").set("x-test-user", "owner").expect(503);
    expect(result.body).toEqual({ code: "entitlements_unavailable", message: "Could not verify plan access" });
  });
  it("allows a current paid tier but not an expired one", async () => {
    const state = { plans: [{ id: "pro", key: "pro_monthly", name: "Pro", isActive: true }], subscriptions: [{ planId: "pro", status: "active", currentPeriodStart: new Date(Date.now() - 1000), currentPeriodEnd: new Date(Date.now() + 60000) }] };
    mocks.readEntitlementState.mockResolvedValue(state);
    await request(app()).post("/test/publish").set("x-test-user", "member").set("x-tenant-id", "b").send({ tenantId: "a" }).expect(200);
    expect(mocks.readEntitlementState).toHaveBeenCalledWith("b");
    state.subscriptions[0].currentPeriodEnd = new Date(0);
    await request(app()).post("/test/publish").set("x-test-user", "member").expect(403);
  });
});