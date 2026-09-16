import Redis from "ioredis";

/**
 * Shared Redis client for cross-instance state (rate limiting today).
 * Undefined when REDIS_URL isn't configured — callers must fall back to a
 * per-process store in that case rather than throwing, so local/dev
 * environments without Redis keep working.
 */
export const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      // Don't crash the process over a transient Redis blip — rate limiting
      // degrading to "fail open" for a few seconds is far safer than the
      // whole API going down.
      lazyConnect: false,
    })
  : undefined;

if (redis) {
  redis.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });
}
