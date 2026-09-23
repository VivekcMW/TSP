import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailPreferenceDefaults } from "@shared/email-preferences";
import { guardNotificationsMediaNetwork } from "../../../test/notifications-media-network";

// Exercise the real worker + sender + delivery store with only in-memory I/O.
const m = vi.hoisted(() => {
  process.env.RESEND_API_KEY = "test-placeholder-not-real";
  return { rows: new Map<string, any>(), send: vi.fn(), preferences: vi.fn(), process: vi.fn(), add: vi.fn(), transaction: vi.fn(), insert: vi.fn(), bull: vi.fn() };
});
vi.mock("resend", () => ({ Resend: class { emails = { send: m.send }; } }));
vi.mock("bull", () => ({ default: class { constructor(...args: unknown[]) { m.bull(...args); } process = m.process; add = m.add; on = vi.fn(); close = vi.fn(); } }));
vi.mock("./preferences", () => ({ getEmailPreferences: m.preferences }));
vi.mock("../../db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const tx = {
    execute: vi.fn(),
    select: () => ({ from: () => ({ where: (condition: any) => ({ limit: async () => {
      const key = dialect.sqlToQuery(condition).params[0];
      return [...m.rows.values()].filter(row => row.dedupeKey === key).slice(0, 1);
    } }) }) }),
    insert: () => ({ values: (data: any) => {
      m.insert(data);
      const row = { ...data, id: `row-${m.rows.size + 1}` };
      m.rows.set(row.id, row);
      return { returning: async () => [row] };
    } }),
    update: () => ({ set: (data: any) => ({ where: (condition: any) => {
      const [id, token, status] = dialect.sqlToQuery(condition).params;
      const row = m.rows.get(String(id));
      const matches = row && (token === undefined || row.claimToken === token)
        && (status === undefined || (row.status === status && row.leaseUntil > new Date()));
      if (matches) Object.assign(row, data);
      return { returning: async () => matches ? [row] : [] };
    } }) }),
  };
  m.transaction.mockImplementation(async work => work(tx));
  return { db: { ...tx, transaction: m.transaction } };
});
import { initializeEmailQueue, registerEmailWorker, closeEmailQueue, sendAppEmail, type AppEmail } from "./index";
import { deliveryKey } from "./delivery-store";
guardNotificationsMediaNetwork();
const email: AppEmail = { type: "daily_digest", recipient: "test@example.invalid", userId: "user", subject: "Digest", html: "<p>private content</p>" };
function worker() {
  initializeEmailQueue(); registerEmailWorker();
  return m.process.mock.calls.at(-1)![1];
}
beforeEach(() => {
  vi.clearAllMocks(); m.rows.clear();
  vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1"); vi.stubEnv("EMAIL_QUEUE_ENABLED", "true");
  m.preferences.mockResolvedValue({ ...emailPreferenceDefaults });
  m.send.mockResolvedValue({ data: { id: "receipt" }, error: null });
});
afterEach(async () => { await closeEmailQueue(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.mocked(console.warn).mockRestore?.(); });

describe("retained email worker identity with real delivery state transitions", () => {
  it("never replays a legacy keyless job after an accepted timeout, including worker restart", async () => {
    // Historical evidence: old provider call may have accepted; old sender saved
    // unknown without a key. No safe mapping from job.id to that row exists.
    const legacy = { id: "legacy-row", dedupeKey: null, status: "unknown", attempts: 1, claimToken: null };
    m.rows.set(legacy.id, { ...legacy });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const job = { id: "private-job-id", data: { ...email }, attemptsMade: 1, discard: vi.fn() };
    const process = worker();
    for (let attempt = 1; attempt <= 3; attempt++) {
      job.attemptsMade = attempt;
      await expect(process(job)).rejects.toThrow("quarantined");
    }
    await closeEmailQueue();
    await expect(worker()({ ...job, data: JSON.parse(JSON.stringify(job.data)) })).rejects.toThrow("quarantined");
    expect(m.send).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.rows.size).toBe(1);
    expect(m.rows.get(legacy.id)).toEqual(legacy);
    expect(job.discard).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls).toEqual(Array.from({ length: 4 }, () => ["[email] Job quarantined: missing durable delivery identity; manual reconciliation required; not sent"]));
  });
  it("retains a new keyless enqueue's key after timeout and blocks every retry and late receipt", async () => {
    vi.useFakeTimers();
    const process = worker();
    await sendAppEmail(email);
    const [payload, options] = m.add.mock.calls[0];
    expect(payload.dedupeKey).toBeTruthy();
    expect(options).toEqual({ jobId: deliveryKey(payload) });
    expect(options.jobId).toMatch(/^[a-f0-9]{64}$/);
    let resolve!: (value: unknown) => void;
    m.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const job = { id: options.jobId, data: JSON.parse(JSON.stringify(payload)), discard: vi.fn() };
    const assertion = expect(process(job)).rejects.toThrow("unknown");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(m.rows.get("row-1")).toMatchObject({ status: "unknown", dedupeKey: options.jobId, attempts: 1 });
    for (let attempt = 0; attempt < 3; attempt++) expect(await process(job)).toEqual({ skipped: true });
    await closeEmailQueue();
    expect(await worker()({ ...job, data: JSON.parse(JSON.stringify(payload)) })).toEqual({ skipped: true });
    resolve({ data: { id: "late-receipt" }, error: null });
    await Promise.resolve();
    expect(m.send).toHaveBeenCalledOnce();
    expect(m.insert).toHaveBeenCalledOnce();
    expect(m.rows.size).toBe(1);
    expect(m.rows.get("row-1")).toMatchObject({ status: "unknown", providerMessageId: null, attempts: 1 });
  });
  it("still retries a known rejection on the same durable row after backoff", async () => {
    vi.useFakeTimers();
    const process = worker();
    await sendAppEmail({ ...email, dedupeKey: "explicit-slot" });
    const [payload, options] = m.add.mock.calls[0];
    expect(payload.dedupeKey).toBe("explicit-slot");
    expect(options.jobId).toBe(deliveryKey(payload));
    m.send.mockResolvedValueOnce({ error: { name: "rate_limit_exceeded", message: "private-provider-detail" } });
    const job = { data: payload };
    await expect(process(job)).rejects.toThrow("rejected");
    expect(m.rows.get("row-1")).toMatchObject({ status: "failed", attempts: 1 });
    await vi.advanceTimersByTimeAsync(65_000);
    expect(await process(job)).toEqual({ messageId: "receipt" });
    expect(m.rows.get("row-1")).toMatchObject({ status: "sent", attempts: 2 });
    expect(m.send).toHaveBeenCalledTimes(2);
    expect(m.insert).toHaveBeenCalledOnce();
  });
});
describe("email queue isolation", () => {
  it.each([["production", "bull"], ["development", "bull-development"]])("uses the %s Bull key prefix", (env, prefix) => {
    // A dev worker on production's Redis would otherwise send production's queued email.
    vi.stubEnv("NODE_ENV", env);
    initializeEmailQueue();
    expect(m.bull).toHaveBeenCalledWith("email_delivery", expect.objectContaining({ prefix }));
  });
});
