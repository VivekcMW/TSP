import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import Redis from "ioredis";
import Bull from "bull";
import { disposableRedisAvailable, startDisposableRedis } from "../../test/disposable-redis";

// Never load configured Redis, authentication, DB, or provider execution.
const initializationRedis = vi.hoisted(() => ({ current: undefined as Redis | undefined }));
vi.mock("../lib/redis", () => ({ get redis() { return initializationRedis.current; } }));
vi.mock("bull", async importOriginal => {
  const actual = await importOriginal<{ default: typeof Bull }>();
  // Initialization tests replace this constructor; the private-socket suite uses real Bull.
  return { ...actual, default: vi.fn(function (name: string, options: Bull.QueueOptions) {
    return new actual.default(name, options);
  }) };
});
vi.mock("../services/generation-quota", () => ({ assertGenerationAdmission: vi.fn(), generationAccessFailure: () => undefined,
  generationOperationId: (id: string) => id, runGeneration: vi.fn(async (_scope, _id, _kind, _input, _signal, work) => work()) }));
vi.mock("../services/editorial-request", () => ({ executeEditorialRequest: vi.fn() }));
vi.mock("../services/tenancy", () => ({ resolveTenantContext: vi.fn() }));
import { EditorialJobs, editorialInputHash, editorialQueueName, initializeEditorialJobs, getEditorialJobs, closeEditorialJobs, EDITORIAL_VERSION, EDITORIAL_INPUT_TTL, EDITORIAL_RESULT_TTL, EDITORIAL_DEADLINE_MS } from "./editorial";
import { buildEvidenceBrief } from "../services/editorialEvidence";
import { CrawlError } from "../services/crawlerFetch";
import { executeEditorialRequest, type PreparedEditorialRequest } from "../services/editorial-request";
import { assertGenerationAdmission, runGeneration } from "../services/generation-quota";
import * as ai from "../services/openRouter";

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

describe("editorial queue naming", () => {
  const identity = {
    provider: "gemini", fallback: "openrouter",
    models: { anthropic: "claude-test", gemini: "gemini-test", openrouter: "router-test", openai: "openai-test" },
  };
  const changes = [
    { field: "provider", model: { ...identity, provider: "openrouter" } },
    { field: "fallback provider", model: { ...identity, fallback: "anthropic" } },
    { field: "disabled fallback", model: { ...identity, fallback: null } },
    ...["anthropic", "gemini", "openrouter", "openai"].map(provider => ({
      field: `${provider} model`, model: { ...identity, models: { ...identity.models, [provider]: "changed-model" } },
    })),
  ];

  it.each(["development", "production"])("shares a %s queue for stable identities regardless of object key order", environment => {
    const name = editorialQueueName(environment, identity);
    const reordered = {
      models: { openai: identity.models.openai, openrouter: identity.models.openrouter,
        gemini: identity.models.gemini, anthropic: identity.models.anthropic },
      fallback: identity.fallback, provider: identity.provider,
    };
    expect(editorialQueueName(environment, identity)).toBe(name);
    expect(editorialQueueName(environment, reordered)).toBe(name);
    expect(name).toMatch(new RegExp(`^editorial_generation-${environment}-[a-f0-9]{12}$`));
  });

  it.each(["development", "production"])("hashes the canonical model identity together with the editorial version in %s", environment => {
    // Keys are explicitly in canonical order, independently of the production serializer.
    const canonical = JSON.stringify({
      model: { fallback: identity.fallback,
        models: { anthropic: identity.models.anthropic, gemini: identity.models.gemini,
          openai: identity.models.openai, openrouter: identity.models.openrouter },
        provider: identity.provider },
      version: EDITORIAL_VERSION,
    });
    const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
    expect(editorialQueueName(environment, identity)).toBe(`editorial_generation-${environment}-${digest}`);
  });

  it.each(changes)("partitions deployment queues when $field changes", ({ model }) => {
    expect(editorialQueueName("development", model)).not.toBe(editorialQueueName("development", identity));
    expect(editorialQueueName("production", model)).not.toBe(editorialQueueName("production", identity));
  });

  it.each(["test", "staging", "", undefined])("preserves the existing queue name in %s", environment => {
    for (const model of [identity, ...changes.map(change => change.model), undefined]) {
      expect(editorialQueueName(environment, model)).toBe("editorial_generation");
    }
  });
});

