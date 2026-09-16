import rateLimit, { ipKeyGenerator, type Store } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import type { Request } from "express";
import { redis } from "../lib/redis";

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
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => client.call(args[0], ...args.slice(1)) as Promise<any>,
  });
}

// Gemini-backed endpoints: generation is the most expensive/abusable path.
export const aiGenerationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  store: makeStore("ai-generation"),
  message: { message: "Too many AI requests. Please wait a few minutes and try again." },
});

// Instant Review fans out to 8 Gemini calls per request — tighter budget.
export const instantReviewRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  store: makeStore("instant-review"),
  message: { message: "Instant Review limit reached for this hour. Please try again later." },
});

// RSS fetch + AI scoring engine run — cheaper per-call but still I/O heavy.
export const inboxRefreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  store: makeStore("inbox-refresh"),
  message: { message: "Too many refresh requests. Please wait a few minutes and try again." },
});
