import Bull from "bull";
import type Redis from "ioredis";
import { createHash, randomUUID } from "node:crypto";
import { redis } from "../lib/redis";
import { queueOptions } from "./queue";
import type { TenantScope } from "../storage";
import { executeEditorialRequest, type PreparedEditorialRequest } from "../services/editorial-request";
import { AIGenerationError, getAIErrorResponse, getEditorialModelIdentity } from "../services/openRouter";
import { CrawlError } from "../services/crawlerFetch";
import { resolveTenantContext } from "../services/tenancy";
import { can } from "../services/permissions";

// Bump whenever prompts, evidence selection, or response semantics change.
export const EDITORIAL_VERSION = "grounded-editorial-v1";
export const EDITORIAL_INPUT_TTL = 600;
export const EDITORIAL_RESULT_TTL = 300;
export const EDITORIAL_DEADLINE_MS = 300_000;
const prefix = "editorial:v1:";
const recordKey = (id: string) => `${prefix}job:${id}`;
const cancelKey = (id: string) => `${prefix}cancel:${id}`;
const validId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

export interface EditorialProgress { platformsCompleted: number; platformsTotal: number }
export interface EditorialJobStatus {
  jobId: string;
  status: "queued" | "active" | "completed" | "failed" | "cancelled";
  progress: EditorialProgress;
  error?: ReturnType<typeof getAIErrorResponse>;
}
export class EditorialQueueUnavailableError extends Error {
  constructor() { super("Editorial queue unavailable. Please try again later."); }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return "{" + entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

export function editorialInputHash(scope: TenantScope, prepared: PreparedEditorialRequest, identity: unknown = getEditorialModelIdentity()) {
  // input.requestIntent separates deliberate regeneration from retries of one intent.
  return createHash("sha256").update(stable({ scope: { tenantId: scope.tenantId, userId: scope.userId },
    prepared: { ...prepared, input: { ...prepared.input, selectedPlatforms: [...prepared.input.selectedPlatforms].sort((a, b) => a.localeCompare(b)) } },
    identity, version: EDITORIAL_VERSION })).digest("hex");
}

// All state transitions are atomic. Results cannot overwrite a concurrent cancel,
// and a replayed/stalled worker cannot claim a job that already started spending.
export const editorialScripts = {
  create: `-- editorial:create
local existing = redis.call('GET', KEYS[2])
if existing then return existing end
redis.call('HSET', KEYS[1], 'tenantId', ARGV[2], 'userId', ARGV[3], 'input', ARGV[4], 'progress', ARGV[5], 'createdAt', ARGV[6], 'status', 'queued', 'dedupe', KEYS[2], 'identity', ARGV[8])
redis.call('EXPIRE', KEYS[1], ARGV[7])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[7])
return ARGV[1]`,
  claim: `-- editorial:claim
if redis.call('HGET', KEYS[1], 'status') ~= 'queued' or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'status', 'active')
redis.call('HDEL', KEYS[1], 'input')
return 1`,
  progress: `-- editorial:progress
if redis.call('HGET', KEYS[1], 'status') ~= 'active' then return 0 end
local previous = cjson.decode(redis.call('HGET', KEYS[1], 'progress'))
local progress = cjson.decode(ARGV[1])
if progress.platformsCompleted > previous.platformsCompleted then redis.call('HSET', KEYS[1], 'progress', ARGV[1]) end
return 1`,
  finish: `-- editorial:finish
local state = redis.call('HGET', KEYS[1], 'status')
if not state or (state ~= 'queued' and state ~= 'active') then return 0 end
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'status', ARGV[2], ARGV[3], ARGV[4])
redis.call('HDEL', KEYS[1], 'input')
redis.call('EXPIRE', KEYS[1], ARGV[5])
local dedupe = redis.call('HGET', KEYS[1], 'dedupe')
if redis.call('GET', dedupe) == ARGV[1] then
  redis.call('EXPIRE', dedupe, math.max(tonumber(ARGV[5]), redis.call('TTL', dedupe)))
end
return 1`,
  cancel: `-- editorial:cancel
if redis.call('HGET', KEYS[1], 'tenantId') ~= ARGV[2] or redis.call('HGET', KEYS[1], 'userId') ~= ARGV[3] then return 0 end
local state = redis.call('HGET', KEYS[1], 'status')
if state ~= 'queued' and state ~= 'active' then return 1 end
redis.call('SET', KEYS[2], '1', 'EX', ARGV[4])
redis.call('HSET', KEYS[1], 'status', 'cancelled')
redis.call('HDEL', KEYS[1], 'input', 'result')
redis.call('EXPIRE', KEYS[1], ARGV[4])
local dedupe = redis.call('HGET', KEYS[1], 'dedupe')
if redis.call('GET', dedupe) == ARGV[1] then redis.call('EXPIRE', dedupe, math.max(tonumber(ARGV[4]), redis.call('TTL', dedupe))) end
return 1`,
};

type Store = Pick<Redis, "eval" | "hgetall" | "get">;
type WorkQueue = Pick<Bull.Queue<{ id: string }>, "add">;
const authorize = async (scope: TenantScope) => {
  const actor = await resolveTenantContext(scope.userId, scope.tenantId);
  return Boolean(actor && can(actor, "generation:create:own"));
};

export class EditorialJobs {
  private readonly controllers = new Set<AbortController>();
  constructor(private readonly store: Store, private readonly queue: WorkQueue,
    private readonly execute = executeEditorialRequest, private readonly allowed = authorize) {}

