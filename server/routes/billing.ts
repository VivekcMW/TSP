import type { Express } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import {
  billingCustomers, billingPlans, billingWebhookEvents, paymentMethods, payments, subscriptions,
} from "@shared/schema";
import {
  createCustomer, createOrder, fetchOrder, fetchPayment, getRazorpayKeyId, hashWebhookPayload,
  maskVpa, razorpayConfigured, razorpayWebhookConfigured, verifyCheckoutSignature, verifyWebhookSignature,
} from "../services/razorpay";
import { getTenantEntitlements } from "../services/entitlements";
import { emailTemplates, sendAppEmail } from "../services/email";

const checkoutSchema = z.object({ planId: z.string().min(1).max(64) });
const verifySchema = z.object({ razorpayOrderId: z.string().min(1), razorpayPaymentId: z.string().min(1), razorpaySignature: z.string().min(1) });

async function tenantBilling<T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

function safePlan(plan: typeof billingPlans.$inferSelect) {
  return { id: plan.id, key: plan.key, name: plan.name, description: plan.description, amount: plan.amount, currency: plan.currency, interval: plan.interval, features: plan.features ?? [] };
}

export function registerBillingRoutes(app: Express) {
  app.get("/api/billing/plans", requireDbUser, requirePermission("billing:manage:tenant"), async (_req, res) => {
    const plans = await db.select().from(billingPlans).where(eq(billingPlans.isActive, true));
    res.json({ plans: plans.map(safePlan) });
  });

  app.get("/api/billing/entitlements", requireDbUser, requirePermission("billing:manage:tenant"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      res.json(await getTenantEntitlements(scope.tenantId));
    } catch (error) {
      console.error("Error fetching billing entitlements:", error);
      res.status(500).json({ message: "Failed to load billing entitlements" });
    }
  });

  app.get("/api/billing", requireDbUser, requirePermission("billing:manage:tenant"), async (req, res) => {
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const [plans, state] = await Promise.all([
        db.select().from(billingPlans).where(eq(billingPlans.isActive, true)),
        tenantBilling(scope.tenantId, async (tx) => {
          const [customer] = await tx.select().from(billingCustomers).where(eq(billingCustomers.tenantId, scope.tenantId));
          const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, scope.tenantId)).orderBy(desc(subscriptions.updatedAt)).limit(1);
          const methods = await tx.select().from(paymentMethods).where(eq(paymentMethods.tenantId, scope.tenantId)).orderBy(desc(paymentMethods.createdAt));
          const recentPayments = await tx.select().from(payments).where(eq(payments.tenantId, scope.tenantId)).orderBy(desc(payments.createdAt)).limit(10);
          return { customer, subscription, methods, recentPayments };
        }),
      ]);
      const currentPlan = state.subscription ? plans.find((plan) => plan.id === state.subscription?.planId) : plans.find((plan) => plan.key === "free");
      res.json({ configured: razorpayConfigured(), keyId: getRazorpayKeyId(), plans: plans.map(safePlan), currentPlan: currentPlan ? safePlan(currentPlan) : null, subscription: state.subscription ?? null, paymentMethods: state.methods.map(({ razorpayTokenId: _token, ...method }) => method), payments: state.recentPayments, customer: state.customer ? { name: state.customer.name, email: state.customer.email } : { name: dbUser.name, email: dbUser.email } });
    } catch (error) {
      console.error("Error fetching billing:", error);
      res.status(500).json({ message: "Failed to load billing information" });
    }
  });

  app.post("/api/billing/checkout/order", requireDbUser, requirePermission("billing:manage:tenant"), async (req, res) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Choose a valid plan" });
    if (!razorpayConfigured()) return res.status(503).json({ message: "Razorpay is not configured for this environment" });
    try {
      const { dbUser, tenant: scope } = authedOf(req);
      const [plan] = await db.select().from(billingPlans).where(and(eq(billingPlans.id, parsed.data.planId), eq(billingPlans.isActive, true)));
      if (!plan || plan.amount <= 0) return res.status(400).json({ message: "This plan does not require payment" });
      let [customer] = await db.select().from(billingCustomers).where(eq(billingCustomers.tenantId, scope.tenantId));
      if (!customer) {
        const remote = await createCustomer({ name: dbUser.name, email: dbUser.email, notes: { tenantId: scope.tenantId } });
        [customer] = await db.insert(billingCustomers).values({ tenantId: scope.tenantId, razorpayCustomerId: remote.id, email: dbUser.email, name: dbUser.name }).returning();
      }
      const order = await createOrder({ amount: plan.amount, currency: plan.currency, receipt: `tsp_${scope.tenantId}_${Date.now()}`, notes: { tenantId: scope.tenantId, planId: plan.id, customerId: customer.id } });
      res.status(201).json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: getRazorpayKeyId(), plan: safePlan(plan), prefill: { name: dbUser.name, email: dbUser.email } });
    } catch (error) {
      console.error("Error creating billing order:", error);
      res.status(502).json({ message: error instanceof Error ? error.message : "Could not start checkout" });
    }
  });

  app.post("/api/billing/checkout/verify", requireDbUser, requirePermission("billing:manage:tenant"), async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success || !verifyCheckoutSignature(parsed.data.razorpayOrderId, parsed.data.razorpayPaymentId, parsed.data.razorpaySignature)) return res.status(400).json({ message: "Payment verification failed" });
    try {
      const { tenant: scope } = authedOf(req);
      const [order, payment] = await Promise.all([fetchOrder(parsed.data.razorpayOrderId), fetchPayment(parsed.data.razorpayPaymentId)]);
      const planId = order.notes?.planId;
      const [plan] = planId ? await db.select().from(billingPlans).where(eq(billingPlans.id, planId)) : [];
      if (!plan || payment.order_id !== order.id || payment.amount !== plan.amount || payment.currency !== plan.currency || payment.status !== "captured") return res.status(400).json({ message: "Payment details could not be verified" });
      const result = await tenantBilling(scope.tenantId, async (tx) => {
        const [existing] = await tx.select().from(payments).where(eq(payments.razorpayPaymentId, payment.id));
        if (existing) return existing;
        const [subscription] = await tx.insert(subscriptions).values({ tenantId: scope.tenantId, billingCustomerId: order.notes?.customerId ?? "", planId: plan.id, status: "active", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86400000) }).returning();
        const [record] = await tx.insert(payments).values({ tenantId: scope.tenantId, subscriptionId: subscription.id, razorpayPaymentId: payment.id, razorpayOrderId: order.id, amount: payment.amount, currency: payment.currency, status: payment.status, method: payment.method, paidAt: new Date() }).returning();
        if (payment.card?.network || payment.card?.last4 || payment.vpa) await tx.insert(paymentMethods).values({ tenantId: scope.tenantId, type: payment.method ?? "unknown", cardNetwork: payment.card?.network ?? null, lastFour: payment.card?.last4 ?? null, upiVpaMasked: maskVpa(payment.vpa) });
        return record;
      });
      res.json({ success: true, payment: result });
      sendAppEmail({ type: "payment_succeeded", recipient: authedOf(req).dbUser.email, recipientName: authedOf(req).dbUser.name, userId: authedOf(req).dbUser.id, ...emailTemplates.paymentSucceeded(plan.name, `${payment.currency} ${(payment.amount / 100).toFixed(2)}`), required: true, dedupeKey: `payment:${payment.id}` }).catch((error) => console.error("Failed to send payment email:", error));
    } catch (error) {
      console.error("Error verifying billing payment:", error);
      res.status(502).json({ message: "Payment was received but could not be recorded. Please contact support." });
    }
  });

  app.post("/api/billing/subscription/cancel", requireDbUser, requirePermission("billing:manage:tenant"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const [subscription] = await tenantBilling(scope.tenantId, async (tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, scope.tenantId)).orderBy(desc(subscriptions.updatedAt)).limit(1));
      if (!subscription) return res.status(404).json({ message: "No active subscription found" });
      if (!["active", "authenticated"].includes(subscription.status)) return res.status(400).json({ message: "No active subscription found" });
      if (subscription.cancelAtPeriodEnd) return res.status(400).json({ message: "Subscription cancellation is already scheduled" });
      const [updated] = await tenantBilling(scope.tenantId, async (tx) => tx.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.tenantId, scope.tenantId))).returning());
      res.json({ success: true, subscription: updated });
      sendAppEmail({ type: "subscription_cancelled", recipient: authedOf(req).dbUser.email, recipientName: authedOf(req).dbUser.name, userId: authedOf(req).dbUser.id, ...emailTemplates.subscriptionCancelled(updated.currentPeriodEnd?.toLocaleDateString() ?? "the end of your billing period"), required: true, dedupeKey: `subscription-cancelled:${updated.id}` }).catch((error) => console.error("Failed to send cancellation email:", error));
    } catch (error) {
      console.error("Error cancelling subscription:", error);
      res.status(500).json({ message: "Could not cancel subscription" });
    }
  });

  app.post("/api/webhooks/razorpay", async (req, res) => {
    if (!razorpayWebhookConfigured()) return res.status(503).json({ message: "Razorpay webhook is not configured" });
    const signature = req.headers["x-razorpay-signature"];
    const eventId = req.headers["x-razorpay-event-id"];
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body));
    if (!signatureValue || !verifyWebhookSignature(rawBody, signatureValue)) return res.status(400).json({ message: "Invalid webhook signature" });
    const payload = req.body as { event?: string; payload?: { order?: { entity?: RazorpayOrderLike }; payment?: { entity?: RazorpayPaymentLike } } };
    const eventType = payload.event ?? "unknown";
    const order = payload.payload?.order?.entity;
    const payment = payload.payload?.payment?.entity;
    const tenantId = order?.notes?.tenantId;
    if (!tenantId) return res.status(200).json({ received: true });
    try {
      const id = typeof eventId === "string" && eventId ? eventId : hashWebhookPayload(rawBody);
      await tenantBilling(tenantId, async (tx) => {
        const [alreadyProcessed] = await tx.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.eventId, id));
        if (alreadyProcessed) return;
        await tx.insert(billingWebhookEvents).values({ eventId: id, eventType, payloadHash: hashWebhookPayload(rawBody), processingStatus: "processed", processedAt: new Date() });
        if (payment?.id && order?.id && payment.amount && order.notes?.planId) {
          const [plan] = await tx.select().from(billingPlans).where(eq(billingPlans.id, order.notes.planId));
          const [existing] = await tx.select().from(payments).where(eq(payments.razorpayPaymentId, payment.id));
          if (plan && !existing) {
            const [subscription] = await tx.insert(subscriptions).values({ tenantId, billingCustomerId: order.notes.customerId ?? "", planId: plan.id, status: payment.status === "captured" ? "active" : "pending", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86400000) }).returning();
            await tx.insert(payments).values({ tenantId, subscriptionId: subscription.id, razorpayPaymentId: payment.id, razorpayOrderId: order.id, amount: payment.amount, currency: payment.currency ?? "INR", status: payment.status ?? "unknown", method: payment.method ?? null, paidAt: payment.status === "captured" ? new Date() : null });
          }
        }
      });
      res.json({ received: true });
    } catch (error) {
      console.error("Error processing Razorpay webhook:", error);
      res.status(500).json({ message: "Webhook processing failed" });
    }
  });
}

type RazorpayOrderLike = { id: string; notes?: Record<string, string> };
type RazorpayPaymentLike = { id: string; order_id?: string; amount: number; currency?: string; status?: string; method?: string };
