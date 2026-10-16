import fetch, { type BodyInit, type HeadersInit } from "node-fetch";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { resolvePublicHttpUrl } from "./urlValidator.js";

export class SafeOutboundError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

/** DNS cannot be cancelled; discard its result rather than dispatching late. */
export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Shared with the public crawler. Never fall back to an unvalidated address. */
export async function pinnedPublicAgent(url: URL, signal: AbortSignal): Promise<HttpAgent> {
  const target = await withAbort(resolvePublicHttpUrl(url.href), signal);
  if (!target.ok) throw new SafeOutboundError("blocked", target.reason);
  signal.throwIfAborted();
  const record = target.records[0];
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const lookup: LookupFunction = (requested, options, callback) => {
    if (requested.toLowerCase().replace(/\.$/, "") !== hostname) {
      callback(new Error("Outbound hostname changed"), "", 0);
    } else if (options.all) callback(null, [record]);
    else callback(null, record.address, record.family);
  };
  // URL hostname stays intact for Host/TLS SNI and normal certificate validation.
  return url.protocol === "https:" ? new HttpsAgent({ lookup, keepAlive: false }) : new HttpAgent({ lookup, keepAlive: false });
}

/** Syntax guard only: each actual request MUST additionally resolve and pin DNS. */
export function publicHttpsInstanceOrigin(raw: string): string {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new SafeOutboundError("url", "Enter a public HTTPS instance hostname."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || isIP(host.replace(/^\[|\]$/g, "")) ||
      host.length > 253 || !host.includes(".") || /\.(localhost|local|internal)$/.test(host) ||
      !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new SafeOutboundError("blocked", "Enter a public HTTPS instance hostname.");
  }
  return url.origin;
}

interface AuthenticatedJsonOptions {
  origin: string;
  method?: "GET" | "POST";
  headers?: HeadersInit;
  body?: BodyInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}

function bound(value: number | undefined, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value!), max)) : fallback;
}

/** Authenticated JSON/multipart transport. No redirects, retries, cookies, proxies,
 * or caller-supplied agents: credentials and POST bodies never leave this origin.
 * Buffers a bounded response before releasing the socket and deadline.
 */
export async function safeOutboundJson<T>(rawUrl: string, options: AuthenticatedJsonOptions): Promise<{ ok: boolean; status: number; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bound(options.timeoutMs, 15000, 30000));
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const maxBytes = bound(options.maxBytes, 1024 * 1024, 2 * 1024 * 1024);
  let agent: HttpAgent | undefined;
  let body: NodeJS.ReadableStream | null = null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.origin !== options.origin) {
      throw new SafeOutboundError("blocked", "Outbound origin is not allowed.");
    }
    signal.throwIfAborted();
    agent = await pinnedPublicAgent(url, signal);
    const response = await withAbort(fetch(url, {
      method: options.method ?? "GET", headers: options.headers, body: options.body,
      redirect: "manual", agent, signal, size: maxBytes, highWaterMark: 16 * 1024,
    }).then(response => {
      if (signal.aborted && response.body instanceof Readable) response.body.destroy();
      return response;
    }), signal);
    body = response.body;
    if (response.status >= 300 && response.status < 400) throw new SafeOutboundError("redirect", "Authenticated redirects are not allowed.");
    if (Number(response.headers.get("content-length")) > maxBytes) throw new SafeOutboundError("size", "Outbound response exceeds the size limit.");
    const text = await withAbort(response.text(), signal);
    signal.throwIfAborted();
    return { ok: response.ok, status: response.status, data: JSON.parse(text) as T };
  } catch (error) {
    if (signal.aborted) throw new SafeOutboundError("timeout", "Outbound request exceeded its time budget.");
    if (error instanceof SafeOutboundError) throw error;
    if ((error as { type?: string })?.type === "max-size") throw new SafeOutboundError("size", "Outbound response exceeds the size limit.");
    // Never expose raw provider/transport errors that might contain credentials.
    throw new SafeOutboundError("network", "Outbound request could not be completed.");
  } finally {
    clearTimeout(timer);
    if (body instanceof Readable) body.destroy();
    agent?.destroy();
  }
}