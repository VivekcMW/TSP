import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

// Keyed by authenticated user (falls back to IP pre-auth) so one abusive
// account can't be worked around by rotating IPs, and legitimate shared
// IPs (offices, VPNs) aren't punished for one user's traffic. IPv6 addresses
// must go through ipKeyGenerator so subnet-scoped addresses collapse to one key.
function keyByUser(req: Request): string {
  return (req as any).dbUser?.id || ipKeyGenerator(req.ip || "anonymous");
}

// Gemini-backed endpoints: generation is the most expensive/abusable path.
export const aiGenerationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  message: { message: "Too many AI requests. Please wait a few minutes and try again." },
});

// Instant Review fans out to 8 Gemini calls per request — tighter budget.
export const instantReviewRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  message: { message: "Instant Review limit reached for this hour. Please try again later." },
});

// RSS fetch + AI scoring engine run — cheaper per-call but still I/O heavy.
export const inboxRefreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  message: { message: "Too many refresh requests. Please wait a few minutes and try again." },
});
