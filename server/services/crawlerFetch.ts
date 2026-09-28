import fetch, { type Headers } from "node-fetch";
import type { Agent as HttpAgent } from "node:http";
import { Readable } from "node:stream";
import { pinnedPublicAgent, SafeOutboundError } from "./safeOutbound.js";
export { withAbort } from "./safeOutbound.js";

export class CrawlError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CrawlError";
  }
}

export function crawlErrorMessage(error: unknown): string {
  return error instanceof CrawlError ? error.message : "The source could not be read. It may be unavailable or block automated access.";
}

/** Bound queue memory as well as sockets; limits apply across all crawler callers. */
const MAX_ACTIVE = 8;
const MAX_PER_HOST = 2;
const MAX_QUEUED = 32;
let active = 0;
const hosts = new Map<string, number>();
interface Waiter { host: string; signal: AbortSignal; start: () => void; cancel: () => void }
const waiting: Waiter[] = [];

function drain(): void {
  for (let i = 0; i < waiting.length && active < MAX_ACTIVE;) {
    const waiter = waiting[i];
    if ((hosts.get(waiter.host) ?? 0) >= MAX_PER_HOST) { i++; continue; }
    waiting.splice(i, 1);
    waiter.signal.removeEventListener("abort", waiter.cancel);
    waiter.start();
  }
}

function acquire(host: string, signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted();
  if (waiting.length >= MAX_QUEUED) throw new CrawlError("busy", "Crawler is busy. Please try again shortly.");
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      host, signal,
      start: () => {
        active++;
        hosts.set(host, (hosts.get(host) ?? 0) + 1);
        resolve(() => {
          active--;
          const count = (hosts.get(host) ?? 1) - 1;
          if (count) hosts.set(host, count); else hosts.delete(host);
          drain();
        });
      },
      cancel: () => {
        const index = waiting.indexOf(waiter);
        if (index !== -1) waiting.splice(index, 1);
        reject(signal.reason);
      },
    };
    waiting.push(waiter);
    signal.addEventListener("abort", waiter.cancel, { once: true });
    drain();
  });
}

export interface CrawlPage { url: string; text: string; status: number; headers: Headers; bytes?: Buffer }
export interface CrawlBudget { requests: number; bytes: number }
/** `headers` adds conditional request headers (If-None-Match / If-Modified-Since); a 304 then returns with an empty body. */
export interface CrawlOptions { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; method?: "GET" | "HEAD" | "POST"; budget?: CrawlBudget; headers?: Record<string, string>; binary?: boolean; body?: string; contentType?: string }

function boundedSetting(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value!), maximum)) : fallback;
}

function parseCrawlUrl(rawUrl: string): URL {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url;
  } catch {
    throw new CrawlError("url", "Enter a valid public HTTP(S) URL.");
  }
}

async function fetchHop(url: URL, signal: AbortSignal, options: CrawlOptions, maxBytes: number): Promise<CrawlPage | { redirect: string }> {
  const release = await acquire(url.hostname.toLowerCase().replace(/\.$/, ""), signal);
  let agent: HttpAgent | undefined;
  let body: NodeJS.ReadableStream | null = null;
  try {
    const budget = options.budget;
    if (budget) {
      if (budget.requests <= 0 || budget.bytes <= 0) throw new CrawlError("budget", "The crawl reached its request or byte budget. Try a direct feed URL.");
      budget.requests--;
      maxBytes = Math.min(maxBytes, budget.bytes);
    }
    agent = await pinnedPublicAgent(url, signal);
    const response = await fetch(url, {
      method: options.method ?? "GET", redirect: "manual", agent, signal,
      size: maxBytes, highWaterMark: 16 * 1024,
      ...(options.body !== undefined ? { body: options.body } : {}),
      headers: { ...options.headers, ...(options.contentType ? { "Content-Type": options.contentType } : {}), "User-Agent": "TheSocialPundit/1.0 (Public Source Reader)", Accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/feed+json,application/json,text/xml" },
    });
    body = response.body;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      // A form post is never replayed at another address.
      if (options.method === "POST") throw new CrawlError("redirect", "The hub redirected the subscription request.");
      const location = response.headers.get("location");
      if (!location) throw new CrawlError("redirect", "The source returned an invalid redirect.");
      try { return { redirect: new URL(location, url).href }; }
      catch { throw new CrawlError("redirect", "The source returned an invalid redirect."); }
    }
    // Must run before the generic !response.ok check below: a bot-blocked
    // request is always a non-2xx status, so checking ok first made this
    // unreachable and every deliberate block surfaced as a generic HTTP error.
    // Only a conditional request may accept "not modified"; anything else with no body is an error.
    if (response.status === 304 && (options.headers?.["If-None-Match"] || options.headers?.["If-Modified-Since"])) {
      return { url: url.href, text: "", status: 304, headers: response.headers };
    }
    if (response.headers.get("x-amzn-waf-action") === "challenge" || response.headers.get("cf-mitigated") === "challenge"
      || response.headers.has("x-datadome") || (response.status === 403 && response.headers.get("server") === "cloudflare")) {
      throw new CrawlError("challenge", "This publisher actively blocks automated readers, not just this app.");
    }
    if (!response.ok) throw new CrawlError("http", `The source returned HTTP ${response.status}. It may be unavailable or restrict automated access.`);
    if (Number(response.headers.get("content-length")) > maxBytes) throw new CrawlError("size", "The source response exceeds the crawl size limit.");
    // node-fetch enforces `size` on the decompressed stream, including chunked responses.
    const bytes = options.binary && options.method !== "HEAD" ? await response.buffer() : undefined;
    const text = options.method === "HEAD" || bytes ? "" : await response.text();
    signal.throwIfAborted();
    if (budget) {
      budget.bytes -= Buffer.byteLength(text);
      if (budget.bytes < 0) throw new CrawlError("budget", "The crawl reached its byte budget. Try a direct feed URL.");
    }
    return { url: url.href, text, status: response.status, headers: response.headers, ...(bytes ? { bytes } : {}) };
  } finally {
    if (body instanceof Readable) body.destroy();
    agent?.destroy();
    release();
  }
}

