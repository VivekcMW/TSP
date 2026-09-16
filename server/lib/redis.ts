import Redis, { type RedisOptions } from "ioredis";

/** Blocking Bull connections must wait indefinitely; HTTP-facing commands must not. */
export function redisOptions(blocking = false): RedisOptions {
  return {
    keepAlive: 10_000,
    connectTimeout: 5_000,
    retryStrategy: (attempt) => Math.min(100 * 2 ** Math.min(attempt, 5), 3_000),
    reconnectOnError: (error) => error.message.includes("READONLY"),
    maxRetriesPerRequest: blocking ? null : 2,
    enableReadyCheck: !blocking,
    ...(blocking ? {} : { commandTimeout: 5_000 }),
  };
}

/**
 * Shared Redis client for cross-instance state (rate limiting today).
 * Undefined when REDIS_URL isn't configured — callers must fall back to a
 * per-process store in that case rather than throwing, so local/dev
 * environments without Redis keep working.
 */
export const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, redisOptions())
  : undefined;

if (redis) {
  redis.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });
}
