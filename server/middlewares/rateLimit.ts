import rateLimit, { ipKeyGenerator, type Options, type RateLimitRequestHandler, type Store } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { redis } from "../lib/redis";
import { RateLimitStoreUnavailableError, RecoverableRateLimitRedisStore } from "./rateLimitRedisStore";

// Keyed by authenticated user (falls back to IP pre-auth) so one abusive
// account can't be worked around by rotating IPs, and legitimate shared
// IPs (offices, VPNs) aren't punished for one user's traffic. IPv6 addresses
// must go through ipKeyGenerator so subnet-scoped addresses collapse to one key.
function keyByUser(req: Request): string {
  return (req as any).dbUser?.id || ipKeyGenerator(req.ip || "anonymous");
}

// Without REDIS_URL, each rateLimit() falls back to express-rate-limit's own
// in-memory MemoryStore — fine for single-process local dev, but on a
// multi-instance deploy (e.g. Vercel) each instance counts independently, so
// the real limit becomes (configured limit) x (instance count). A shared
// Redis store is what makes these budgets actually enforceable in production.
function makeStore(prefix: string): Store | undefined {
  const client = redis;
  if (!client) return undefined;
  return new RecoverableRateLimitRedisStore(
    `rl:${prefix}:`,
    (...args) => client.call(args[0], ...args.slice(1)),
  );
}

function recoverableRateLimit(options: Partial<Options>): RateLimitRequestHandler {
  const limiter = rateLimit({ ...options, passOnStoreError: false });
  const middleware: RequestHandler = (req, res, next) => limiter(req, res, (error) => {
    if (error instanceof RateLimitStoreUnavailableError) {
      res.setHeader("Retry-After", "5");
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ message: error.message });
      return;
    }
    next(error);
  });
  // Preserve the installed middleware's public get/reset methods.
  return Object.assign(middleware, { getKey: limiter.getKey, resetKey: limiter.resetKey });
}

// Gemini-backed endpoints: generation is the most expensive/abusable path.
export const aiGenerationRateLimit = recoverableRateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  store: makeStore("ai-generation"),
  message: { message: "Too many AI requests. Please wait a few minutes and try again." },
});

// Instant Review fans out to 8 Gemini calls per request — tighter budget.
export const instantReviewRateLimit = recoverableRateLimit({
  windowMs: 60 * 60 * 1000,
  // One post per request (one platform, one tone), so 30 still costs less than 10 four-tone requests.
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  store: makeStore("instant-review"),
  message: { message: "Instant Review limit reached for this hour. Please try again later." },
});

// RSS fetch + AI scoring engine run — cheaper per-call but still I/O heavy.
export const inboxRefreshRateLimit = recoverableRateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  store: makeStore("inbox-refresh"),
  message: { message: "Too many refresh requests. Please wait a few minutes and try again." },
});
