import type { RequestHandler } from "express";

export const CANONICAL_ORIGIN = "https://www.thesocialpundit.com";
const APEX_HOST = "thesocialpundit.com";
// Probes and uptime checks must keep seeing the real status, not a redirect.
const PROBE_PATHS = new Set(["/healthz", "/readyz"]);

/**
 * Both thesocialpundit.com and www.thesocialpundit.com reach the same load balancer. Serving
 * pages on both splits ranking signals between duplicate URLs, so page requests on the bare
 * domain are moved permanently to www. API calls, webhooks and other non-GET requests are left
 * alone: callers on the bare domain must not have requests turned into redirects they may not
 * follow. Other hosts (Cloud Run candidate URLs, localhost) are untouched.
 */
export const canonicalHostRedirect: RequestHandler = (req, res, next) => {
  if (req.hostname?.toLowerCase() !== APEX_HOST) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/") || PROBE_PATHS.has(req.path)) return next();
  // originalUrl always starts with "/", so the target can never leave the canonical origin.
  res.redirect(301, `${CANONICAL_ORIGIN}${req.originalUrl}`);
};
