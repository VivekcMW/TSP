import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailPreferenceDefaults } from "@shared/email-preferences";
import { guardNotificationsMediaNetwork } from "../../../test/notifications-media-network";
const mock = vi.hoisted(() => {
  process.env.RESEND_API_KEY = "test-placeholder-not-real";
  return { send: vi.fn(), preferences: vi.fn(), claim: vi.fn(), begin: vi.fn(), finish: vi.fn(), process: vi.fn(), add: vi.fn() };
});
vi.mock("resend", () => ({ Resend: class { emails = { send: mock.send }; } }));
vi.mock("./preferences", () => ({ getEmailPreferences: mock.preferences }));
vi.mock("./delivery-store", () => ({ claimDelivery: mock.claim, beginDelivery: mock.begin, finishDelivery: mock.finish, deliveryKey: (email: AppEmail) => typeof email.dedupeKey === "string" && email.dedupeKey.trim() ? "hashed-key" : null, recoverEmailDeliveries: vi.fn() }));
vi.mock("bull", () => ({ default: class { process = mock.process; add = mock.add; on = vi.fn(); close = vi.fn(); } }));
import { deliverAppEmail, initializeEmailQueue, registerEmailWorker, closeEmailQueue, sendAppEmail, sendVerificationEmail, sendPasswordResetEmail, type AppEmail } from "./index";
guardNotificationsMediaNetwork();
const email: AppEmail = { type: "daily_digest", recipient: "test@example.invalid", userId: "user", subject: "Digest", html: "<p>Scoped content</p>", dedupeKey: "slot" };
beforeEach(() => {
  vi.clearAllMocks();
  mock.preferences.mockResolvedValue({ ...emailPreferenceDefaults });
  mock.claim.mockResolvedValue({ id: "delivery", token: "fence" });
  mock.begin.mockResolvedValue(true);
  mock.finish.mockResolvedValue(undefined);
  mock.send.mockResolvedValue({ data: { id: "provider-id" }, error: null });
});
afterEach(async () => { await closeEmailQueue(); vi.unstubAllEnvs(); vi.mocked(console.warn).mockRestore?.(); });
function worker() {
  vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1"); vi.stubEnv("EMAIL_QUEUE_ENABLED", "true");
  initializeEmailQueue(); registerEmailWorker();
  return mock.process.mock.calls[0][1];
}
describe("email dispatch boundaries", () => {
  it("fails closed for optional mail without an attributable account", async () => {
    expect(await deliverAppEmail({ ...email, userId: undefined })).toEqual({ skipped: true });
    expect(mock.send).not.toHaveBeenCalled(); expect(mock.claim).not.toHaveBeenCalled();
  });
  it("essential verification still works without a user id", async () => {
    await deliverAppEmail({ ...email, userId: undefined, type: "verification" });
    expect(mock.send).toHaveBeenCalledOnce();
  });
  it.each(["verification", "password_reset"] as const)("fresh keyless direct %s retains essential delivery", async type => {
    const input = { ...email, userId: undefined, type, required: true, dedupeKey: undefined };
    expect(await deliverAppEmail(input)).toEqual({ messageId: "provider-id" });
    expect(mock.claim).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: expect.any(String) }));
    expect(mock.preferences).not.toHaveBeenCalled();
    expect(mock.send).toHaveBeenCalledOnce();
    expect(input.dedupeKey).toBeUndefined();
  });
  it("auth helpers remain direct with the queue enabled and optional mail opted out", async () => {
    worker();
    mock.preferences.mockResolvedValue({ ...emailPreferenceDefaults, unsubscribedAt: new Date() });
    await sendVerificationEmail(email.recipient, "Test", "https://example.invalid/verify?token=secret");
    await sendPasswordResetEmail(email.recipient, "Test", "https://example.invalid/reset?token=secret");
    expect(mock.add).not.toHaveBeenCalled();
    expect(mock.send).toHaveBeenCalledTimes(2);
    for (const [claimed] of mock.claim.mock.calls) expect(claimed.dedupeKey).toBeTruthy();
  });
  it.each([undefined, null, "", "  ", 42])("quarantines retained invalid identity %j without inventing a key", async dedupeKey => {
    const process = worker();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = { ...email, dedupeKey } as AppEmail;
    const job = { id: "secret-job-id", data, attemptsMade: 0, discard: vi.fn() };
    for (const attemptsMade of [0, 1, 3]) {
      job.attemptsMade = attemptsMade;
      await expect(process(job)).rejects.toThrow("Email job quarantined: missing durable delivery identity; manual reconciliation required; not sent");
    }
    expect(job.discard).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls).toEqual(Array.from({ length: 3 }, () => ["[email] Job quarantined: missing durable delivery identity; manual reconciliation required; not sent"]));
    expect(data.dedupeKey).toBe(dedupeKey);
    expect(mock.preferences).not.toHaveBeenCalled();
    expect(mock.claim).not.toHaveBeenCalled();
    expect(mock.begin).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.add).not.toHaveBeenCalled();
  });
  it("essential and required flags cannot authorize a keyless retained job", async () => {
    const process = worker();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(process({ data: { ...email, type: "password_reset", required: true, dedupeKey: undefined }, discard: vi.fn() })).rejects.toThrow("quarantined");
    expect(mock.claim).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "  ", "existing-key"])("new enqueue persists identity for input %j and retains it across workers", async dedupeKey => {
    const process = worker();
    const input = { ...email, dedupeKey };
    await sendAppEmail(input);
    const [queued, options] = mock.add.mock.calls[0];
    expect(queued.dedupeKey.trim()).not.toBe("");
    if (dedupeKey === "existing-key") expect(queued.dedupeKey).toBe(dedupeKey);
    expect(options).toEqual({ jobId: "hashed-key" });
    expect(input.dedupeKey).toBe(dedupeKey);
    mock.claim.mockResolvedValue(undefined);
    await process({ data: JSON.parse(JSON.stringify(queued)) });
    await process({ data: JSON.parse(JSON.stringify(queued)) });
    expect(mock.claim.mock.calls.map(([value]) => value.dedupeKey)).toEqual([queued.dedupeKey, queued.dedupeKey]);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("times out into unknown and never persists a late success as retryable", async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (value: unknown) => void;
      mock.send.mockImplementation(() => new Promise(done => { resolve = done; }));
      const assertion = expect(deliverAppEmail(email)).rejects.toThrow("unknown");
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
      resolve({ data: { id: "late-receipt" }, error: null });
      await Promise.resolve();
      expect(mock.finish).toHaveBeenCalledTimes(1);
      expect(mock.finish).toHaveBeenCalledWith(expect.anything(), "unknown");
    } finally { vi.useRealTimers(); }
  });
  it("rechecks preferences after claiming", async () => {
    mock.preferences.mockResolvedValueOnce(emailPreferenceDefaults).mockResolvedValueOnce({ ...emailPreferenceDefaults, dailyDigest: false });
    expect(await deliverAppEmail(email)).toEqual({ skipped: true });
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), "suppressed");
  });
  it("required flag cannot override optional category policy", async () => {
    mock.preferences.mockResolvedValue({ ...emailPreferenceDefaults, dailyDigest: false });
    await deliverAppEmail({ ...email, required: true });
    expect(mock.claim).not.toHaveBeenCalled();
  });
  it("duplicate or stale claim never reaches provider", async () => {
    mock.claim.mockResolvedValueOnce(undefined);
    await deliverAppEmail(email);
    mock.begin.mockResolvedValueOnce(false);
    await deliverAppEmail(email);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("records a receipt only after provider success", async () => {
    expect(await deliverAppEmail(email)).toEqual({ messageId: "provider-id" });
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), "sent", "provider-id");
  });
  it("transport exception is unknown, not failed", async () => {
    mock.send.mockRejectedValue(new Error("secret-token must not escape"));
    await expect(deliverAppEmail(email)).rejects.toThrow("outcome is unknown");
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), "unknown");
  });
  it.each(["application_error", "internal_server_error"])("SDK %s is uncertain", async name => {
    mock.send.mockResolvedValue({ error: { name, message: "secret" } });
    await expect(deliverAppEmail(email)).rejects.toThrow("unknown");
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), "unknown");
  });
  it("explicit rate-limit rejection can retry", async () => {
    mock.send.mockResolvedValue({ error: { name: "rate_limit_exceeded", message: "secret" } });
    await expect(deliverAppEmail(email)).rejects.toThrow("rejected");
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), "failed");
  });
  it("missing receipt never claims success", async () => {
    mock.send.mockResolvedValue({ data: null, error: null });
    await expect(deliverAppEmail(email)).rejects.toThrow("receipt missing");
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), "unknown");
  });
  it("failed receipt write never reclassifies an accepted send as failed", async () => {
    mock.finish.mockRejectedValue(new Error("database unavailable"));
    await expect(deliverAppEmail(email)).rejects.toThrow();
    expect(mock.finish).toHaveBeenCalledTimes(1);
    expect(mock.finish).toHaveBeenCalledWith(expect.anything(), "sent", "provider-id");
  });
  it("queued unsubscribe is checked by the actual worker", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1"); vi.stubEnv("EMAIL_QUEUE_ENABLED", "true");
    initializeEmailQueue(); registerEmailWorker();
    await sendAppEmail(email);
    expect(mock.send).not.toHaveBeenCalled();
    mock.preferences.mockResolvedValue({ ...emailPreferenceDefaults, dailyDigest: false });
    await mock.process.mock.calls[0][1]({ data: email });
    expect(mock.send).not.toHaveBeenCalled();
    await closeEmailQueue(); vi.unstubAllEnvs();
  });
});