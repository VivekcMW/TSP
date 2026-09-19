import type { Express, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { billingPlans } from "@shared/schema";
import {
  getRazorpayKeyId, hashWebhookPayload,
  razorpayConfigured, razorpayWebhookConfigured, verifyCheckoutSignature, verifySubscriptionSignature, verifyWebhookSignature,
} from "../services/razorpay";
import { getTenantEntitlements, resolveTenantEntitlements } from "../services/entitlements";
import { billingRepository, readBillingState } from "../services/billing-repository";
import { BillingError } from "../services/billing-lifecycle";
import { emailTemplates, sendAppEmail } from "../services/email";

const checkoutSchema = z.object({ planId: z.string().min(1).max(64) });
const id = z.string().min(1).max(128);
const subscriptionCheckoutSchema = checkoutSchema.extend({ totalCount: z.number().int().min(1).max(100) });
const verifySchema = z.object({ razorpayOrderId: id.optional(), razorpaySubscriptionId: id.optional(), razorpayPaymentId: id, razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/) })
  .refine(value => Boolean(value.razorpayOrderId) !== Boolean(value.razorpaySubscriptionId));
const entity = z.object({ id: id.optional(), order_id: id.optional(), invoice_id: id.nullish() }).passthrough();
const webhookSchema = z.object({ event: z.string().min(1).max(128), payload: z.object({ order: z.object({ entity }).optional(), payment: z.object({ entity }).optional(), subscription: z.object({ entity }).optional() }).optional() });

function fail(res: Response, error: unknown, message: string) {
  if (error instanceof BillingError) return res.status(error.statusCode).json({ code: error.code, message: error.message });
  // Provider exceptions may contain sensitive details. Never echo/log them raw.
  return res.status(502).json({ message });
}

function safePlan(plan: typeof billingPlans.$inferSelect) {
  return { id: plan.id, key: plan.key, name: plan.name, description: plan.description, amount: plan.amount, currency: plan.currency, interval: plan.interval, features: plan.features ?? [], recurringAvailable: Boolean(plan.razorpayPlanId) };
}

