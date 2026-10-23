import { beforeEach, expect, it, vi } from "vitest";
import { emailPreferenceDefaults } from "@shared/email-preferences";
const m = vi.hoisted(() => ({ send: vi.fn(), receipt: vi.fn(), preferences: vi.fn() }));
vi.mock("../../db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: m.receipt }) }) }) } }));
vi.mock("./index", () => ({ deliverAppEmail: m.send }));
vi.mock("./delivery-store", () => ({ deliveryKey: (email: { dedupeKey?: string }) => email.dedupeKey ?? null }));
vi.mock("./preferences", () => ({ getEmailPreferences: m.preferences }));
import { dispatchDurableEmail } from "./durable-dispatch";
const email = { type: "product_update" as const, userId: "u", recipient: "reader@example.invalid", subject: "Update", html: "<p>Update</p>", dedupeKey: "stable-key" };
beforeEach(() => {
  vi.clearAllMocks(); m.send.mockResolvedValue({ skipped: true }); m.preferences.mockResolvedValue(emailPreferenceDefaults);
  m.receipt.mockResolvedValue([]);
});
it.each(["sent", "suppressed", "unknown"])("advances outbox progress for terminal %s receipts", async status => {
  m.receipt.mockResolvedValue([{ status, attempts: 1 }]);
  expect(await dispatchDurableEmail(email)).toBe(status);
});
it.each(["pending", "sending", "failed"])("never treats a busy/backoff %s claim as completed", async status => {
  m.receipt.mockResolvedValue([{ status, attempts: 1 }]);
  expect(await dispatchDurableEmail(email)).toBeNull();
});
it("finishes explicit rejection after the bounded attempt limit", async () => {
  m.receipt.mockResolvedValue([{ status: "failed", attempts: 4 }]);
  expect(await dispatchDurableEmail(email)).toBe("failed");
});
it("suppresses opted-out recipients even if an earlier failed receipt exists", async () => {
  m.preferences.mockResolvedValue({ ...emailPreferenceDefaults, productUpdates: false });
  expect(await dispatchDurableEmail(email)).toBe("suppressed");
  expect(m.send).not.toHaveBeenCalled(); expect(m.receipt).not.toHaveBeenCalled();
});
it("allows essential billing notices without optional preferences or an account", async () => {
  expect(await dispatchDurableEmail({ ...email, type: "payment_failed", userId: undefined })).toBe("suppressed");
  expect(m.preferences).not.toHaveBeenCalled(); expect(m.send).toHaveBeenCalledOnce();
});
it("does not swallow transport errors or invent an identity", async () => {
  await expect(dispatchDurableEmail({ ...email, dedupeKey: undefined })).rejects.toThrow("stable identity");
  m.send.mockRejectedValue(new Error("provider unavailable"));
  await expect(dispatchDurableEmail(email)).rejects.toThrow("provider unavailable");
});
