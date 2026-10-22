import type { RequestHandler } from "express";
import { publicSeoForPath } from "../public-seo";

export const CANONICAL_ORIGIN = "https://www.thesocialpundit.com";
const APEX_HOST = "thesocialpundit.com";
// Cloud Run's own *.run.app address serves the same site; release candidates and smoke tests use it.
const CLOUD_RUN_HOST_SUFFIX = ".run.app";
// Probes and uptime checks must keep seeing the real status, not a redirect.
const PROBE_PATHS = new Set(["/healthz", "/readyz"]);
// API calls and OAuth callbacks must reach their exact registered path.
const UNTOUCHED_PREFIXES = ["/api/", "/auth/"];

function isPageRequest(method: string, path: string) {
  if (method !== "GET" && method !== "HEAD") return false;
  if (PROBE_PATHS.has(path) || UNTOUCHED_PREFIXES.some(prefix => path.startsWith(prefix))) return false;
  // Files (/robots.txt, /assets/app.js) are served as-is.
  return !/\.[^/]*$/.test(path);
}

/**
 * The one URL each page should be reached at: duplicate slashes collapsed, no trailing slash
 * (except the homepage), and lowercase when the lowercase form is a known public page. Returns
 * undefined when the path is already canonical. Lowercasing is limited to known pages so
 * case-sensitive tokens in other paths are never altered.
 */
export function canonicalPathFor(path: string): string | undefined {
  let target = path.replace(/\/{2,}/g, "/");
  if (target.length > 1) target = target.replace(/\/+$/, "") || "/";
  const lower = target.toLowerCase();
  if (lower !== target && publicSeoForPath(lower)) target = lower;
  return target === path ? undefined : target;
}

function queryOf(originalUrl: string) {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

/**
 * Both thesocialpundit.com and www.thesocialpundit.com reach the same load balancer. Serving
 * pages on both splits ranking signals between duplicate URLs, so page requests on the bare
 * domain are moved permanently to www, with the path cleaned up in the same hop. API calls,
 * webhooks and other non-GET requests are left alone: callers on the bare domain must not have
 * requests turned into redirects they may not follow. Other hosts are untouched here.
 */
export const canonicalHostRedirect: RequestHandler = (req, res, next) => {
  if (req.hostname?.toLowerCase() !== APEX_HOST) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/") || PROBE_PATHS.has(req.path)) return next();
  const path = (isPageRequest(req.method, req.path) && canonicalPathFor(req.path)) || undefined;
  // The target is always rooted at the canonical origin, so it can never leave it.
  const target = path ? `${path}${queryOf(req.originalUrl)}` : req.originalUrl;
  res.redirect(301, `${CANONICAL_ORIGIN}${target}`);
};

/**
 * Trailing-slash, double-slash and wrong-case variants of a page would otherwise return 200
 * and compete with the real URL, so they are moved permanently to the canonical path. The
 * redirect is path-only (same host) and the query string is kept.
 */
export const canonicalPathRedirect: RequestHandler = (req, res, next) => {
  if (!isPageRequest(req.method, req.path)) return next();
  const path = canonicalPathFor(req.path);
  if (!path) return next();
  res.redirect(301, `${path}${queryOf(req.originalUrl)}`);
};

/**
 * Cloud Run's *.run.app address must stay reachable for release candidates and smoke tests, so
 * it is not redirected. It is kept out of search results instead.
 */
export const cloudRunHostNoindex: RequestHandler = (req, res, next) => {
  if (req.hostname?.toLowerCase().endsWith(CLOUD_RUN_HOST_SUFFIX)) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
  }
  next();
};