export function registerBillingRoutes(app: Express) {
  // Only allowlisted catalog fields; no customer/subscription/provider identifiers.
  app.get("/api/public/billing/plans", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const plans = await db.select().from(billingPlans).where(eq(billingPlans.isActive, true));
      res.json({ plans: plans.map(safePlan) });
    } catch { res.status(503).json({ message: "Plan catalog is unavailable" }); }
  });
  app.get("/api/billing/plans", requireDbUser, requirePermission("billing:manage:tenant"), async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const plans = await db.select().from(billingPlans).where(eq(billingPlans.isActive, true));
      res.json({ plans: plans.map(safePlan) });
    } catch (error) { fail(res, error, "Failed to load billing plans"); }
  });

  app.get("/api/billing/entitlements", requireDbUser, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { tenant: scope } = authedOf(req);
      res.json(await getTenantEntitlements(scope.tenantId));
    } catch {
      res.status(503).json({ message: "Failed to load billing entitlements" });
    }
  });

  app.get("/api/billing", requireDbUser, requirePermission("billing:manage:tenant"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const [plans, state] = await Promise.all([
        db.select().from(billingPlans),
        readBillingState(scope.tenantId),
      ]);
      const entitlements = resolveTenantEntitlements(plans, state.subscriptionRows);
      const currentPlan = plans.find(plan => plan.key === entitlements.planKey);
      const subscription = state.subscriptionRows.find(row => row.planId === currentPlan?.id && row.status === "active" && row.currentPeriodEnd && row.currentPeriodEnd > new Date()) ?? state.subscriptionRows.find(row => row.currentPeriodStart) ?? state.subscriptionRows[0];
      res.json({ configured: razorpayConfigured(), keyId: getRazorpayKeyId(), plans: plans.filter(plan => plan.isActive).map(safePlan), currentPlan: currentPlan ? safePlan(currentPlan) : null, subscription: subscription ?? null, entitlements, paymentMethods: state.methods.map(({ razorpayTokenId: _token, ...method }) => method), payments: state.recentPayments, customer: state.customer ? { name: state.customer.name, email: state.customer.email } : { name: dbUser.name, email: dbUser.email } });
    } catch (error) {
      fail(res, error, "Failed to load billing information");
    }
  });

  for (const recurring of [false, true]) app.post(`/api/billing/checkout/${recurring ? "subscription" : "order"}`, requireDbUser, requirePermission("billing:manage:tenant"), async (req, res) => {
    const parsed = (recurring ? subscriptionCheckoutSchema : checkoutSchema).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Choose a valid plan" });
    if (!razorpayConfigured()) return res.status(503).json({ message: "Razorpay is not configured for this environment" });
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const count = "totalCount" in parsed.data ? parsed.data.totalCount as number : undefined;
      const result = await billingRepository.checkout(scope.tenantId, { name: dbUser.name, email: dbUser.email }, parsed.data.planId, count);
      res.status(201).json({ ...result, plan: safePlan(result.plan), keyId: getRazorpayKeyId(), prefill: { name: dbUser.name, email: dbUser.email } });
    } catch (error) {
      fail(res, error, "Could not start checkout");
    }
  });

  app.post("/api/billing/checkout/verify", requireDbUser, requirePermission("billing:manage:tenant"), async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Payment verification failed" });
    const data = parsed.data;
    const recurring = Boolean(data.razorpaySubscriptionId);
    const checkoutId = (data.razorpaySubscriptionId ?? data.razorpayOrderId)!;
    if (!(recurring ? verifySubscriptionSignature : verifyCheckoutSignature)(checkoutId, data.razorpayPaymentId, data.razorpaySignature)) return res.status(400).json({ message: "Payment verification failed" });
    try {
      const { tenant: scope, dbUser } = authedOf(req);
      const result = await billingRepository.verify(scope.tenantId, checkoutId, data.razorpayPaymentId, recurring);
      res.json({ success: true, payment: result.payment });
      if (result.capturedNow && result.payment) void sendAppEmail({ type: "payment_succeeded", recipient: dbUser.email, recipientName: dbUser.name, userId: dbUser.id, ...emailTemplates.paymentSucceeded("Your plan", `${result.payment.currency} ${(result.payment.amount / 100).toFixed(2)}`), required: true, dedupeKey: `payment:${result.payment.razorpayPaymentId}` }).catch(() => console.error("Failed to send payment email"));
    } catch (error) {
      fail(res, error, "Payment could not be verified or recorded. Please retry or contact support.");
    }
  });

  app.post("/api/billing/subscription/cancel", requireDbUser, requirePermission("billing:manage:tenant"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const updated = await billingRepository.cancel(scope.tenantId);
      res.json({ success: true, subscription: updated });
      void sendAppEmail({ type: "subscription_cancelled", recipient: authedOf(req).dbUser.email, recipientName: authedOf(req).dbUser.name, userId: authedOf(req).dbUser.id, ...emailTemplates.subscriptionCancelled(updated.currentPeriodEnd?.toLocaleDateString() ?? "the provider-confirmed end date"), required: true, dedupeKey: `subscription-cancelled:${updated.id}` }).catch(() => console.error("Failed to send cancellation email"));
    } catch (error) {
      fail(res, error, "Provider cancellation could not be confirmed. Please retry or contact support.");
    }
  });

  app.post("/api/webhooks/razorpay", async (req, res) => {
    if (!razorpayWebhookConfigured()) return res.status(503).json({ message: "Razorpay webhook is not configured" });
    const signature = req.headers["x-razorpay-signature"];
    const eventId = req.headers["x-razorpay-event-id"];
    if (!Buffer.isBuffer(req.rawBody) || typeof signature !== "string" || !verifyWebhookSignature(req.rawBody, signature)) return res.status(400).json({ message: "Invalid webhook signature" });
    let payload;
    try { payload = webhookSchema.safeParse(JSON.parse(req.rawBody.toString("utf8"))); }
    catch { return res.status(400).json({ message: "Invalid webhook payload" }); }
    if (!payload.success) return res.status(400).json({ message: "Invalid webhook payload" });
    if (eventId !== undefined && (typeof eventId !== "string" || eventId.length > 256 || !eventId.trim())) return res.status(400).json({ message: "Invalid webhook event ID" });
    try {
      const hash = hashWebhookPayload(req.rawBody);
      const result = await billingRepository.webhook(eventId ?? hash, hash, payload.data);
      res.json({ received: true, ...result });
    } catch (error) {
      fail(res, error, "Webhook processing failed; retry required");
    }
  });
}



