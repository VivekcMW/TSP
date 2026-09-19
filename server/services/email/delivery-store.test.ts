import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardNotificationsMediaNetwork } from "../../../test/notifications-media-network";
const m = vi.hoisted(() => ({ existing: undefined as any, execute: vi.fn(), update: vi.fn(), insert: vi.fn(), returning: vi.fn(), transaction: vi.fn() }));
vi.mock("../../db", () => {
  const tx = { execute: m.execute,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => m.existing ? [m.existing] : [] }) }) }),
    update: () => ({ set: (data: unknown) => { m.update(data); return { where: () => ({ returning: m.returning }) }; } }),
    insert: () => ({ values: (data: unknown) => { m.insert(data); return { returning: m.returning }; } }),
  };
  m.transaction.mockImplementation(async work => work(tx));
  return { db: { ...tx, transaction: m.transaction } };
});
import { claimDelivery, deliveryKey, beginDelivery, finishDelivery, recoverEmailDeliveries } from "./delivery-store";
import type { AppEmail } from "./index";
guardNotificationsMediaNetwork();
const email: AppEmail = { userId: "u", type: "daily_digest", recipient: "x@example.invalid", subject: "test", html: "", dedupeKey: "secret-slot" };
beforeEach(() => { vi.clearAllMocks(); m.existing = undefined; m.returning.mockResolvedValue([{ id: "row" }]); });
describe("durable delivery state machine", () => {
  it("hashes potentially sensitive keys with user/type identity", () => {
    expect(deliveryKey(email)).toMatch(/^[a-f0-9]{64}$/);
    expect(deliveryKey({ ...email, userId: "other" })).not.toBe(deliveryKey(email));
    expect(deliveryKey({ ...email, type: "welcome" })).not.toBe(deliveryKey(email));
    expect(deliveryKey({ ...email, dedupeKey: undefined })).toBeNull();
  });
  it.each([undefined, null, "", " \t ", 42])("rejects keyless or malformed claim %j before any database work", async dedupeKey => {
    const input = { ...email, dedupeKey } as AppEmail;
    expect(deliveryKey(input)).toBeNull();
    await expect(claimDelivery(input)).rejects.toThrow("Email delivery requires a durable identity");
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
  it("inserts pending under transaction lock with bounded lease", async () => {
    const claim = await claimDelivery(email);
    expect(claim?.token).toBeTruthy(); expect(m.transaction).toHaveBeenCalledTimes(1); expect(m.execute).toHaveBeenCalledTimes(1);
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, status: "pending", dedupeKey: deliveryKey(email) }));
  });
  it.each(["sent", "unknown", "suppressed"])("does not replay %s", async status => {
    m.existing = { id: "row", status, attempts: 1 };
    expect(await claimDelivery(email)).toBeUndefined(); expect(m.insert).not.toHaveBeenCalled();
  });
  it("expired sending is unknown, not reclaimed", async () => {
    m.existing = { id: "row", status: "sending", leaseUntil: new Date(0), attempts: 1 };
    expect(await claimDelivery(email)).toBeUndefined();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "unknown" }));
  });
  it("active pending asks the queue to retry rather than completing stuck work", async () => {
    m.existing = { id: "row", status: "pending", leaseUntil: new Date(Date.now() + 30_000), attempts: 1 };
    await expect(claimDelivery(email)).rejects.toThrow("retry later");
  });
  it.each(["pending", "failed"])("reclaims safe expired %s with a fresh fence", async status => {
    m.existing = { id: "row", status, leaseUntil: new Date(0), retryAt: new Date(0), attempts: 1 };
    expect(await claimDelivery(email)).toMatchObject({ id: "row" });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", attempts: 2 }));
  });
  it("caps attempts and respects retry backoff", async () => {
    m.existing = { id: "row", status: "failed", attempts: 4 };
    expect(await claimDelivery(email)).toBeUndefined();
    m.existing = { id: "row", status: "failed", attempts: 1, retryAt: new Date(Date.now() + 60_000) };
    expect(await claimDelivery(email)).toBeUndefined();
    expect(m.update).not.toHaveBeenCalled();
  });
  it("requires a live pending fence before dispatch", async () => {
    m.returning.mockResolvedValueOnce([]);
    expect(await beginDelivery({ id: "row", token: "00000000-0000-4000-8000-000000000000" })).toBe(false);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "sending" }));
  });
  it("persists sanitized failures only and performs bounded recovery", async () => {
    await finishDelivery({ id: "row", token: "00000000-0000-4000-8000-000000000000" }, "unknown");
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "unknown", errorMessage: "Delivery outcome requires reconciliation" }));
    await recoverEmailDeliveries();
    expect(m.execute).toHaveBeenCalledTimes(3);
  });
});