describe("editorial queue initialization", () => {
  const store = { eval: vi.fn(), hgetall: vi.fn(), get: vi.fn() };
  const queue = { add: vi.fn(), on: vi.fn(), process: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  const warning = vi.fn();
  const disabledWarning = "[editorial] Development queue disabled: invalid AI configuration";
  const settings = ["AI_PROVIDER", "AI_FALLBACK_PROVIDER"] as const;
  let identity: MockInstance<typeof ai.getEditorialModelIdentity>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REDIS_URL", "redis://editorial-initialization.invalid:6379");
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    initializationRedis.current = store as unknown as Redis;
    vi.mocked(Bull).mockImplementation(function () { return queue as unknown as Bull.Queue; });
    identity = vi.spyOn(ai, "getEditorialModelIdentity");
    vi.spyOn(console, "warn").mockImplementation(warning);
  });

  afterEach(async () => {
    try {
      await closeEditorialJobs();
      expect(store.eval).not.toHaveBeenCalled();
      expect(store.hgetall).not.toHaveBeenCalled();
      expect(store.get).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(assertGenerationAdmission).not.toHaveBeenCalled();
      expect(runGeneration).not.toHaveBeenCalled();
      expect(executeEditorialRequest).not.toHaveBeenCalled();
    } finally {
      initializationRedis.current = undefined;
      vi.mocked(Bull).mockReset();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  function expectUninitialized() {
    expect(getEditorialJobs()).toBeUndefined();
    expect(Bull).not.toHaveBeenCalled();
    expect(queue.process).not.toHaveBeenCalled();
  }

  it.each(settings)("disables development initialization for unsupported %s without a fallback queue", setting => {
    vi.stubEnv(setting, "PRIVATE_INVALID_PROVIDER_SETTING");
    expect(initializeEditorialJobs()).toBeUndefined();
    expectUninitialized();
    expect(identity).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls).toEqual([[disabledWarning]]);
    // The startup guard must not make request identity checks permissive.
    expect(() => editorialInputHash(scope, prepared)).toThrow(ai.AIGenerationError);
  });

  it("logs only a fixed warning, never configuration error details or stacks", () => {
    const error = Object.assign(new ai.AIGenerationError("ai_configuration"), {
      message: "PRIVATE_CONFIGURATION_DETAIL", stack: "PRIVATE_CONFIGURATION_STACK",
    });
    identity.mockImplementationOnce(() => { throw error; });
    expect(initializeEditorialJobs()).toBeUndefined();
    expectUninitialized();
    expect(warning.mock.calls).toEqual([[disabledWarning]]);
  });

  it.each([
    { kind: "programmer error", error: new TypeError("Unexpected identity failure") },
    { kind: "configuration-code lookalike", error: Object.assign(new Error("Unexpected failure"), { code: "ai_configuration" }) },
    { kind: "non-configuration AI error", error: new ai.AIGenerationError("ai_unavailable") },
  ])("rethrows a $kind instead of disabling the queue", ({ error }) => {
    identity.mockImplementationOnce(() => { throw error; });
    expect(initializeEditorialJobs).toThrow(error);
    expectUninitialized();
    expect(warning).not.toHaveBeenCalled();
  });

  it.each(settings)("initializes the correct partition on an explicit retry after correcting %s", setting => {
    vi.stubEnv(setting, "unsupported-provider");
    expect(initializeEditorialJobs()).toBeUndefined();
    expectUninitialized();
    vi.stubEnv(setting, setting === "AI_PROVIDER" ? "gemini" : "openrouter");
    const name = editorialQueueName("development", ai.getEditorialModelIdentity());
    identity.mockClear();

    const initialized = initializeEditorialJobs();
    expect(initialized).toBeInstanceOf(EditorialJobs);
    expect(getEditorialJobs()).toBe(initialized);
    expect(initializeEditorialJobs()).toBe(initialized);
    expect(identity).toHaveBeenCalledTimes(1);
    expect(Bull).toHaveBeenCalledTimes(1);
    expect(Bull).toHaveBeenCalledWith(name, expect.objectContaining({
      settings: { maxStalledCount: 0 },
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    }));
    expect(name).toMatch(/^editorial_generation-development-[a-f0-9]{12}$/);
    expect(queue.process).toHaveBeenCalledExactlyOnceWith(2, expect.any(Function));
    expect(warning.mock.calls).toEqual([[disabledWarning]]);
  });

  it.each(settings)("fails closed in production with invalid %s before joining any queue", setting => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(setting, "unsupported-provider");
    expect(initializeEditorialJobs).toThrow(ai.AIGenerationError);
    expect(identity).toHaveBeenCalledTimes(1);
    expectUninitialized();
    expect(warning).not.toHaveBeenCalled();
  });

  it("starts production on its exact model/version partition, never the legacy queue", () => {
    vi.stubEnv("NODE_ENV", "production");
    const name = editorialQueueName("production", ai.getEditorialModelIdentity());
    identity.mockClear();
    expect(initializeEditorialJobs()).toBeInstanceOf(EditorialJobs);
    expect(identity).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
    expect(Bull).toHaveBeenCalledExactlyOnceWith(name, expect.any(Object));
    expect(name).toMatch(/^editorial_generation-production-[a-f0-9]{12}$/);
    expect(queue.process).toHaveBeenCalledExactlyOnceWith(2, expect.any(Function));
  });

  it("does not swallow configuration errors originating outside the development identity lookup", () => {
    const error = new ai.AIGenerationError("ai_configuration");
    vi.mocked(Bull).mockImplementationOnce(function () { throw error; });
    expect(initializeEditorialJobs).toThrow(error);
    expect(getEditorialJobs()).toBeUndefined();
    expect(queue.process).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });
});

