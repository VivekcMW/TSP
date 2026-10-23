import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Publication } from "@shared/schema";
import { postPublicForm } from "./crawlerFetch.js";
import { recordWebSubRequest, websubDuePublications } from "./articlePool";

/**
 * WebSub (PubSubHubbub): a feed that names a hub can push new entries to us the moment they
 * are published, instead of waiting for the next poll. We subscribe with a per-publication
 * secret and a lease; the hub verifies at GET /api/websub/:id and delivers at POST, signed.
 */

export const WEBSUB_LEASE_SECONDS = 10 * 86_400;
const SIGNATURE_METHODS: Record<string, string> = { sha1: "sha1", sha256: "sha256", sha384: "sha384", sha512: "sha512" };

/** The hub a feed names in a `<link rel="hub">` (Atom or RSS), if any. */
export function hubLink(feedText: string): string | null {
  for (const tag of feedText.match(/<(?:atom:)?link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (rel?.trim().toLowerCase() === "hub" && href) {
      try { const url = new URL(href.trim()); if (["http:", "https:"].includes(url.protocol)) return url.href; } catch { /* not a link */ }
    }
  }
  return null;
}

export const callbackUrl = (appUrl: string, publicationId: string) => `${appUrl.replace(/\/$/, "")}/api/websub/${publicationId}`;

type Post = (url: string, fields: Record<string, string>, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<{ status: number }>;

/** Asks the publication's hub for a subscription. The hub confirms later at the callback. */
export async function subscribeToHub(publication: Publication, appUrl: string, signal?: AbortSignal, post: Post = postPublicForm): Promise<"requested" | "failed" | "skipped"> {
  if (!publication.hubUrl) return "skipped";
  const secret = publication.websubSecret ?? randomBytes(32).toString("hex");
  try {
    const response = await post(publication.hubUrl, {
      "hub.mode": "subscribe", "hub.topic": publication.feedUrl, "hub.callback": callbackUrl(appUrl, publication.id),
      "hub.secret": secret, "hub.lease_seconds": String(WEBSUB_LEASE_SECONDS),
    }, { signal, timeoutMs: 8000 });
    if (response.status < 200 || response.status >= 300) return "failed";
  } catch {
    return "failed";
  }
  await recordWebSubRequest(publication.id, secret);
  return "requested";
}

/** Subscribes or renews for every publication whose lease is missing or ending. */
export async function renewWebSubLeases(limit: number, appUrl: string, signal?: AbortSignal): Promise<{ requested: number; failed: number }> {
  const result = { requested: 0, failed: 0 };
  for (const publication of await websubDuePublications(limit)) {
    if (signal?.aborted) break;
    const outcome = await subscribeToHub(publication, appUrl, signal);
    if (outcome === "requested") result.requested++;
    else if (outcome === "failed") result.failed++;
  }
  return result;
}

/** `X-Hub-Signature: sha256=<hex>` over the raw body with our secret. */
export function verifyHubSignature(header: string | undefined, secret: string, body: Buffer): boolean {
  const [method, hex] = (header ?? "").trim().split("=", 2);
  const algorithm = SIGNATURE_METHODS[method?.toLowerCase() ?? ""];
  if (!algorithm || !hex) return false;
  const expected = createHmac(algorithm, secret).update(body).digest("hex");
  return expected.length === hex.length && timingSafeEqual(Buffer.from(expected), Buffer.from(hex.toLowerCase()));
}
