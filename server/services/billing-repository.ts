import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { billingCustomers, billingPlans, billingWebhookEvents, paymentMethods, payments, subscriptions, type BillingPlan, type Subscription } from "@shared/schema";
import * as provider from "./razorpay";
import { BillingError, orderPeriodEnd, paymentCanAdvance, providerDate, subscriptionPatch } from "./billing-lifecycle";

export type BillingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Tx = BillingTransaction;
export type BillingProvider = Pick<typeof provider, "createCustomer" | "createOrder" | "fetchOrder" | "fetchPayment" | "fetchSubscription" | "fetchInvoice" | "cancelSubscription" | "createSubscription" | "fetchPlan">;

export async function tenantBilling<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!tenantId?.trim()) throw new BillingError(403, "tenant_required", "Tenant scope is required");
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    // Cross-process serialization: verify, webhook and cancel share this lock.
    const lockKey = `billing:${tenantId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    return fn(tx);
  });
}

export async function readBillingState(tenantId: string) {
  return tenantBilling(tenantId, async tx => {
    const [customer] = await tx.select().from(billingCustomers).where(eq(billingCustomers.tenantId, tenantId));
    const subscriptionRows = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).orderBy(desc(subscriptions.createdAt), desc(subscriptions.id));
    const methods = await tx.select().from(paymentMethods).where(eq(paymentMethods.tenantId, tenantId)).orderBy(desc(paymentMethods.createdAt));
    const recentPayments = await tx.select().from(payments).where(eq(payments.tenantId, tenantId)).orderBy(desc(payments.createdAt)).limit(10);
    return { customer, subscriptionRows, methods, recentPayments };
  });
}

export async function readEntitlementState(tenantId: string, transaction?: Tx) {
  const read = async (tx: Tx) => ({
    subscriptions: await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).orderBy(desc(subscriptions.createdAt), desc(subscriptions.id)),
    plans: await tx.select().from(billingPlans),
  });
  return transaction ? read(transaction) : tenantBilling(tenantId, read);
}

function orderPaymentPatch(local: Subscription, payment: provider.RazorpayPayment, paidAt: Date | null, capturedNow: boolean): Partial<Subscription> {
  if (capturedNow && !local.currentPeriodStart) return { status: "active", currentPeriodStart: paidAt, currentPeriodEnd: orderPeriodEnd(paidAt!, local.checkoutInterval!), updatedAt: new Date() };
  if (payment.status === "failed" && !local.currentPeriodStart) return { status: "pending", updatedAt: new Date() };
  if (payment.status === "refunded") return { status: "cancelled", endedAt: new Date(), updatedAt: new Date() };
  return {};
}

export class BillingRepository {
  constructor(private readonly api: BillingProvider = provider) {}

  private async validateRecurringPlan(plan: BillingPlan, totalCount: number) {
    if (!Number.isSafeInteger(totalCount) || totalCount < 1 || totalCount > 100) throw new BillingError(400, "invalid_cycles", "Choose 1–100 billing cycles");
    if (!plan.razorpayPlanId) throw new BillingError(409, "provider_plan_missing", "Recurring checkout is not configured for this plan");
    const remotePlan = await this.api.fetchPlan(plan.razorpayPlanId);
    let expectedPeriod = plan.interval;
    if (plan.interval === "annual") expectedPeriod = "yearly";
    if (plan.interval === "quarterly") expectedPeriod = "monthly";
    if (remotePlan.id !== plan.razorpayPlanId || remotePlan.item.amount !== plan.amount || remotePlan.item.currency !== plan.currency || remotePlan.period !== expectedPeriod || remotePlan.interval !== (plan.interval === "quarterly" ? 3 : 1)) {
      throw new BillingError(409, "provider_plan_mismatch", "Provider plan does not match the billing catalog");
    }
  }

  async checkout(tenantId: string, user: { name: string; email: string }, planId: string, totalCount?: number) {
    return tenantBilling(tenantId, async tx => {
      const [plan] = await tx.select().from(billingPlans).where(and(eq(billingPlans.id, planId), eq(billingPlans.isActive, true)));
      if (!plan || plan.amount <= 0) throw new BillingError(400, "invalid_plan", "Choose an active paid plan");
      orderPeriodEnd(new Date(), plan.interval); // Validate before any provider side effect.
      if (totalCount !== undefined) await this.validateRecurringPlan(plan, totalCount);
      let [customer] = await tx.select().from(billingCustomers).where(eq(billingCustomers.tenantId, tenantId));
      if (!customer) {
        const remote = await this.api.createCustomer({ ...user, notes: { tenantId } });
        if (!remote.id) throw new BillingError(502, "provider_customer_invalid", "Provider did not return a customer");
        [customer] = await tx.insert(billingCustomers).values({ tenantId, razorpayCustomerId: remote.id, ...user }).returning();
      }
      const notes = { tenantId, planId: plan.id, customerId: customer.id };
      const binding = { tenantId, billingCustomerId: customer.id, planId: plan.id, checkoutAmount: plan.amount, checkoutCurrency: plan.currency, checkoutInterval: plan.interval };
      if (totalCount !== undefined) {
        const remote = await this.api.createSubscription({ plan_id: plan.razorpayPlanId!, total_count: totalCount, quantity: 1, notes });
        if (!remote.id || remote.plan_id !== plan.razorpayPlanId) throw new BillingError(502, "provider_subscription_invalid", "Invalid provider subscription");
        await tx.insert(subscriptions).values({ ...binding, razorpaySubscriptionId: remote.id, checkoutProviderPlanId: plan.razorpayPlanId, status: "created" });
        return { subscriptionId: remote.id, plan };
      }
      const order = await this.api.createOrder({ amount: plan.amount, currency: plan.currency, receipt: `tsp_${randomUUID()}`, notes });
      if (!order.id || order.amount !== plan.amount || order.currency !== plan.currency) throw new BillingError(502, "provider_order_invalid", "Invalid provider order");
      await tx.insert(subscriptions).values({ ...binding, razorpayOrderId: order.id, status: "created" });
      return { orderId: order.id, amount: order.amount, currency: order.currency, plan };
    });
  }

  private async binding(tx: Tx, tenantId: string, id: string, recurring: boolean) {
    const [local] = await tx.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), eq(recurring ? subscriptions.razorpaySubscriptionId : subscriptions.razorpayOrderId, id))).limit(1);
    if (!local) throw new BillingError(404, "checkout_not_found", "Checkout not found in this tenant");
    const [customer] = await tx.select().from(billingCustomers).where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, local.billingCustomerId)));
    if (!customer || !local.checkoutAmount || !local.checkoutCurrency || !local.checkoutInterval) throw new BillingError(409, "binding_incomplete", "Billing binding requires reconciliation");
    return { local, customer };
  }

  private async remoteSubscription(local: Subscription) {
    const remote = await this.api.fetchSubscription(local.razorpaySubscriptionId!);
    if (remote.id !== local.razorpaySubscriptionId || remote.plan_id !== local.checkoutProviderPlanId || (local.checkoutProviderCustomerId && remote.customer_id !== local.checkoutProviderCustomerId)) {
      throw new BillingError(400, "subscription_mismatch", "Provider subscription does not match the persisted binding");
    }
    return remote;
  }

  private async validateInvoice(payment: provider.RazorpayPayment, subscriptionId: string) {
    if (!payment.invoice_id) throw new BillingError(400, "invoice_required", "A subscription invoice is required");
    const invoice = await this.api.fetchInvoice(payment.invoice_id);
    if (invoice.id !== payment.invoice_id || invoice.subscription_id !== subscriptionId || !payment.order_id || invoice.order_id !== payment.order_id || (invoice.payment_id && invoice.payment_id !== payment.id) || invoice.amount !== payment.amount || invoice.currency !== payment.currency) throw new BillingError(400, "invoice_mismatch", "Payment does not belong to this subscription");
  }

  private async validatedPayment(local: Subscription, paymentId: string, expectedCustomer: string, requireCaptured: boolean) {
    const payment = await this.api.fetchPayment(paymentId);
    if (payment.id !== paymentId || payment.amount !== local.checkoutAmount || payment.currency !== local.checkoutCurrency || (payment.customer_id && payment.customer_id !== expectedCustomer) || (requireCaptured && payment.status !== "captured")) {
      throw new BillingError(400, "payment_mismatch", "Payment details could not be verified");
    }
    if (local.razorpaySubscriptionId) await this.validateInvoice(payment, local.razorpaySubscriptionId);
    else if (payment.order_id !== local.razorpayOrderId) throw new BillingError(400, "order_mismatch", "Payment does not belong to this checkout");
    return payment;
  }

  private async savePaymentMethod(tx: Tx, tenantId: string, payment: provider.RazorpayPayment) {
    if (payment.card?.network || payment.card?.last4 || payment.vpa) await tx.insert(paymentMethods).values({ tenantId, type: payment.method ?? "unknown", cardNetwork: payment.card?.network ?? null, lastFour: payment.card?.last4 ?? null, upiVpaMasked: provider.maskVpa(payment.vpa) });
  }

  private async savePayment(tx: Tx, local: Subscription, payment: provider.RazorpayPayment) {
    const tenantId = local.tenantId;
    const [existing] = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.razorpayPaymentId, payment.id)));
    if (existing && (existing.subscriptionId !== local.id || existing.razorpayOrderId !== payment.order_id || existing.amount !== payment.amount || existing.currency !== payment.currency)) throw new BillingError(409, "payment_reused", "Payment is already bound elsewhere");
    if (!paymentCanAdvance(existing?.status, payment.status)) {
      if (!existing) throw new BillingError(400, "payment_state_invalid", "Unsupported payment state");
      return { record: existing, capturedNow: false, advanced: false };
    }
    const capturedNow = payment.status === "captured";
    const paidAt = capturedNow ? providerDate(payment.created_at) : existing?.paidAt ?? null;
    if (capturedNow && !paidAt) throw new BillingError(502, "payment_date_invalid", "Provider did not return a payment date");
    const values = { status: payment.status, method: payment.method ?? null, failureCode: payment.error_code ?? null, failureDescription: payment.error_description ?? null, paidAt };
    let record: typeof payments.$inferSelect;
    if (existing) {
      [record] = await tx.update(payments).set(values).where(and(eq(payments.id, existing.id), eq(payments.tenantId, tenantId))).returning();
    } else {
      [record] = await tx.insert(payments).values({ ...values, tenantId, subscriptionId: local.id, razorpayPaymentId: payment.id, razorpayOrderId: payment.order_id, amount: payment.amount, currency: payment.currency }).returning();
    }
    if (capturedNow) await this.savePaymentMethod(tx, tenantId, payment);
    return { record, capturedNow, advanced: true };
  }

  private async reconcile(tx: Tx, tenantId: string, id: string, recurring: boolean, paymentId?: string, requireCaptured = false) {
    const { local, customer } = await this.binding(tx, tenantId, id, recurring);
    // Fetch INSIDE the tenant lock: stale in-flight requests cannot overwrite newer state.
    const remote = recurring ? await this.remoteSubscription(local) : undefined;
    if (!recurring) {
      const order = await this.api.fetchOrder(id);
      if (order.id !== local.razorpayOrderId || order.amount !== local.checkoutAmount || order.currency !== local.checkoutCurrency) throw new BillingError(400, "order_mismatch", "Provider order does not match the persisted checkout");
    }
    let patch: Partial<Subscription> = remote ? subscriptionPatch(local, remote) : {};
    if (remote?.customer_id && !local.checkoutProviderCustomerId) patch.checkoutProviderCustomerId = remote.customer_id;
    let record: typeof payments.$inferSelect | undefined;
    let capturedNow = false;
    if (paymentId) {
      const payment = await this.validatedPayment(local, paymentId, remote?.customer_id ?? customer.razorpayCustomerId, requireCaptured);
      const saved = await this.savePayment(tx, local, payment);
      record = saved.record;
      capturedNow = saved.capturedNow;
      if (!recurring && saved.advanced) patch = orderPaymentPatch(local, payment, record.paidAt, capturedNow);
    }
    if (Object.keys(patch).length) await tx.update(subscriptions).set(patch).where(and(eq(subscriptions.id, local.id), eq(subscriptions.tenantId, tenantId)));
    return { payment: record, capturedNow, subscription: { ...local, ...patch } };
  }

  verify(tenantId: string, id: string, paymentId: string, recurring = false) {
    return tenantBilling(tenantId, tx => this.reconcile(tx, tenantId, id, recurring, paymentId, true));
  }

  async cancel(tenantId: string) {
    return tenantBilling(tenantId, async tx => {
      const rows = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).orderBy(desc(subscriptions.createdAt), desc(subscriptions.id));
      const local = rows.find(row => row.razorpaySubscriptionId && ["active", "authenticated", "pending", "halted", "paused"].includes(row.status));
      if (!local) throw new BillingError(409, "no_recurring_subscription", "No renewable provider subscription found; order purchases expire automatically");
      if (local.cancelAtPeriodEnd) return local;
      await this.binding(tx, tenantId, local.razorpaySubscriptionId!, true);
      const current = await this.remoteSubscription(local);
      const remote = ["cancelled", "completed", "expired"].includes(current.status) ? current : await this.api.cancelSubscription(current.id);
      if (remote.id !== current.id || remote.plan_id !== local.checkoutProviderPlanId) throw new BillingError(502, "cancellation_unconfirmed", "Provider did not confirm cancellation");
      const ended = ["cancelled", "completed", "expired"].includes(remote.status);
      // A successful cancel endpoint leaves status active until cycle end.
      // has_scheduled_changes describes plan updates and is not a cancel receipt.
      if (!ended && (remote.status !== "active" || !providerDate(remote.current_end))) throw new BillingError(502, "cancellation_unconfirmed", "Provider did not confirm cycle-end cancellation");
      const patch = subscriptionPatch(local, remote);
      const [updated] = await tx.update(subscriptions).set({ ...patch, cancelAtPeriodEnd: !ended, updatedAt: new Date() }).where(and(eq(subscriptions.id, local.id), eq(subscriptions.tenantId, tenantId))).returning();
      return updated;
    });
  }

  async webhook(eventId: string, payloadHash: string, payload: { event: string; payload?: { order?: { entity?: { id?: string } }; payment?: { entity?: { id?: string; order_id?: string; invoice_id?: string | null } }; subscription?: { entity?: { id?: string } } } }) {
    const supported = ["payment.captured", "payment.failed", "payment.authorized", "order.paid", "subscription.authenticated", "subscription.activated", "subscription.charged", "subscription.pending", "subscription.halted", "subscription.paused", "subscription.resumed", "subscription.cancelled", "subscription.completed", "subscription.expired", "subscription.updated"];
    if (!supported.includes(payload.event)) return { ignored: true };
    const payment = payload.payload?.payment?.entity;
    let subscriptionId = payload.payload?.subscription?.entity?.id;
    const orderId = payload.payload?.order?.entity?.id ?? payment?.order_id;
    // These fetches locate the tenant only. All entities are revalidated under lock.
    if (!subscriptionId && payment?.invoice_id) subscriptionId = (await this.api.fetchInvoice(payment.invoice_id)).subscription_id;
    let routing: provider.RazorpaySubscription | provider.RazorpayOrder | undefined;
    if (subscriptionId) routing = await this.api.fetchSubscription(subscriptionId);
    else if (orderId) routing = await this.api.fetchOrder(orderId);
    const tenantId = routing?.notes?.tenantId;
    if (!tenantId || !(subscriptionId || orderId)) throw new BillingError(409, "webhook_binding_missing", "Webhook binding is not available; retry after reconciliation");
    return tenantBilling(tenantId, async tx => {
      const [claimed] = await tx.insert(billingWebhookEvents).values({ eventId, eventType: payload.event, payloadHash, processingStatus: "processing" }).onConflictDoNothing({ target: billingWebhookEvents.eventId }).returning();
      if (!claimed) {
        const [previous] = await tx.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.eventId, eventId));
        if (previous?.payloadHash !== payloadHash || previous.processingStatus !== "processed") throw new BillingError(409, "event_conflict", "Webhook event conflicts with its receipt");
        return { duplicate: true };
      }
      if (!subscriptionId && !payment?.id) throw new BillingError(400, "payment_required", "Payment entity is required");
      await this.reconcile(tx, tenantId, (subscriptionId ?? orderId)!, Boolean(subscriptionId), payment?.id);
      await tx.update(billingWebhookEvents).set({ processingStatus: "processed", processedAt: new Date() }).where(eq(billingWebhookEvents.id, claimed.id));
      return { duplicate: false };
    });
  }
}

export const billingRepository = new BillingRepository();