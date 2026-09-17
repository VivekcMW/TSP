import { createRedisClient } from "./redis-options";

export { redisOptions } from "./redis-options";

/**
 * Shared Redis client for cross-instance state (rate limiting today).
 * Undefined when REDIS_URL isn't configured — callers must fall back to a
 * per-process store in that case rather than throwing, so local/dev
 * environments without Redis keep working.
 */
export const redis = process.env.REDIS_URL
  ? createRedisClient(process.env.REDIS_URL)
  : undefined;

if (redis) {
  redis.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });
}
