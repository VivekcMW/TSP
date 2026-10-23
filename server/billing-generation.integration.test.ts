import { randomUUID } from "node:crypto";
import { requireLocalTestDatabase } from "../test/database-safety";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { billingCustomers, billingGenerationOperations as operations, billingPlans, billingWebhookEvents, paymentMethods, payments, subscriptions, tenants, type BillingPlan } from "@shared/schema";
import type { BillingProvider } from "./services/billing-repository";
import type { RazorpayPayment } from "./services/razorpay";

// Parent-only opt-in AFTER migrations 0032 and 0036. Never auto-migrates or reads
// dotenv; all payment/AI/network effects are mocked. Not run by this increment.
const enabled = process.env.BILLING_DB_TESTS === "true";
describe.skipIf(!enabled)("billing/quota PostgreSQL integration (0032 + 0036 prerequisites)", () => {
  let app: typeof import("./db"), owner: typeof import("../test/db-owner");
  let quota: typeof import("./services/generation-quota"), billing: typeof import("./services/billing-repository");
  let pro: BillingPlan;
  const tenantIds: string[] = [], events: string[] = [];
  const hash = "a".repeat(64);
  async function scope() {
    const tenantId = randomUUID(); tenantIds.push(tenantId);
    await owner.ownerDb.insert(tenants).values({ id: tenantId, name: "Billing isolated test" });
    return { tenantId, userId: randomUUID() };
  }
  beforeAll(async () => {
    requireLocalTestDatabase();
    for (const key of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "OPENROUTER_API_KEY", "OPENAI_API_KEY"]) {
      if (process.env[key]) throw new Error("Remove provider credentials from this DB-only test environment");
    }
    vi.stubGlobal("fetch", () => { throw new Error("External fetch forbidden in billing DB tests"); });
    app = await import("./db"); owner = await import("../test/db-owner");
    const role = await app.pool.query("select rolsuper, rolbypassrls from pg_roles where rolname=current_user");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await app.pool.query("select checkout_amount, checkout_currency, checkout_interval, checkout_provider_plan_id, checkout_provider_customer_id from subscriptions limit 0");
    await app.pool.query("select operation_id, input_hash, status, completed_at from billing_generation_operations limit 0");
    const flags = await app.pool.query("select relrowsecurity, relforcerowsecurity from pg_class where oid='billing_generation_operations'::regclass");
    expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const grants = await app.pool.query("select has_table_privilege(current_user, 'billing_generation_operations', 'SELECT') and has_table_privilege(current_user, 'billing_generation_operations', 'INSERT') and has_table_privilege(current_user, 'billing_generation_operations', 'UPDATE') as ok");
    expect(grants.rows[0].ok).toBe(true);
    const catalog = await app.db.select().from(billingPlans);
    expect(catalog.find(plan => plan.key === "free")?.isActive).toBe(true);
    pro = catalog.find(plan => plan.key === "pro_monthly" && plan.isActive)!;
    if (!pro) throw new Error("Existing active pro_monthly catalog required; tests do not seed or alter global plans");
    quota = await import("./services/generation-quota"); billing = await import("./services/billing-repository");
  });
  afterAll(async () => {
    try {
      if (owner && tenantIds.length) await owner.ownerDb.transaction(async tx => {
        for (const tenantId of tenantIds) {
          await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
          await tx.delete(operations).where(eq(operations.tenantId, tenantId));
          await tx.delete(paymentMethods).where(eq(paymentMethods.tenantId, tenantId));
          await tx.delete(payments).where(eq(payments.tenantId, tenantId));
          await tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId));
          await tx.delete(billingCustomers).where(eq(billingCustomers.tenantId, tenantId));
        }
        if (events.length) await tx.delete(billingWebhookEvents).where(inArray(billingWebhookEvents.eventId, events));
        await tx.delete(tenants).where(inArray(tenants.id, tenantIds));
      });
    } finally { await owner?.ownerPool.end(); await app?.pool.end(); vi.unstubAllGlobals(); }
  });
  const ledger = (tenantId: string) => billing.tenantBilling(tenantId, tx => tx.select().from(operations).where(eq(operations.tenantId, tenantId)));

  it("uses independent connections and admits only three parallel free attempts across tenant users", async () => {
    const a = await app.pool.connect(), b = await app.pool.connect();
    try {
      expect((await a.query("select pg_backend_pid() as pid")).rows[0].pid).not.toBe((await b.query("select pg_backend_pid() as pid")).rows[0].pid);
    } finally { a.release(); b.release(); }
    const tenant = await scope();
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => quota.reserveGeneration({ ...tenant, userId: randomUUID() }, randomUUID(), "manual", hash)));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(3);
    for (const result of outcomes) if (result.status === "rejected") expect(result.reason).toMatchObject({ statusCode: 429 });
    expect(await ledger(tenant.tenantId)).toHaveLength(3);
    const other = await scope(); await quota.reserveGeneration(other, randomUUID(), "manual", hash);
  });
  it("reserves one durable identity under concurrency, counts failures, and isolates user/tenant reads", async () => {
    const tenant = await scope(), id = randomUUID();
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => quota.reserveGeneration(tenant, id, "manual", hash)));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await ledger(tenant.tenantId)).toHaveLength(1);
    await quota.finishGeneration(tenant, id, "failed");
    await expect(quota.reserveGeneration(tenant, id, "manual", hash)).rejects.toMatchObject({ code: "generation_operation_consumed" });
    expect(await quota.readGenerationOperation({ ...tenant, userId: randomUUID() }, id)).toBeNull();
    const foreign = await scope(); expect(await quota.readGenerationOperation(foreign, id)).toBeNull();
    await quota.reserveGeneration(tenant, randomUUID(), "manual", hash); await quota.reserveGeneration(tenant, randomUUID(), "manual", hash);
    await expect(quota.reserveGeneration(tenant, randomUUID(), "manual", hash)).rejects.toMatchObject({ statusCode: 429 });
  });
  it("uses database UTC day boundaries while preserving old dedupe tombstones", async () => {
    const tenant = await scope(), id = randomUUID();
    await quota.reserveGeneration(tenant, id, "manual", hash);
    await owner.ownerDb.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant.tenantId}, true)`);
      await tx.update(operations).set({ createdAt: sql`date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC' - interval '1 microsecond'` }).where(eq(operations.tenantId, tenant.tenantId));
    });
    await Promise.all(Array.from({ length: 3 }, () => quota.reserveGeneration(tenant, randomUUID(), "manual", hash)));
    await expect(quota.reserveGeneration(tenant, randomUUID(), "manual", hash)).rejects.toMatchObject({ statusCode: 429 });
    await expect(quota.reserveGeneration(tenant, id, "manual", hash)).rejects.toMatchObject({ code: "generation_operation_consumed" });
    const recent = (await ledger(tenant.tenantId)).filter(row => row.operationId !== id);
    expect(recent.every(row => row.periodStart.getUTCHours() === 0 && row.periodEnd.getTime() - row.periodStart.getTime() === 86_400_000)).toBe(true);
  });
  it("enforces RLS without relying on application WHERE clauses, and rolls reservations back", async () => {
    const tenant = await scope(), foreign = await scope(), id = randomUUID();
    await quota.reserveGeneration(tenant, id, "manual", hash);
    expect(await app.db.select().from(operations).where(eq(operations.operationId, id))).toHaveLength(0);
    await billing.tenantBilling(foreign.tenantId, async tx => {
      expect(await tx.select().from(operations).where(eq(operations.operationId, id))).toHaveLength(0);
      expect(await tx.update(operations).set({ status: "failed", completedAt: new Date() }).where(eq(operations.operationId, id)).returning()).toHaveLength(0);
    });
    const original = (await ledger(tenant.tenantId))[0];
    await expect(billing.tenantBilling(foreign.tenantId, tx => tx.insert(operations).values({ ...original, operationId: randomUUID() }))).rejects.toBeDefined();
    const rollbackId = randomUUID();
    await expect(billing.tenantBilling(tenant.tenantId, async tx => {
      await tx.insert(operations).values({ ...original, operationId: rollbackId }); throw new Error("force rollback");
    })).rejects.toThrow("force rollback");
    expect(await quota.readGenerationOperation(tenant, rollbackId)).toBeNull();
  });

  async function fixture(recurring = false) {
    const tenant = await scope(), orderId = `order_${randomUUID()}`, paymentId = `pay_${randomUUID()}`, subId = `sub_${randomUUID()}`, customerId = `cust_${randomUUID()}`;
    const start = Math.floor(Date.now() / 1000) - 60, end = start + 33 * 86400;
    const remote = { id: subId, plan_id: "mock_plan", customer_id: customerId, status: "active", current_start: start, current_end: end, notes: { tenantId: tenant.tenantId } };
    const payment: RazorpayPayment = { id: paymentId, order_id: orderId, amount: pro.amount, currency: pro.currency, status: "captured", created_at: start, method: "card", card: { network: "Visa", last4: "1234" }, customer_id: customerId };
    const forbidden = vi.fn(async () => { throw new Error("Unexpected mocked provider method"); });
    const api: BillingProvider = {
      createCustomer: forbidden, createOrder: forbidden, createSubscription: forbidden, fetchPlan: forbidden, fetchInvoice: forbidden,
      fetchOrder: vi.fn(async () => ({ id: orderId, amount: pro.amount, currency: pro.currency, status: "paid", notes: { tenantId: tenant.tenantId } })),
      fetchPayment: vi.fn(async () => payment), fetchSubscription: vi.fn(async () => remote), cancelSubscription: vi.fn(async () => remote),
    };
    await owner.ownerDb.transaction(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant.tenantId}, true)`);
      const [customer] = await tx.insert(billingCustomers).values({ tenantId: tenant.tenantId, razorpayCustomerId: customerId, email: "billing@example.invalid", name: "Test" }).returning();
      await tx.insert(subscriptions).values({ tenantId: tenant.tenantId, billingCustomerId: customer.id, planId: pro.id, razorpayOrderId: recurring ? null : orderId,
        razorpaySubscriptionId: recurring ? subId : null, checkoutAmount: pro.amount, checkoutCurrency: pro.currency, checkoutInterval: pro.interval,
        checkoutProviderPlanId: recurring ? remote.plan_id : null, status: recurring ? "active" : "created", currentPeriodStart: recurring ? new Date(start * 1000) : null, currentPeriodEnd: recurring ? new Date(end * 1000) : null });
    });
    const event = { event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: orderId } } } };
    const eventId = `event_${randomUUID()}`; events.push(eventId);
    return { tenant, orderId, paymentId, eventId, event, payment, api, remote, repo: new billing.BillingRepository(api) };
  }
  it("commits parallel verify/webhook deliveries as one payment, method and unextended period", async () => {
    const f = await fixture();
    await Promise.all([f.repo.verify(f.tenant.tenantId, f.orderId, f.paymentId), ...Array.from({ length: 6 }, () => f.repo.webhook(f.eventId, hash, f.event))]);
    const state = await billing.readBillingState(f.tenant.tenantId);
    expect(state.recentPayments).toHaveLength(1); expect(state.methods).toHaveLength(1); expect(state.subscriptionRows).toHaveLength(1);
    const end = state.subscriptionRows[0].currentPeriodEnd;
    await f.repo.verify(f.tenant.tenantId, f.orderId, f.paymentId);
    expect((await billing.readBillingState(f.tenant.tenantId)).subscriptionRows[0].currentPeriodEnd).toEqual(end);
    expect(await app.db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.eventId, f.eventId))).toHaveLength(1);
    await expect(f.repo.webhook(f.eventId, "changed", f.event)).rejects.toMatchObject({ code: "event_conflict" });
    vi.mocked(f.api.fetchPayment).mockClear();
    await expect(f.repo.verify((await scope()).tenantId, f.orderId, f.paymentId)).rejects.toMatchObject({ statusCode: 404 });
    expect(f.api.fetchPayment).not.toHaveBeenCalled();
  });
  it("rolls back receipt AND payment on an actual database error after payment insertion", async () => {
    const f = await fixture(); f.payment.card!.network = "invalid\u0000postgres-text";
    await expect(f.repo.webhook(f.eventId, hash, f.event)).rejects.toBeDefined();
    expect((await billing.readBillingState(f.tenant.tenantId)).recentPayments).toHaveLength(0);
    expect(await app.db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.eventId, f.eventId))).toHaveLength(0);
    f.payment.card!.network = "Visa"; await f.repo.webhook(f.eventId, hash, f.event);
    expect((await billing.readBillingState(f.tenant.tenantId)).recentPayments).toHaveLength(1);
  });
  it("retains provider periods and truthfully handles cancellation failures under the shared lock", async () => {
    const f = await fixture(true), id = randomUUID();
    await quota.reserveGeneration(f.tenant, id, "manual", hash);
    expect(await quota.readGenerationOperation(f.tenant, id)).toMatchObject({ periodStart: new Date(f.remote.current_start * 1000), periodEnd: new Date(f.remote.current_end * 1000) });
    vi.mocked(f.api.cancelSubscription).mockRejectedValueOnce(new Error("mock provider unavailable"));
    await expect(f.repo.cancel(f.tenant.tenantId)).rejects.toThrow("mock provider unavailable");
    expect((await billing.readBillingState(f.tenant.tenantId)).subscriptionRows[0].cancelAtPeriodEnd).toBe(false);
    expect(await f.repo.cancel(f.tenant.tenantId)).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });
});