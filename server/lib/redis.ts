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

let lastErrorTime = 0;
let errorCount = 0;
const ERROR_LOG_INTERVAL_MS = 30_000; // Log errors max once per 30s

if (redis) {
  redis.on("error", (err) => {
    const now = Date.now();
    errorCount++;
    // Only log detailed errors periodically to avoid spam; production systems
    // auto-reconnect and should be resilient to transient connection resets.
    if (now - lastErrorTime >= ERROR_LOG_INTERVAL_MS) {
      console.warn(`[redis] connection error: ${err.message} (${errorCount} errors since last log)`);
      lastErrorTime = now;
      errorCount = 0;
    }
  });

  redis.on("reconnecting", () => {
    console.log("[redis] reconnecting...");
  });

  redis.on("ready", () => {
    console.log("[redis] connection ready");
  });
}
