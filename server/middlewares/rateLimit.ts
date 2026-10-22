import rateLimit, { ipKeyGenerator, type Options, type RateLimitRequestHandler, type Store } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { redis } from "../lib/redis";
import { RateLimitStoreUnavailableError, RecoverableRateLimitRedisStore } from "./rateLimitRedisStore";
import { LINKEDIN_POST_TOOL_DAILY_LIMIT } from "@shared/linkedin-post-tool";
import { LINKEDIN_HOOK_TOOL_DAILY_LIMIT } from "@shared/linkedin-hook-tool";
import { LINKEDIN_HASHTAG_TOOL_DAILY_LIMIT } from "@shared/linkedin-hashtag-tool";

// Keyed by authenticated user (falls back to IP pre-auth) so one abusive
// account can't be worked around by rotating IPs, and legitimate shared
// IPs (offices, VPNs) aren't punished for one user's traffic. IPv6 addresses
// must go through ipKeyGenerator so subnet-scoped addresses collapse to one key.
function keyByUser(req: Request): string {
  return (req as any).dbUser?.id || ipKeyGenerator(req.ip || "anonymous");
}

// Without REDIS_URL, each rateLimit() falls back to express-rate-limit's own
// in-memory MemoryStore — fine for single-process local dev, but on a
// multi-instance deploy (e.g. several Cloud Run instances) each instance counts independently, so
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

// Request throttles supplement the atomic cross-instance invitation budgets.
export const invitationRequestRateLimit = recoverableRateLimit({
  windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: keyByUser, store: makeStore("friend-invitation-requests"),
  message: { message: "Too many invitation requests. Please try again later." },
});

export const invitationOptOutRateLimit = recoverableRateLimit({
  windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  store: makeStore("friend-invitation-optout"),
  message: { message: "Too many requests. Please try again later." },
});

// Public newsletter sign-ups: each can send a confirmation email, so keep it tight per address.
export const newsletterSignupRateLimit = recoverableRateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  store: makeStore("newsletter-signup"),
  message: { message: "Too many sign-ups from here. Please try again later." },
});

// The free public LinkedIn post tool: no account, so each visitor (IP) gets a daily allowance...
export const publicPostToolRateLimit = recoverableRateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: LINKEDIN_POST_TOOL_DAILY_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  // Bad input and unreadable links shouldn't use up a visitor's allowance.
  skipFailedRequests: true,
  store: makeStore("public-post-tool"),
  message: { code: "tool_daily_limit", message: `You've used today's ${LINKEDIN_POST_TOOL_DAILY_LIMIT} free posts. Create a free account to keep going, or come back tomorrow.` },
});

// ...and the whole site shares one daily ceiling, so rotating IPs can't run up an unbounded AI bill.
export const publicPostToolGlobalRateLimit = recoverableRateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: Number(process.env.PUBLIC_POST_TOOL_DAILY_CAP) || 500,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: () => "all",
  skipFailedRequests: true,
  store: makeStore("public-post-tool-global"),
  message: { code: "tool_busy", message: "The free tool is very busy today. Create a free account to keep writing posts, or try again tomorrow." },
});

// The other free AI tools follow the same pattern: a daily allowance per visitor, then one
// site-wide daily ceiling per tool.
function publicToolRateLimits(name: string, dailyLimit: number, usedUp: string) {
  const day = 24 * 60 * 60 * 1000;
  return {
    perVisitor: recoverableRateLimit({
      windowMs: day, limit: dailyLimit, standardHeaders: true, legacyHeaders: false,
      keyGenerator: keyByUser, skipFailedRequests: true, store: makeStore(`public-${name}-tool`),
      message: { code: "tool_daily_limit", message: `You've used today's ${dailyLimit} free ${usedUp}. Create a free account to keep going, or come back tomorrow.` },
    }),
    global: recoverableRateLimit({
      windowMs: day, limit: Number(process.env.PUBLIC_TOOL_DAILY_CAP) || 500, standardHeaders: false, legacyHeaders: false,
      keyGenerator: () => "all", skipFailedRequests: true, store: makeStore(`public-${name}-tool-global`),
      message: { code: "tool_busy", message: "The free tool is very busy today. Create a free account to keep going, or try again tomorrow." },
    }),
  };
}

export const publicHookToolRateLimits = publicToolRateLimits("hook", LINKEDIN_HOOK_TOOL_DAILY_LIMIT, "hook generations");
export const publicHashtagToolRateLimits = publicToolRateLimits("hashtag", LINKEDIN_HASHTAG_TOOL_DAILY_LIMIT, "hashtag generations");

// Gemini-backed endpoints: generation is the most expensive/abusable path.
// Onboarding suggestions are small and cached; separate from post generation.
export const onboardingSuggestionRateLimit = recoverableRateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  store: makeStore("onboarding-suggestions"),
  message: { message: "Too many suggestion requests. Please wait a few minutes and try again." },
});

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