  async enqueue(scope: TenantScope, prepared: PreparedEditorialRequest): Promise<string> {
    const input = JSON.stringify(prepared);
    if (Buffer.byteLength(input) > 100_000) throw new AIGenerationError("ai_invalid_input");
    const id = randomUUID();
    const identity = stable({ model: getEditorialModelIdentity(), version: EDITORIAL_VERSION });
    const dedupe = `${prefix}dedupe:${editorialInputHash(scope, prepared)}`;
    try {
      const jobId = await this.store.eval(editorialScripts.create, 2, recordKey(id), dedupe, id,
        scope.tenantId, scope.userId, input, JSON.stringify({ platformsCompleted: 0, platformsTotal: prepared.input.selectedPlatforms.length }),
        Date.now(), EDITORIAL_INPUT_TTL, identity);
      if (typeof jobId !== "string" || !validId(jobId)) throw new EditorialQueueUnavailableError();
      const record = await this.owned(scope, jobId);
      if (!record) throw new EditorialQueueUnavailableError();
      if (record.status === "queued") {
        // Re-adding the same ID safely recovers an uncertain enqueue response.
        // Keep the reservation on errors: never start an alternative paid request.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([this.queue.add({ id: jobId }, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new EditorialQueueUnavailableError()), 8_000); })]);
        } finally { clearTimeout(timer); }
      }
      return jobId;
    } catch { throw new EditorialQueueUnavailableError(); }
  }

  private async owned(scope: TenantScope, id: string) {
    if (!validId(id)) return null;
    const record = await this.store.hgetall(recordKey(id));
    return record.tenantId === scope.tenantId && record.userId === scope.userId ? record : null;
  }

  async status(scope: TenantScope, id: string): Promise<EditorialJobStatus | null> {
    let record = await this.owned(scope, id);
    if (!record) return null;
    if (["queued", "active"].includes(record.status) && Date.now() - Number(record.createdAt) >= EDITORIAL_DEADLINE_MS) {
      await this.fail(id, new AIGenerationError("ai_timeout"));
      record = await this.owned(scope, id);
      if (!record) return null;
    }
    return { jobId: id, status: record.status as EditorialJobStatus["status"], progress: JSON.parse(record.progress),
      ...(record.error ? { error: JSON.parse(record.error) } : {}) };
  }

  async result(scope: TenantScope, id: string) {
    const record = await this.owned(scope, id);
    return record?.status === "completed" && record.result ? JSON.parse(record.result) : null;
  }

  async cancel(scope: TenantScope, id: string) {
    if (!validId(id)) return false;
    return Boolean(await this.store.eval(editorialScripts.cancel, 2, recordKey(id), cancelKey(id),
      id, scope.tenantId, scope.userId, EDITORIAL_RESULT_TTL));
  }

