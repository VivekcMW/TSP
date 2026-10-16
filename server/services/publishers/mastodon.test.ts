import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormData, Request, Response, type RequestInit } from "node-fetch";
import type { Agent } from "node:http";
import type { LookupFunction } from "node:net";

const { getSocialAccountByProvider, getMediaAsset, decryptWebhookUrl, readMedia, network, lookup } = vi.hoisted(() => ({ getSocialAccountByProvider: vi.fn(), getMediaAsset: vi.fn(), decryptWebhookUrl: vi.fn(), readMedia: vi.fn(), network: vi.fn(), lookup: vi.fn() }));
vi.mock("../../storage", () => ({ storage: { getSocialAccountByProvider, getMediaAsset } }));
vi.mock("../webhookSecrets", () => ({ decryptWebhookUrl }));
vi.mock("../mediaStorage", () => ({ readMedia }));
vi.mock("node-fetch", async original => ({ ...await original<typeof import("node-fetch")>(), default: network }));
vi.mock("node:dns/promises", () => ({ default: { lookup } }));

import { publishToMastodon, verifyMastodonAccessToken } from "./mastodon";

const scope = { tenantId: "tenant", userId: "user" };
const attachment = [{ id: "11111111-1111-4111-8111-111111111111" }];
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("PUBLISHING_MODE", "live");
  getSocialAccountByProvider.mockResolvedValue({ providerAccountId: "https://mastodon.social", accessToken: "encrypted" });
  getMediaAsset.mockResolvedValue({ fileName: "demo.mp4", contentType: "video/mp4", storageKey: "tenant/user/video" });
  readMedia.mockResolvedValue(Buffer.from("video")); decryptWebhookUrl.mockReturnValue("token");
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  network.mockImplementation(async () => new Response(JSON.stringify({ id: "post-id" })));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unpinned fetch forbidden"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Mastodon publisher", () => {
  it("publishes to the connected instance", async () => {
    network.mockResolvedValue(new Response(JSON.stringify({ id: "post-id", url: "https://mastodon.social/@user/post-id" }), { status: 200 }));
    const result = await publishToMastodon(scope, "draft", "A Mastodon post");
    expect(result).toEqual({ success: true, postId: "post-id", postUrl: "https://mastodon.social/@user/post-id" });
    expect(network).toHaveBeenCalledWith(new URL("https://mastodon.social/api/v1/statuses"), expect.objectContaining({ method: "POST", redirect: "manual", headers: expect.objectContaining({ Authorization: "Bearer token" }) }));
  });
  it("uploads video and attaches it to the status", async () => {
    network.mockImplementationOnce(async (url: URL, options: RequestInit) => {
      expect(options.body).toBeInstanceOf(FormData);
      // Exercise node-fetch's real multipart encoder, not just a FormData mock.
      const encoded = new Request(url, options);
      expect(encoded.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
      expect(await encoded.text()).toContain('filename="demo.mp4"');
      return new Response(JSON.stringify({ id: "media-id" }));
    });
    expect((await publishToMastodon(scope, "draft", "A video post", attachment)).success).toBe(true);
    expect(network).toHaveBeenNthCalledWith(1, new URL("https://mastodon.social/api/v2/media"), expect.objectContaining({ method: "POST" }));
    expect(network).toHaveBeenNthCalledWith(2, new URL("https://mastodon.social/api/v1/statuses"), expect.objectContaining({ body: expect.stringContaining('"media_ids":["media-id"]') }));
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("verifies credentials through a pinned connection", async () => {
    expect(await verifyMastodonAccessToken("https://mastodon.social/", "token")).toEqual({ ok: true });
    expect(network).toHaveBeenCalledWith(new URL("https://mastodon.social/api/v1/accounts/verify_credentials"), expect.objectContaining({ method: "GET", redirect: "manual", agent: expect.anything() }));
  });
  it.each(["https://127.0.0.1", "https://2130706433", "https://10.0.0.1", "https://169.254.169.254", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://[fc00::1]", "https://host.internal", "https://localhost.", "https://foo.local", "http://mastodon.social", "https://user:password@mastodon.social", "https://bad_host.test"])("rejects unsafe instance %s at verify and publish", async instanceUrl => {
    expect(await verifyMastodonAccessToken(instanceUrl, "token")).toHaveProperty("error");
    getSocialAccountByProvider.mockResolvedValue({ providerAccountId: instanceUrl, accessToken: "encrypted" });
    expect((await publishToMastodon(scope, "draft", "text", attachment)).success).toBe(false);
    expect(network).not.toHaveBeenCalled(); expect(readMedia).not.toHaveBeenCalled();
  });
  it.each(["10.0.0.1", "127.0.0.1", "169.254.169.254", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])("blocks private DNS %s on every operation", async address => {
    lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    expect(await verifyMastodonAccessToken("https://mastodon.social", "token")).toHaveProperty("error");
    expect((await publishToMastodon(scope, "draft", "text")).success).toBe(false);
    expect((await publishToMastodon(scope, "draft", "text", attachment)).success).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
  it("pins a public answer when later DNS answers would rebind to loopback", async () => {
    lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    network.mockImplementation(async (url: URL, options: RequestInit) => {
      expect(url.hostname).toBe("mastodon.social");
      const agent = options.agent as Agent & { options: { lookup: LookupFunction } };
      const callback = vi.fn(); agent.options.lookup(url.hostname, {}, callback);
      expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
      return new Response('{"id":"safe"}');
    });
    expect((await publishToMastodon(scope, "draft", "text")).success).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("revalidates DNS between media upload and status creation", async () => {
    lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    expect((await publishToMastodon(scope, "draft", "text", attachment)).success).toBe(false);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0].pathname).toBe("/api/v2/media");
  });
  it.each(["/same-origin", "https://other.public.test/steal", "https://127.0.0.1/steal", "http://mastodon.social/downgrade"])("never follows %s for verify, media or status", async location => {
    network.mockImplementation(async () => new Response(null, { status: 307, headers: { location } }));
    expect(await verifyMastodonAccessToken("https://mastodon.social", "token")).toHaveProperty("error");
    expect((await publishToMastodon(scope, "draft", "text")).success).toBe(false);
    expect((await publishToMastodon(scope, "draft", "text", attachment)).success).toBe(false);
    expect(network).toHaveBeenCalledTimes(3);
    for (const [url, options] of network.mock.calls) {
      expect(url.origin).toBe("https://mastodon.social"); expect(options.redirect).toBe("manual");
    }
  });
  it("does not send provider error text or tokens back to callers", async () => {
    network.mockImplementation(async () => new Response('{"error":"Bearer token private detail"}', { status: 401 }));
    expect(JSON.stringify(await verifyMastodonAccessToken("https://mastodon.social", "token"))).not.toContain("private detail");
    expect(JSON.stringify(await publishToMastodon(scope, "draft", "text"))).not.toContain("Bearer token");
  });
  it("does not dispatch in sandbox or without credentials", async () => {
    vi.stubEnv("PUBLISHING_MODE", "sandbox");
    expect(await publishToMastodon(scope, "draft", "text")).toMatchObject({ status: "simulated" });
    vi.stubEnv("PUBLISHING_MODE", "live"); getSocialAccountByProvider.mockResolvedValue(undefined);
    expect((await publishToMastodon(scope, "draft", "text")).success).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
});
