import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import Bull from "bull";

// Never load configured Redis, authentication, DB, or provider execution.
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../services/editorial-request", () => ({ executeEditorialRequest: vi.fn() }));
vi.mock("../services/tenancy", () => ({ resolveTenantContext: vi.fn() }));
import { EditorialJobs, editorialInputHash, EDITORIAL_INPUT_TTL, EDITORIAL_RESULT_TTL, EDITORIAL_DEADLINE_MS } from "./editorial";
import { buildEvidenceBrief } from "../services/editorialEvidence";
import type { executeEditorialRequest, PreparedEditorialRequest } from "../services/editorial-request";

const scope = { tenantId: "tenant-a", userId: "user-a" };
const prepared: PreparedEditorialRequest = { input: { requestIntent: randomUUID(), title: "Pilot", content: "The publisher reports a successful trial in thirty stores.", media: [], selectedPlatforms: ["linkedin", "medium"], format: "short-post" }, options: { voice: "Saved voice", scope: { tenantId: scope.tenantId }, format: "short-post" } };
const freshIntent = (): PreparedEditorialRequest => ({ ...prepared, input: { ...prepared.input, requestIntent: randomUUID() } });
const article = { title: "Pilot", content: "Desk reports a trial in thirty stores.", source: "Desk", url: "", media: [], domain: "manual",
  contentMetadata: { extractionMethod: "manual" as const, originalLength: 37, retainedLength: 37, truncated: false } };
const tones = { thoughtLeader: "Generated text", industryInsider: "Generated text", provocateur: "Generated text", dataDriven: "Generated text" };
const output: Awaited<ReturnType<typeof executeEditorialRequest>> = { article, posts: { linkedin: tones, medium: tones }, details: {}, evidence: buildEvidenceBrief(article), usage: { inputTokens: 10, outputTokens: 20 }, fallbackUsed: false, format: "short-post" };
const recordKey = (id: string) => `editorial:v1:job:${id}`;

