import fetch, { type Headers } from "node-fetch";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { resolvePublicHttpUrl } from "./urlValidator.js";

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

/** DNS lookup cannot be cancelled by Node; abandon its result on cancellation. */
export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export interface CrawlPage { url: string; text: string; status: number; headers: Headers }
export interface CrawlBudget { requests: number; bytes: number }
export interface CrawlOptions { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; method?: "GET" | "HEAD"; budget?: CrawlBudget }

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

async function pinnedAgent(url: URL, signal: AbortSignal): Promise<HttpAgent> {
  const target = await withAbort(resolvePublicHttpUrl(url.href), signal);
  if (!target.ok) throw new CrawlError("blocked", target.reason);
  signal.throwIfAborted();
  // No second DNS resolution at connect time. Host header and TLS SNI retain the URL hostname.
  const record = target.records[0];
  const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) callback(null, [record]);
    else callback(null, record.address, record.family);
  };
  return url.protocol === "https:" ? new HttpsAgent({ lookup, keepAlive: false }) : new HttpAgent({ lookup, keepAlive: false });
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
    agent = await pinnedAgent(url, signal);
    const response = await fetch(url, {
      method: options.method ?? "GET", redirect: "manual", agent, signal,
      size: maxBytes, highWaterMark: 16 * 1024,
      headers: { "User-Agent": "TheSocialPundit/1.0 (Public Source Reader)", Accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/feed+json,application/json,text/xml" },
    });
    body = response.body;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new CrawlError("redirect", "The source returned an invalid redirect.");
      try { return { redirect: new URL(location, url).href }; }
      catch { throw new CrawlError("redirect", "The source returned an invalid redirect."); }
    }
    if (!response.ok) throw new CrawlError("http", `The source returned HTTP ${response.status}. It may be unavailable or restrict automated access.`);
    if (response.headers.get("x-amzn-waf-action") === "challenge" || response.headers.get("cf-mitigated") === "challenge") {
      throw new CrawlError("challenge", "This source requires a browser verification and cannot be crawled.");
    }
    if (Number(response.headers.get("content-length")) > maxBytes) throw new CrawlError("size", "The source response exceeds the crawl size limit.");
    // node-fetch enforces `size` on the decompressed stream, including chunked responses.
    const text = options.method === "HEAD" ? "" : await response.text();
    signal.throwIfAborted();
    if (budget) {
      budget.bytes -= Buffer.byteLength(text);
      if (budget.bytes < 0) throw new CrawlError("budget", "The crawl reached its byte budget. Try a direct feed URL.");
    }
    return { url: url.href, text, status: response.status, headers: response.headers };
  } finally {
    if (body instanceof Readable) body.destroy();
    agent?.destroy();
    release();
  }
}

/** GET-only public crawler: no cookies, auth, proxy env, automatic redirects, or unpinned DNS. */
export async function fetchPublicText(rawUrl: string, options: CrawlOptions = {}): Promise<CrawlPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new CrawlError("timeout", "The source took too long to respond.")), boundedSetting(options.timeoutMs, 8000, 10000));
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const maxBytes = boundedSetting(options.maxBytes, 2 * 1024 * 1024, 2 * 1024 * 1024);
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