  private async fail(id: string, error: unknown) {
    const failure = error instanceof CrawlError
      ? { status: 422, body: { code: "source_unreadable", message: `${error.message} Try another public URL or use Write article.` } }
      : getAIErrorResponse(error);
    await this.store.eval(editorialScripts.finish, 2, recordKey(id), cancelKey(id), id, "failed", "error", JSON.stringify(failure), EDITORIAL_RESULT_TTL);
  }

  async process(id: string): Promise<void> {
    if (!validId(id)) return;
    const record = await this.store.hgetall(recordKey(id));
    if (!record.input) return;
    if (!await this.store.eval(editorialScripts.claim, 2, recordKey(id), cancelKey(id))) return;
    const controller = new AbortController();
    this.controllers.add(controller);
    const remaining = Number(record.createdAt) + EDITORIAL_DEADLINE_MS - Date.now();
    const timer = setTimeout(() => controller.abort(new AIGenerationError("ai_timeout")), Math.max(0, remaining));
    let checking = false;
    const check = async () => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      try {
        if (await this.store.get(cancelKey(id))) controller.abort(new AIGenerationError("ai_cancelled"));
        const current = await this.store.hgetall(recordKey(id));
        if (current.status !== "active") controller.abort(new AIGenerationError("ai_cancelled"));
      } catch { controller.abort(new AIGenerationError("ai_unavailable")); }
      finally { checking = false; }
    };
    const poller = setInterval(() => { void check(); }, 250);
    try {
      if (remaining <= 0) throw new AIGenerationError("ai_timeout");
      if (record.identity !== stable({ model: getEditorialModelIdentity(), version: EDITORIAL_VERSION })) throw new AIGenerationError("ai_configuration");
      if (!await this.allowed({ tenantId: record.tenantId, userId: record.userId })) throw new AIGenerationError("ai_cancelled");
      await check();
      controller.signal.throwIfAborted();
      const prepared = JSON.parse(record.input) as PreparedEditorialRequest;
      const completed = new Set<string>();
      const result = await this.execute(prepared, controller.signal, async platform => {
        controller.signal.throwIfAborted();
        completed.add(platform);
        await this.store.eval(editorialScripts.progress, 1, recordKey(id), JSON.stringify({
          platformsCompleted: completed.size, platformsTotal: prepared.input.selectedPlatforms.length,
        }));
      }, Math.min(remaining, 240_000));
      controller.signal.throwIfAborted();
      const serialized = JSON.stringify(result);
      if (Buffer.byteLength(serialized) > 512_000) throw new AIGenerationError("ai_invalid_output");
      await this.store.eval(editorialScripts.finish, 2, recordKey(id), cancelKey(id), id, "completed", "result", serialized, EDITORIAL_RESULT_TTL);
    } catch (error) {
      controller.abort();
      await this.fail(id, error);
    } finally {
      clearTimeout(timer); clearInterval(poller);
      controller.abort(); this.controllers.delete(controller);
    }
  }

  abortWorkers() { for (const controller of this.controllers) controller.abort(new AIGenerationError("ai_cancelled")); }
}

let queue: Bull.Queue<{ id: string }> | undefined;
let jobs: EditorialJobs | undefined;
const clients = new Set<Redis>();
export function getEditorialJobs() { return jobs; }
export function initializeEditorialJobs() {
  if (jobs || !redis || !process.env.REDIS_URL) return jobs;
  const options = queueOptions(process.env.REDIS_URL);
  queue = new Bull("editorial_generation", { ...options,
    createClient: (type, config) => {
      const client = options.createClient!(type, config);
      clients.add(client as unknown as Redis);
      return client;
    },
    settings: { maxStalledCount: 0 },
    defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
  });
  jobs = new EditorialJobs(redis, queue);
  const worker = jobs;
  queue.on("error", () => console.error("[editorial] Queue connection failure"));
  queue.on("failed", () => console.error("[editorial] Worker failed; automatic retry disabled"));
  queue.process(2, async job => {
    try { await worker.process(job.data.id); }
    catch { throw new EditorialQueueUnavailableError(); }
  });
  return jobs;
}

export async function closeEditorialJobs() {
  jobs?.abortWorkers();
  try { await queue?.close(); }
  finally {
    for (const client of clients) client.disconnect();
    clients.clear(); queue = undefined; jobs = undefined;
  }
}