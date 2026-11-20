import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const m = vi.hoisted(() => ({ notifications: vi.fn(), payment: vi.fn(), execute: vi.fn(), update: vi.fn(), dispatch: vi.fn() }));
vi.mock("../../db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: m.notifications }) }) }) }),
  update: () => ({ set: (data: unknown) => { m.update(data); return { where: async () => [] }; } }),
  transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
    execute: m.execute, select: () => ({ from: () => ({ where: () => ({ limit: m.payment }) }) }),
  }),
} }));
vi.mock("./index", async () => ({ emailTemplates: (await import("./templates")).emailTemplates }));
vi.mock("./durable-dispatch", () => ({ dispatchDurableEmail: m.dispatch }));
import { runBillingNotificationBatch } from "./billing-notifications";
beforeEach(() => {
  vi.clearAllMocks(); m.notifications.mockResolvedValue([{ id: "n", tenantId: "tenant", paymentId: "pay_1", recipient: "billing@example.invalid", recipientName: "Billing owner" }]);
  m.payment.mockResolvedValue([{ status: "failed" }]); m.dispatch.mockResolvedValue("sent");
});
it("sends essential failure emails to the persisted binding with payment-level identity", async () => {
  await runBillingNotificationBatch();
  expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({
    type: "payment_failed", recipient: "billing@example.invalid", recipientName: "Billing owner", required: true,
    dedupeKey: '["payment-failed-v1","tenant","pay_1"]',
  }));
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ outcome: "sent" }));
  expect(new PgDialect().sqlToQuery(m.execute.mock.calls[0][0]).params).toContain("tenant");
});
it.each(["captured", "refunded"])("suppresses obsolete failure messages after payment becomes %s", async status => {
  m.payment.mockResolvedValue([{ status }]);
  await runBillingNotificationBatch();
  expect(m.dispatch).not.toHaveBeenCalled(); expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ outcome: "suppressed" }));
});
it("keeps missing payment bindings and transport failures retryable, never a success-shaped fallback", async () => {
  m.payment.mockResolvedValueOnce([]);
  await runBillingNotificationBatch();
  expect(m.dispatch).not.toHaveBeenCalled(); expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: null }));
  m.dispatch.mockRejectedValueOnce(new Error("network unavailable"));
  await runBillingNotificationBatch();
  expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: null }));
});
it("respects lock loss and deadlines without dispatch", async () => {
  await runBillingNotificationBatch(undefined, Date.now() - 1);
  await expect(runBillingNotificationBatch(async () => { throw new Error("lost lock"); })).rejects.toThrow("lost lock");
  expect(m.dispatch).not.toHaveBeenCalled();
});
