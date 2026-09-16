import { createHash } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import type Redis from "ioredis";

type RateLimitStorage = NonNullable<NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]>;

// Match Better Auth 1.7's rolling inactivity window: accepted requests refresh
// the TTL; rejected requests do not. Check + increment + expiry are atomic.
const CONSUME = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if count >= tonumber(ARGV[1]) then
  if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
    ttl = tonumber(ARGV[2])
  end
  return {0, math.max(1, math.ceil(ttl / 1000))}
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {1, 0}
`;

export function createAuthRateLimitStorage(client: Pick<Redis, "eval">): RateLimitStorage {
  return {
    async consume(key, rule) {
      try {
        // Isolated namespace; no session tokens or raw IPs in Redis key names.
        const redisKey = `tsp:auth:rate-limit:${createHash("sha256").update(key).digest("hex")}`;
        const result = await client.eval(CONSUME, 1, redisKey, rule.max, Math.ceil(rule.window * 1000));
        if (!Array.isArray(result) || result.length !== 2 ||
          (result[0] !== 0 && result[0] !== 1) || !Number.isFinite(result[1]) || result[1] < 0) {
          throw new Error("Invalid rate limit response");
        }
        return { allowed: result[0] === 1, retryAfter: result[0] === 1 ? null : Math.max(1, result[1]) };
      } catch {
        // No per-instance fallback during outages: it would bypass the shared
        // budget. Don't log the Redis error (it can contain connection secrets).
        console.error("[auth] Shared rate limiter unavailable; request denied");
        return { allowed: false, retryAfter: 5 };
      }
    },
  };
}