// Binary downloads (a GDELT 15-minute file is 10–30 MB zipped) may exceed the page limit.
const BINARY_MAX_BYTES = 64 * 1024 * 1024;

/** Posts a small form to a public address (WebSub subscriptions), with the same address checks as pages. */
export async function postPublicForm(rawUrl: string, fields: Record<string, string>, options: Pick<CrawlOptions, "signal" | "timeoutMs"> = {}): Promise<CrawlPage> {
  return fetchPublicText(rawUrl, { ...options, method: "POST", body: new URLSearchParams(fields).toString(), contentType: "application/x-www-form-urlencoded", maxBytes: 64 * 1024 });
}

/** A public binary file, with the same address checks as pages; `maxBytes` may go up to 64 MB. */
export async function fetchPublicBytes(rawUrl: string, options: Omit<CrawlOptions, "binary" | "method"> = {}): Promise<Buffer> {
  const page = await fetchPublicText(rawUrl, { ...options, binary: true });
  return page.bytes ?? Buffer.alloc(0);
}

/** GET-only public crawler: no cookies, auth, proxy env, automatic redirects, or unpinned DNS. */
export async function fetchPublicText(rawUrl: string, options: CrawlOptions = {}): Promise<CrawlPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new CrawlError("timeout", "The source took too long to respond.")), boundedSetting(options.timeoutMs, 8000, options.binary ? 60_000 : 10000));
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  // 2MB rejected real-world long-form pages (e.g. Wikipedia articles routinely
  // run 2.1-2.5MB of raw HTML despite modest readable text) - see crawlerFetch.test.ts.
  const maxBytes = boundedSetting(options.maxBytes, 5 * 1024 * 1024, options.binary ? BINARY_MAX_BYTES : 5 * 1024 * 1024);
  const seen = new Set<string>();
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      signal.throwIfAborted();
      const url = parseCrawlUrl(current);
      if (seen.has(url.href)) throw new CrawlError("redirect", "The source has a redirect loop.");
      seen.add(url.href);
      const result = await fetchHop(url, signal, options, maxBytes);
      if (!("redirect" in result)) return result;
      current = result.redirect;
    }
    throw new CrawlError("redirect", "The source has too many redirects.");
  } catch (error) {
    if (signal.aborted) throw new CrawlError("timeout", "The crawl was cancelled or exceeded its time budget.");
    if (error instanceof SafeOutboundError) throw new CrawlError(error.code, error.message);
    if (error instanceof CrawlError) throw error;
    if ((error as { type?: string })?.type === "max-size") throw new CrawlError("size", "The source response exceeds the crawl size limit.");
    throw new CrawlError("network", "The source could not be reached. It may be offline or block automated access.");
  } finally {
    clearTimeout(timer);
  }
}

/** Fixed workers, ordered results, no unbounded Promise.all fan-out. */
export async function mapCrawlSettled<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(boundedSetting(concurrency, 2, 8), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await fn(items[index]) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}