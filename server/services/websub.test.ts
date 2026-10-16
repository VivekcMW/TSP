import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordRequest, due } = vi.hoisted(() => ({ recordRequest: vi.fn(), due: vi.fn() }));
vi.mock("./articlePool", () => ({ recordWebSubRequest: recordRequest, websubDuePublications: due }));
import { callbackUrl, hubLink, renewWebSubLeases, subscribeToHub, verifyHubSignature, WEBSUB_LEASE_SECONDS } from "./websub";
import type { Publication } from "@shared/schema";

const publication = (extra: Partial<Publication> = {}): Publication => ({
  id: "pub-1", name: "Daily", siteUrl: "https://daily.test", feedUrl: "https://daily.test/feed", sourceType: "feed", addedVia: "user-source", isActive: true,
  lastCrawledAt: null, lastCrawlStatus: null, lastCrawlError: null, consecutiveFailures: 0, etag: null, lastModified: null,
  hubUrl: "https://hub.test/", websubSecret: null, websubSubscribedAt: null, websubLeaseExpiresAt: null, createdAt: new Date(), updatedAt: new Date(), ...extra,
});

beforeEach(() => { vi.resetAllMocks(); recordRequest.mockResolvedValue(undefined); });

describe("hubLink", () => {
  it("finds the hub in Atom and RSS feeds, whatever the attribute order", () => {
    expect(hubLink('<feed><link rel="self" href="https://a.test/feed"/><link href="https://pubsubhubbub.appspot.com/" rel="hub"/></feed>')).toBe("https://pubsubhubbub.appspot.com/");
    expect(hubLink("<rss><channel><atom:link rel='hub' href='https://websub.rocks/hub' /></channel></rss>")).toBe("https://websub.rocks/hub");
    expect(hubLink('<feed><link rel="alternate" href="https://a.test/"/></feed>')).toBeNull();
    expect(hubLink('<feed><link rel="hub" href="ftp://hub.test/"/></feed>')).toBeNull();
  });
});

describe("subscribeToHub", () => {
  it("asks the hub for a lease with a fresh secret and remembers the request", async () => {
    const post = vi.fn(async () => ({ url: "https://hub.test/", text: "", status: 202, headers: new Headers() }));
    expect(await subscribeToHub(publication(), "https://www.thesocialpundit.com/", undefined, post)).toBe("requested");
    const [url, fields] = post.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(url).toBe("https://hub.test/");
    expect(fields).toMatchObject({ "hub.mode": "subscribe", "hub.topic": "https://daily.test/feed", "hub.callback": "https://www.thesocialpundit.com/api/websub/pub-1", "hub.lease_seconds": String(WEBSUB_LEASE_SECONDS) });
    expect(fields["hub.secret"]).toMatch(/^[0-9a-f]{64}$/);
    expect(recordRequest).toHaveBeenCalledExactlyOnceWith("pub-1", fields["hub.secret"]);
  });

  it("keeps an existing secret on renewal, and reports a hub that refuses or fails", async () => {
    const post = vi.fn(async () => ({ url: "", text: "", status: 202, headers: new Headers() }));
    await subscribeToHub(publication({ websubSecret: "s".repeat(64) }), "https://app.test", undefined, post);
    expect((post.mock.calls[0] as unknown as [string, Record<string, string>])[1]["hub.secret"]).toBe("s".repeat(64));
    expect(await subscribeToHub(publication(), "https://app.test", undefined, vi.fn(async () => ({ url: "", text: "", status: 404, headers: new Headers() })))).toBe("failed");
    expect(await subscribeToHub(publication(), "https://app.test", undefined, vi.fn(async () => { throw new Error("down"); }))).toBe("failed");
    expect(await subscribeToHub(publication({ hubUrl: null }), "https://app.test", undefined, post)).toBe("skipped");
    expect(callbackUrl("https://app.test/", "x")).toBe("https://app.test/api/websub/x");
  });

  it("renews every due lease it can", async () => {
    due.mockResolvedValue([publication(), publication({ id: "pub-2", hubUrl: "https://hub2.test/" })]);
    vi.mock("./crawlerFetch.js", async original => ({ ...await original<typeof import("./crawlerFetch.js")>(), postPublicForm: vi.fn(async (url: string) => ({ url, text: "", status: url.includes("hub2") ? 500 : 202, headers: new Headers() })) }));
    expect(await renewWebSubLeases(10, "https://app.test")).toEqual({ requested: 1, failed: 1 });
  });
});

describe("verifyHubSignature", () => {
  const body = Buffer.from("<feed/>");
  const secret = "topsecret";
  it("accepts the hub's HMAC over the raw body and rejects everything else", () => {
    expect(verifyHubSignature(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`, secret, body)).toBe(true);
    expect(verifyHubSignature(`sha1=${createHmac("sha1", secret).update(body).digest("hex").toUpperCase()}`, secret, body)).toBe(true);
    expect(verifyHubSignature(`sha256=${createHmac("sha256", "other").update(body).digest("hex")}`, secret, body)).toBe(false);
    expect(verifyHubSignature("md5=abc", secret, body)).toBe(false);
    expect(verifyHubSignature(undefined, secret, body)).toBe(false);
    expect(verifyHubSignature("sha256=", secret, body)).toBe(false);
  });
});
