import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";

// Fixed-window semantics and key format match rate-limit-redis v6. EVAL
// avoids cached rejected SCRIPT LOAD promises and survives SCRIPT FLUSH or
// failover without a process restart. Each operation is one atomic command.
const INCREMENT = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('SET', KEYS[1], 1, 'PX', ARGV[1])
  return {1, tonumber(ARGV[1])}
end
return {redis.call('INCR', KEYS[1]), ttl}
`;

const GET = `
return {redis.call('GET', KEYS[1]), redis.call('PTTL', KEYS[1])}
`;

// Refund a counted request without extending its window. Unlike bare DECR,
// a late/duplicate refund must not create an immortal negative counter.
const DECREMENT = `
local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
if hits > 0 and redis.call('PTTL', KEYS[1]) >= 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

export class RateLimitStoreUnavailableError extends Error {
  constructor() {
    // Never retain the driver error/cause: it can include connection details.
    super("Rate limiting is temporarily unavailable. Please try again shortly.");
    this.name = "RateLimitStoreUnavailableError";
  }
}

type SendCommand = (...args: string[]) => Promise<unknown>;

function parseReply(reply: unknown, increment: boolean): ClientRateLimitInfo | undefined {
  if (!Array.isArray(reply) || reply.length !== 2) throw new RateLimitStoreUnavailableError();
  const [hits, ttl] = reply;
  if (!increment && (hits === null || hits === false) && ttl === -2) return undefined;
  const totalHits = typeof hits === "string" && /^\d+$/.test(hits) ? Number(hits) : hits;
  if (typeof totalHits !== "number" || !Number.isSafeInteger(totalHits) || totalHits < (increment ? 1 : 0) ||
      typeof ttl !== "number" || !Number.isSafeInteger(ttl) || ttl < 0) {
    throw new RateLimitStoreUnavailableError();
  }
  const resetTime = new Date(Date.now() + ttl);
  if (!Number.isFinite(resetTime.getTime())) {
    throw new RateLimitStoreUnavailableError();
  }
  return { totalHits, resetTime };
}

export class RecoverableRateLimitRedisStore implements Store {
  readonly localKeys = false;
  private windowMs = 0;

  constructor(readonly prefix: string, private readonly sendCommand: SendCommand) {}

  init(options: Pick<Options, "windowMs">): void {
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
      throw new TypeError("Invalid rate-limit window");
    }
    // No asynchronous initialization or cached connection state.
    this.windowMs = options.windowMs;
  }

  private async command(...args: string[]): Promise<unknown> {
    try {
      // No store-level retry: a lost response might already have counted.
      // Connection timeouts/reconnection are owned by the shared Redis client.
      return await this.sendCommand(...args);
    } catch {
      throw new RateLimitStoreUnavailableError();
    }
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    if (!this.windowMs) throw new RateLimitStoreUnavailableError();
    const reply = await this.command("EVAL", INCREMENT, "1", this.prefix + key, String(this.windowMs));
    const result = parseReply(reply, true);
    if (!result) throw new RateLimitStoreUnavailableError();
    return result;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    return parseReply(await this.command("EVAL", GET, "1", this.prefix + key), false);
  }

  async decrement(key: string): Promise<void> {
    await this.command("EVAL", DECREMENT, "1", this.prefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await this.command("DEL", this.prefix + key);
  }
  // No resetAll/shutdown: the namespace and connection are shared across
  // processes; this store owns neither a connection nor a timer.
}