describe("editorial stable identity", () => {
  it("includes user, tenant, saved voice, content, selection, model and pipeline version", () => {
    const hash = editorialInputHash(scope, prepared, "model-a");
    expect(editorialInputHash(scope, freshIntent(), "model-a")).not.toBe(hash);
    expect(editorialInputHash({ ...scope, userId: "user-b" }, prepared, "model-a")).not.toBe(hash);
    expect(editorialInputHash({ ...scope, tenantId: "tenant-b" }, prepared, "model-a")).not.toBe(hash);
    expect(editorialInputHash(scope, { ...prepared, options: { ...prepared.options, voice: "Changed" } }, "model-a")).not.toBe(hash);
    expect(editorialInputHash(scope, { ...prepared, input: { ...prepared.input, selectedPlatforms: ["linkedin"] } }, "model-a")).not.toBe(hash);
    expect(editorialInputHash(scope, prepared, "model-b")).not.toBe(hash);
    expect(editorialInputHash(scope, { ...prepared, input: { ...prepared.input, selectedPlatforms: ["medium", "linkedin"] } }, "model-a")).toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// Optional integration coverage: a private, disposable Unix-socket Redis process.
// No configured host/URL, network port, existing DB, or live provider is used.
const binary = ["/opt/homebrew/bin/redis-server", "/usr/local/bin/redis-server", "/usr/bin/redis-server"].find(existsSync);
describe.skipIf(!binary)("editorial Redis state machine and Bull worker", () => {
  let directory: string;
  let socket: string;
  let child: ChildProcess;
  let store: Redis;
  let jobs: EditorialJobs;
  const add = vi.fn();
  const execute = vi.fn<typeof executeEditorialRequest>();
  const allowed = vi.fn(async () => true);

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "editorial-test-"));
    // macOS Unix-socket names must remain below its sockaddr_un path limit.
    socket = join(directory, "redis.sock");
    child = spawn(binary!, ["--port", "0", "--unixsocket", socket, "--unixsocketperm", "700", "--save", "", "--appendonly", "no"], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Local test Redis did not start")), 5000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Local test Redis exited")); });
      child.stdout!.on("data", data => {
        if (String(data).toLowerCase().includes("ready to accept connections")) { clearTimeout(timer); resolve(); }
      });
    });
    store = new Redis({ path: socket, maxRetriesPerRequest: 1 });
    await store.ping();
  }, 10_000);
  afterAll(async () => {
    await store?.quit();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await store.flushdb(); // Exclusively this test's private Unix-socket process.
    vi.clearAllMocks();
    add.mockResolvedValue({}); allowed.mockResolvedValue(true);
    execute.mockImplementation(async (input, signal, progress) => {
      signal.throwIfAborted();
      for (const platform of input.input.selectedPlatforms) await progress?.(platform);
      return output;
    });
    jobs = new EditorialJobs(store, { add } as any, execute, allowed);
  });
  afterEach(() => { jobs?.abortWorkers(); vi.unstubAllEnvs(); });

  it("atomically deduplicates concurrent requests, emits progress and retains only scoped TTL results", async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => jobs.enqueue(scope, prepared)));
    expect(new Set(ids).size).toBe(1);
    const id = ids[0];
    expect(await store.ttl(recordKey(id))).toBeGreaterThan(0);
    expect(await store.ttl(recordKey(id))).toBeLessThanOrEqual(EDITORIAL_INPUT_TTL);
    expect(add).toHaveBeenCalledWith({ id }, expect.objectContaining({ attempts: 1, removeOnComplete: true, removeOnFail: true }));
    expect(JSON.stringify(add.mock.calls)).not.toContain("Saved voice");
    await Promise.all([jobs.process(id), jobs.process(id)]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await jobs.status(scope, id)).toMatchObject({ status: "completed", progress: { platformsCompleted: 2, platformsTotal: 2 } });
    expect(await jobs.result(scope, id)).toEqual(output);
    expect(await store.hget(recordKey(id), "input")).toBeNull();
    expect(await store.ttl(recordKey(id))).toBeLessThanOrEqual(EDITORIAL_RESULT_TTL);
    expect(await jobs.enqueue(scope, prepared)).toBe(id);
    expect(execute).toHaveBeenCalledTimes(1);
    for (const other of [{ ...scope, userId: "user-b" }, { ...scope, tenantId: "tenant-b" }]) {
      expect(await jobs.status(other, id)).toBeNull();
      expect(await jobs.result(other, id)).toBeNull();
      expect(await jobs.cancel(other, id)).toBe(false);
      expect(await jobs.enqueue(other, prepared)).not.toBe(id);
    }
  });

  it("regenerates identical input with a fresh intent while completed intent retries never spend twice", async () => {
    const first = await jobs.enqueue(scope, prepared);
    await jobs.process(first);
    expect(await jobs.enqueue(scope, prepared)).toBe(first);
    const regenerated = await jobs.enqueue(scope, freshIntent());
    expect(regenerated).not.toBe(first);
    await jobs.process(regenerated);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("retains failed intent reservations without partial results and sanitizes provider errors", async () => {
    execute.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_RESPONSE"));
    const id = await jobs.enqueue(scope, prepared);
    await jobs.process(id);
    expect(await jobs.status(scope, id)).toMatchObject({ status: "failed", error: { status: 500 } });
    expect(JSON.stringify(await jobs.status(scope, id))).not.toContain("PRIVATE_PROVIDER_RESPONSE");
    expect(await jobs.result(scope, id)).toBeNull();
    await jobs.process(id);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await jobs.enqueue(scope, prepared)).toBe(id);
    expect(await jobs.enqueue(scope, freshIntent())).not.toBe(id);
  });

  it("does not readmit an uncertain intent when its result expires before the retry deadline", async () => {
    const id = await jobs.enqueue(scope, prepared);
    await jobs.process(id);
    const dedupe = await store.hget(recordKey(id), "dedupe");
    expect(await store.ttl(dedupe!)).toBeGreaterThan(310);
    await store.expire(recordKey(id), 0);
    await expect(jobs.enqueue(scope, prepared)).rejects.toThrow("Editorial queue unavailable");
    expect(add).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("cancels a waiting job before any provider work and prevents same-intent replay", async () => {
    const id = await jobs.enqueue(scope, prepared);
    expect(await jobs.cancel(scope, id)).toBe(true);
    await jobs.process(id);
    expect(execute).not.toHaveBeenCalled();
    expect(await jobs.status(scope, id)).toMatchObject({ status: "cancelled" });
    expect(await jobs.enqueue(scope, prepared)).toBe(id);
    expect(await jobs.enqueue(scope, freshIntent())).not.toBe(id);
  });

  it("cancels an active worker across instances using the Redis flag and real AbortSignal", async () => {
    execute.mockImplementationOnce(async (_input, signal, progress) => {
      await progress?.("linkedin");
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const id = await jobs.enqueue(scope, prepared);
    const work = jobs.process(id);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const secondInstance = new EditorialJobs(store, { add } as any, execute, allowed);
    expect(await secondInstance.cancel({ ...scope, userId: "other" }, id)).toBe(false);
    expect(await jobs.status(scope, id)).toMatchObject({ status: "active", progress: { platformsCompleted: 1 } });
    await secondInstance.cancel(scope, id);
    await work;
    expect(execute.mock.calls[0][1].aborted).toBe(true);
    expect(await jobs.status(scope, id)).toMatchObject({ status: "cancelled" });
    expect(await jobs.result(scope, id)).toBeNull();
  });

  it("does not let a late completion overwrite cancellation", async () => {
    let finish!: (value: typeof output) => void;
    execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const id = await jobs.enqueue(scope, prepared);
    const work = jobs.process(id);
    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    await jobs.cancel(scope, id);
    finish(output);
    await work;
    expect(await jobs.status(scope, id)).toMatchObject({ status: "cancelled" });
    expect(await jobs.result(scope, id)).toBeNull();
  });

  it("rejects stale inputs, revoked permission, and changed models before spend", async () => {
    const stale = await jobs.enqueue(scope, prepared);
    await store.hset(recordKey(stale), "createdAt", Date.now() - EDITORIAL_DEADLINE_MS - 1);
    await jobs.process(stale);
    expect(await jobs.status(scope, stale)).toMatchObject({ status: "failed", error: { body: { code: "ai_timeout" } } });
    allowed.mockResolvedValueOnce(false);
    const revoked = await jobs.enqueue(scope, freshIntent()); await jobs.process(revoked);
    expect(await jobs.status(scope, revoked)).toMatchObject({ status: "failed" });
    const changed = await jobs.enqueue(scope, freshIntent());
    vi.stubEnv("ANTHROPIC_MODEL", "new-model-version");
    await jobs.process(changed);
    expect(await jobs.status(scope, changed)).toMatchObject({ status: "failed", error: { body: { code: "ai_configuration" } } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("expires source snapshots/results and reports stuck workers without replay", async () => {
    const id = await jobs.enqueue(scope, prepared);
    await store.hset(recordKey(id), "status", "active", "createdAt", Date.now() - EDITORIAL_DEADLINE_MS - 1);
    expect(await jobs.status(scope, id)).toMatchObject({ status: "failed" });
    const next = await jobs.enqueue(scope, freshIntent()); await jobs.process(next);
    const key = await store.hget(recordKey(next), "dedupe");
    await store.expire(recordKey(next), 0); await store.expire(key!, 0);
    expect(await jobs.status(scope, next)).toBeNull(); expect(await jobs.result(scope, next)).toBeNull();
    expect(await jobs.enqueue(scope, freshIntent())).not.toBe(next);
  });

  it("keeps the same reservation after uncertain enqueue errors; never falls back to a provider", async () => {
    add.mockRejectedValueOnce(new Error("PRIVATE_REDIS_ERROR"));
    await expect(jobs.enqueue(scope, prepared)).rejects.toThrow("Editorial queue unavailable");
    const submittedId = add.mock.calls[0][0].id;
    expect(await jobs.enqueue(scope, prepared)).toBe(submittedId);
    expect(execute).not.toHaveBeenCalled();
  });

  it("actually executes through Bull once and keeps content out of Bull payload/returnvalue", async () => {
    const clients: Redis[] = [];
    const queue = new Bull<{ id: string }>("editorial-test", {
      createClient: type => {
        const client = new Redis({ path: socket, maxRetriesPerRequest: type === "client" ? 1 : null, enableReadyCheck: false });
        clients.push(client); return client as any;
      }, settings: { maxStalledCount: 0 },
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    });
    const actual = new EditorialJobs(store, queue, execute, allowed);
    try {
      queue.process(job => actual.process(job.data.id));
      const [id, duplicate] = await Promise.all([actual.enqueue(scope, prepared), actual.enqueue(scope, prepared)]);
      expect(duplicate).toBe(id);
      await vi.waitFor(async () => expect(await actual.status(scope, id)).toMatchObject({ status: "completed" }));
      expect(execute).toHaveBeenCalledTimes(1);
      expect(await actual.result(scope, id)).toEqual(output);
      await vi.waitFor(async () => expect(await queue.getJob(id)).toBeNull());
    } finally { actual.abortWorkers(); await queue.close(); clients.forEach(client => client.disconnect()); }
  }, 10_000);
});