// Optional integration coverage: a private, disposable Unix-socket Redis process.
// No configured host/URL, network port, existing DB, or live provider is used.
describe.skipIf(!disposableRedisAvailable)("editorial Redis state machine and Bull worker", () => {
  let fixture: Awaited<ReturnType<typeof startDisposableRedis>>;
  let socket: string;
  let store: Redis;
  let jobs: EditorialJobs;
  const add = vi.fn();
  const execute = vi.fn<typeof executeEditorialRequest>();
  const allowed = vi.fn(async () => true);

  beforeAll(async () => {
    // Initialization cases reset the constructor double; integration uses Bull.
    const actual = await vi.importActual<{ default: typeof Bull }>("bull");
    vi.mocked(Bull).mockImplementation(function (name, options) { return new actual.default(name, options); });
    fixture = await startDisposableRedis();
    socket = fixture.socket;
    store = fixture.client();
    await store.connect();
  }, 10_000);
  afterAll(async () => {
    await fixture?.stop();
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

  it("surfaces the specific crawl failure reason instead of a generic message", async () => {
    execute.mockRejectedValueOnce(new CrawlError("size", "The source response exceeds the crawl size limit."));
    const id = await jobs.enqueue(scope, prepared);
    await jobs.process(id);
    const status = await jobs.status(scope, id);
    expect(status).toMatchObject({ status: "failed", error: { status: 422, body: { code: "source_unreadable" } } });
    expect((status as any).error.body.message).toContain("exceeds the crawl size limit");
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

  it("isolates an overlapping legacy worker while sharing scoped job status and results", async () => {
    const clients: Redis[] = [];
    const options: Bull.QueueOptions = {
      createClient: type => {
        const client = new Redis({ path: socket, maxRetriesPerRequest: type === "client" ? 1 : null, enableReadyCheck: false });
        clients.push(client); return client as any;
      }, settings: { maxStalledCount: 0 },
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    };
    const legacy = new Bull<{ id: string }>("editorial_generation", options);
    const current = new Bull<{ id: string }>(editorialQueueName("production", ai.getEditorialModelIdentity()), options);
    const legacyWork = vi.fn(async (_data: { id: string }) => undefined);
    const currentJobs = new EditorialJobs(store, current, execute, allowed);
    const pollingInstance = new EditorialJobs(store, legacy, execute, allowed);
    try {
      legacy.process(job => legacyWork(job.data));
      current.process(job => currentJobs.process(job.data.id));
      await legacy.add({ id: "legacy-marker" });
      const id = await currentJobs.enqueue(scope, prepared);
      await vi.waitFor(async () => expect(await pollingInstance.status(scope, id)).toMatchObject({ status: "completed" }));
      await vi.waitFor(() => expect(legacyWork).toHaveBeenCalledExactlyOnceWith({ id: "legacy-marker" }));
      expect(await pollingInstance.result(scope, id)).toEqual(output);
      expect(await currentJobs.enqueue(scope, prepared)).toBe(id);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(await pollingInstance.status({ ...scope, userId: "other" }, id)).toBeNull();
    } finally {
      currentJobs.abortWorkers();
      await Promise.all([legacy.close(), current.close()]);
      clients.forEach(client => client.disconnect());
    }
  }, 10_000);

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