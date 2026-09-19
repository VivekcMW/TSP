import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { billingCustomers, billingPlans, billingWebhookEvents, payments, subscriptions } from "@shared/schema";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("../db", () => ({ db: mocks }));
import { BillingRepository, type BillingProvider } from "./billing-repository";
import type { RazorpayPayment, RazorpaySubscription } from "./razorpay";

// Transactional in-memory double. It executes the real repository, evaluates its
// equality predicates, models unique receipts/rollback and records advisory SQL.
// This is NOT evidence of PostgreSQL lock/RLS behavior; parent must run DB tests.
type Row = Record<string, any>;
const dialect = new PgDialect();
let tables: Record<string, Row[]>;
let statements: string[];
let failPaymentWrite: boolean;
let serial: Promise<unknown>;
function matching(row: Row, predicate?: SQL) {
  if (!predicate) return true;
  const query = dialect.sqlToQuery(predicate);
  return [...query.sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)].every(match => {
    const key = match[1].replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return row[key] === query.params[Number(match[2]) - 1];
  });
}
function builder(table: object, operation: "select" | "insert" | "update") {
  const name: string = getTableName(table as typeof subscriptions);
  let predicate: SQL | undefined;
  let values: Row = {};
  let ignore = false;
  let limit = Infinity;
  const run = () => {
    const rows = tables[name] ??= [];
    if (operation === "select") return rows.filter(row => matching(row, predicate)).slice(0, limit);
    if (operation === "update") return rows.filter(row => matching(row, predicate)).map(row => Object.assign(row, values));
    if (name === "payments" && failPaymentWrite) throw new Error("simulated write failure");
    const key = name === "billing_webhook_events" ? "eventId" : name === "payments" ? "razorpayPaymentId" : "id";
    if (values[key] && rows.some(row => row[key] === values[key])) {
      if (ignore) return [];
      throw new Error("unique violation");
    }
    const row = { id: `${name}-${rows.length}`, cancelAtPeriodEnd: false, currentPeriodStart: null, currentPeriodEnd: null, ...values };
    rows.push(row);
    return [row];
  };
  const chain = {
    where(value: SQL) { predicate = value; return chain; },
    orderBy() { return chain; },
    limit(value: number) { limit = value; return chain; },
    values(value: Row) { values = value; return chain; },
    set(value: Row) { values = value; return chain; },
    onConflictDoNothing() { ignore = true; return chain; },
    returning() { return chain; },
    then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve().then(run).then(resolve, reject); },
  };
  return chain;
}
const tx = {
  execute: vi.fn(async (query: SQL) => { statements.push(dialect.sqlToQuery(query).sql); }),
  select: () => ({ from: (table: object) => builder(table, "select") }),
  insert: (table: object) => builder(table, "insert"),
  update: (table: object) => builder(table, "update"),
};
const start = Date.parse("2026-01-31T12:00:00Z") / 1000;
const end = Date.parse("2026-03-04T12:00:00Z") / 1000;
let api: BillingProvider;
let repository: BillingRepository;
let payment: RazorpayPayment;
let remote: RazorpaySubscription;
const rows = (table: object) => tables[getTableName(table as typeof subscriptions)];
function seed(recurring = false) {
  rows(subscriptions).push({ id: "local", tenantId: "a", billingCustomerId: "customer", planId: "plan_pro_monthly", razorpayOrderId: recurring ? null : "order_1", razorpaySubscriptionId: recurring ? "sub_1" : null, checkoutAmount: 4900, checkoutCurrency: "INR", checkoutInterval: "monthly", checkoutProviderPlanId: recurring ? "rp_plan" : null, checkoutProviderCustomerId: null, status: "created", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
  if (recurring) { payment.invoice_id = "inv_1"; payment.customer_id = "recurring_customer"; }
}
const event = (type = "payment.captured") => ({ event: type, payload: { payment: { entity: { id: "pay_1", order_id: "order_1" } } } });
const lifecycle = (type = "subscription.activated", withPayment = false) => ({ event: type, payload: { subscription: { entity: { id: "sub_1" } }, ...(withPayment ? { payment: { entity: { id: "pay_1", invoice_id: "inv_1", order_id: "order_1" } } } : {}) } });

beforeEach(() => {
  tables = { billing_customers: [{ id: "customer", tenantId: "a", razorpayCustomerId: "cust_1" }], billing_plans: [{ id: "plan_pro_monthly", key: "pro_monthly", name: "Pro", amount: 4900, currency: "INR", interval: "monthly", isActive: true, razorpayPlanId: "rp_plan" }], subscriptions: [], payments: [], billing_webhook_events: [], payment_methods: [] };
  statements = []; failPaymentWrite = false; serial = Promise.resolve();
  mocks.transaction.mockImplementation((callback: (value: typeof tx) => Promise<unknown>) => {
    const result = serial.then(async () => { const snapshot = structuredClone(tables); try { return await callback(tx); } catch (error) { tables = snapshot; throw error; } });
    serial = result.catch(() => undefined);
    return result;
  });
  payment = { id: "pay_1", order_id: "order_1", amount: 4900, currency: "INR", status: "captured", created_at: start, method: "upi", vpa: "person@bank" };
  remote = { id: "sub_1", plan_id: "rp_plan", customer_id: "recurring_customer", status: "active", current_start: start, current_end: end, notes: { tenantId: "a" } };
  api = {
    createCustomer: vi.fn().mockResolvedValue({ id: "cust_new" }),
    createOrder: vi.fn().mockResolvedValue({ id: "order_1", amount: 4900, currency: "INR" }),
    fetchOrder: vi.fn(async () => ({ id: "order_1", amount: 4900, currency: "INR", status: "paid", notes: { tenantId: "a", planId: "wrong_notes_ignored", customerId: "wrong_notes_ignored" } })),
    fetchPayment: vi.fn(async () => ({ ...payment })),
    fetchSubscription: vi.fn(async () => ({ ...remote })),
    fetchInvoice: vi.fn().mockResolvedValue({ id: "inv_1", subscription_id: "sub_1", order_id: "order_1", payment_id: "pay_1", amount: 4900, currency: "INR" }),
    cancelSubscription: vi.fn(async () => ({ ...remote })),
    createSubscription: vi.fn(async () => ({ ...remote, status: "created" })),
    fetchPlan: vi.fn().mockResolvedValue({ id: "rp_plan", period: "monthly", interval: 1, item: { amount: 4900, currency: "INR" } }),
  };
  repository = new BillingRepository(api);
});

describe("persisted checkout ownership", () => {
  it("persists tenant/customer/price/interval before returning checkout", async () => {
    const result = await repository.checkout("a", { name: "User", email: "user@example.test" }, "plan_pro_monthly");
    expect(result.orderId).toBe("order_1");
    expect(rows(subscriptions)[0]).toMatchObject({ tenantId: "a", billingCustomerId: "customer", razorpayOrderId: "order_1", checkoutAmount: 4900, checkoutCurrency: "INR", checkoutInterval: "monthly" });
    expect(statements[0]).toContain("set_config"); expect(statements[1]).toContain("pg_advisory_xact_lock");
  });
  it("rejects another tenant's valid order BEFORE fetching payment", async () => {
    seed();
    await expect(repository.verify("b", "order_1", "pay_1")).rejects.toMatchObject({ statusCode: 404 });
    expect(api.fetchPayment).not.toHaveBeenCalled(); expect(rows(payments)).toHaveLength(0);
  });
  it("rejects absent scope and absent order", async () => {
    await expect(repository.verify("", "order_1", "pay_1")).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.verify("a", "unbound", "pay_1")).rejects.toMatchObject({ statusCode: 404 });
  });
  it("rejects an unowned customer or incomplete legacy binding", async () => {
    seed(); rows(billingCustomers)[0].tenantId = "b";
    await expect(repository.verify("a", "order_1", "pay_1")).rejects.toMatchObject({ code: "binding_incomplete" });
    rows(billingCustomers)[0].tenantId = "a"; rows(subscriptions)[0].checkoutAmount = null;
    await expect(repository.verify("a", "order_1", "pay_1")).rejects.toMatchObject({ code: "binding_incomplete" });
  });
  it.each([{ amount: 4901 }, { currency: "USD" }, { id: "other" }, { order_id: "other" }, { status: "authorized" }, { customer_id: "other" }])("rejects payment mismatch %j", async change => {
    seed(); Object.assign(payment, change);
    await expect(repository.verify("a", "order_1", "pay_1")).rejects.toBeInstanceOf(Error);
    expect(rows(payments)).toHaveLength(0); expect(rows(subscriptions)[0].status).toBe("created");
  });
  it("ignores mutable notes/catalog price in favor of immutable binding", async () => {
    seed(); rows(billingPlans)[0].amount = 9900;
    await repository.verify("a", "order_1", "pay_1");
    expect(rows(subscriptions)[0]).toMatchObject({ status: "active", planId: "plan_pro_monthly", currentPeriodEnd: new Date("2026-02-28T12:00:00Z") });
  });
  it("rejects a provider order price mismatch", async () => {
    seed(); vi.mocked(api.fetchOrder).mockResolvedValue({ id: "order_1", amount: 1, currency: "INR", status: "paid" });
    await expect(repository.verify("a", "order_1", "pay_1")).rejects.toMatchObject({ code: "order_mismatch" });
  });
  it("does not create a subscription for an invalid plan/interval", async () => {
    await expect(repository.checkout("a", { name: "User", email: "u@e.test" }, "missing")).rejects.toMatchObject({ code: "invalid_plan" });
    rows(billingPlans)[0].interval = "unknown";
    await expect(repository.checkout("a", { name: "User", email: "u@e.test" }, "plan_pro_monthly")).rejects.toMatchObject({ code: "unsupported_interval" });
    expect(api.createOrder).not.toHaveBeenCalled();
  });
  it("creates recurring checkout only with an exact provider catalog match", async () => {
    await repository.checkout("a", { name: "User", email: "u@e.test" }, "plan_pro_monthly", 12);
    expect(rows(subscriptions)[0]).toMatchObject({ razorpaySubscriptionId: "sub_1", checkoutProviderPlanId: "rp_plan" });
    vi.mocked(api.fetchPlan).mockResolvedValue({ id: "rp_plan", period: "yearly", interval: 1, item: { amount: 4900, currency: "INR" } });
    await expect(repository.checkout("a", { name: "User", email: "u@e.test" }, "plan_pro_monthly", 12)).rejects.toMatchObject({ code: "provider_plan_mismatch" });
    expect(api.createSubscription).toHaveBeenCalledTimes(1);
  });
});

describe("atomic webhook/payment lifecycle", () => {
  it("serializes concurrent verify/webhook/different receipts into one payment and period", async () => {
    seed();
    await Promise.all([repository.verify("a", "order_1", "pay_1"), repository.webhook("event_1", "hash", event()), repository.webhook("event_1", "hash", event()), repository.webhook("event_2", "hash", event())]);
    expect(rows(payments)).toHaveLength(1); expect(rows(subscriptions)).toHaveLength(1);
    expect(tables.payment_methods).toHaveLength(1); expect(rows(billingWebhookEvents)).toHaveLength(2);
    expect(rows(subscriptions)[0].currentPeriodEnd).toEqual(new Date("2026-02-28T12:00:00Z"));
    expect(rows(billingWebhookEvents).every(row => row.processingStatus === "processed")).toBe(true);
  });
  it("rolls receipt and payment back together and retries successfully", async () => {
    seed(); failPaymentWrite = true;
    await expect(repository.webhook("event_1", "hash", event())).rejects.toThrow("write failure");
    expect(rows(billingWebhookEvents)).toHaveLength(0); expect(rows(payments)).toHaveLength(0);
    failPaymentWrite = false; await repository.webhook("event_1", "hash", event());
    expect(rows(billingWebhookEvents)).toHaveLength(1); expect(rows(payments)).toHaveLength(1);
  });
  it("rejects a reused receipt ID with changed bytes", async () => {
    seed(); await repository.webhook("event_1", "hash", event());
    await expect(repository.webhook("event_1", "changed", event())).rejects.toMatchObject({ code: "event_conflict" });
  });
  it("promotes failed payment, but late failure never downgrades capture", async () => {
    seed(); payment.status = "failed"; payment.error_code = "BAD_CARD";
    await repository.webhook("failed", "f", event("payment.failed"));
    expect(rows(subscriptions)[0].status).toBe("pending"); expect(rows(payments)[0].failureCode).toBe("BAD_CARD");
    payment.status = "captured"; delete payment.error_code;
    await repository.webhook("captured", "c", event());
    payment.status = "failed";
    await repository.webhook("late_failed", "lf", event("payment.failed"));
    expect(rows(payments)).toHaveLength(1); expect(rows(payments)[0]).toMatchObject({ status: "captured", failureCode: null });
    expect(rows(subscriptions)[0].status).toBe("active");
  });
  it("does not acknowledge an unbound signed order", async () => {
    await expect(repository.webhook("e", "h", event())).rejects.toMatchObject({ code: "checkout_not_found" });
    expect(rows(billingWebhookEvents)).toHaveLength(0);
  });
  it("ignores unsupported events without provider calls or grants", async () => {
    await expect(repository.webhook("e", "h", { event: "unknown" })).resolves.toEqual({ ignored: true });
    expect(api.fetchOrder).not.toHaveBeenCalled(); expect(rows(subscriptions)).toHaveLength(0);
  });
  it("uses actual recurring periods, renews the same row, and records invoice-bound payments", async () => {
    seed(true);
    await repository.webhook("activate", "a", lifecycle());
    expect(rows(subscriptions)[0]).toMatchObject({ status: "active", currentPeriodEnd: new Date(end * 1000), checkoutProviderCustomerId: "recurring_customer" });
    remote.current_start = end; remote.current_end = end + 28 * 86400;
    await repository.webhook("charged", "b", lifecycle("subscription.charged", true));
    expect(rows(subscriptions)).toHaveLength(1); expect(rows(payments)).toHaveLength(1);
    expect(rows(subscriptions)[0].currentPeriodEnd).toEqual(new Date(remote.current_end * 1000));
  });
  it("does not apply an old activation after actual cancellation", async () => {
    seed(true); remote.status = "cancelled";
    await repository.webhook("cancel", "a", lifecycle("subscription.cancelled"));
    await repository.webhook("late_activate", "b", lifecycle());
    expect(rows(subscriptions)[0].status).toBe("cancelled");
  });
  it.each(["pending", "halted", "paused", "completed", "expired"])("reconciles %s even when arriving through a late activation event", async status => {
    seed(true); remote.status = status;
    await repository.webhook(status, "h", lifecycle());
    expect(rows(subscriptions)[0].status).toBe(status);
  });
  it("rejects mismatched invoice/subscription and rolls back its receipt", async () => {
    seed(true); vi.mocked(api.fetchInvoice).mockResolvedValue({ id: "inv_1", subscription_id: "other", order_id: "order_1", amount: 4900, currency: "INR" });
    await expect(repository.webhook("charged", "h", lifecycle("subscription.charged", true))).rejects.toMatchObject({ code: "invoice_mismatch" });
    expect(rows(payments)).toHaveLength(0); expect(rows(billingWebhookEvents)).toHaveLength(0);
  });
  it("rejects wrong provider plan and an altered bound provider customer", async () => {
    seed(true); remote.plan_id = "wrong";
    await expect(repository.webhook("e", "h", lifecycle())).rejects.toMatchObject({ code: "subscription_mismatch" });
    remote.plan_id = "rp_plan"; rows(subscriptions)[0].checkoutProviderCustomerId = "different";
    await expect(repository.webhook("e", "h", lifecycle())).rejects.toMatchObject({ code: "subscription_mismatch" });
  });
});

describe("truthful provider cancellation", () => {
  it("does not locally cancel when the provider fails", async () => {
    seed(true); rows(subscriptions)[0].status = "active";
    vi.mocked(api.cancelSubscription).mockRejectedValue(new Error("provider unavailable"));
    await expect(repository.cancel("a")).rejects.toThrow("provider unavailable");
    expect(rows(subscriptions)[0].cancelAtPeriodEnd).toBe(false);
  });
  it("uses the provider adapter and keeps paid period on cycle-end cancellation", async () => {
    seed(true); rows(subscriptions)[0].status = "active";
    const result = await repository.cancel("a");
    expect(api.cancelSubscription).toHaveBeenCalledWith("sub_1");
    expect(result).toMatchObject({ cancelAtPeriodEnd: true, status: "active", currentPeriodEnd: new Date(end * 1000) });
    await repository.cancel("a"); expect(api.cancelSubscription).toHaveBeenCalledTimes(1);
  });
  it("never pretends a one-time order is a recurring subscription", async () => {
    seed(); rows(subscriptions)[0].status = "active";
    await expect(repository.cancel("a")).rejects.toMatchObject({ code: "no_recurring_subscription" });
    expect(api.cancelSubscription).not.toHaveBeenCalled();
  });
  it("does not cancel a different tenant or accept a wrong provider response", async () => {
    seed(true); rows(subscriptions)[0].status = "active";
    await expect(repository.cancel("b")).rejects.toMatchObject({ code: "no_recurring_subscription" });
    vi.mocked(api.cancelSubscription).mockResolvedValue({ ...remote, id: "wrong" });
    await expect(repository.cancel("a")).rejects.toMatchObject({ code: "cancellation_unconfirmed" });
    expect(rows(subscriptions)[0].cancelAtPeriodEnd).toBe(false);
  });
});