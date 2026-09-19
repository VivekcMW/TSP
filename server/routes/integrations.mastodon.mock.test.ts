import type { Express, Request, Response as ExpressResponse } from "express";
import { Response } from "node-fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), update: vi.fn(), network: vi.fn(), lookup: vi.fn() }));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: { getSocialAccountByProvider: mocks.get, createSocialAccount: mocks.create, updateSocialAccount: mocks.update } }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: vi.fn(), authedOf: () => ({ tenant: { tenantId: "tenant", userId: "user" } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => vi.fn() }));
vi.mock("../services/publishers/hashnode", () => ({ resolveHashnodePublication: vi.fn() }));
vi.mock("../services/publishers/bluesky", () => ({ verifyBlueskyAppPassword: vi.fn() }));
vi.mock("../services/publishers/devto", () => ({ verifyDevToApiKey: vi.fn() }));
vi.mock("../services/publishers/telegram", () => ({ verifyTelegramBot: vi.fn() }));
vi.mock("../services/publishers/providerAuth", () => ({ refreshProviderAccessToken: vi.fn(), validateProviderRuntimeConfig: vi.fn() }));
vi.mock("../services/webhookPublisher", () => ({ WEBHOOK_PROVIDERS: [], isValidWebhookUrl: vi.fn(), verifyWebhook: vi.fn() }));
vi.mock("../services/mediaStorage", () => ({ readMedia: vi.fn() }));
vi.mock("node-fetch", async original => ({ ...await original<typeof import("node-fetch")>(), default: mocks.network }));
vi.mock("node:dns/promises", () => ({ default: { lookup: mocks.lookup } }));
import { registerIntegrationsRoutes } from "./integrations";

// Invoke the real route + verifier + pinned transport, without even opening an
// HTTP listener. Only auth/storage/DNS/network boundaries are mocks.
let connect!: (req: Request, res: ExpressResponse) => Promise<unknown>;
registerIntegrationsRoutes({
  post(route: string, ...handlers: unknown[]) {
    if (route === "/api/integrations/mastodon/access-token") connect = handlers.at(-1) as typeof connect;
  }, get() {}, delete() {},
} as unknown as Express);
const token = "test-only-mastodon-token-1234567890";
async function request(instanceUrl: string) {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res); res.json.mockReturnValue(res);
  await connect({ body: { instanceUrl, accessToken: token } } as Request, res as unknown as ExpressResponse);
  return { status: res.status.mock.lastCall?.[0], body: res.json.mock.lastCall?.[0] };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.network.mockImplementation(async () => new Response('{"id":"verified"}'));
  mocks.create.mockImplementation(async (_scope, data) => ({ id: "account", ...data }));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unpinned fetch forbidden"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("Mastodon connection SSRF boundary", () => {
  it.each(["https://127.0.0.1", "https://2130706433", "https://10.0.0.1", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://foo.internal", "https://foo.localhost", "http://instance.test", "https://user:password@instance.test"])("rejects %s without dispatch or persistence", async url => {
    expect((await request(url)).status).toBe(400);
    expect(mocks.network).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["127.0.0.1", "169.254.169.254", "fc00::1", "::1"])("rejects a syntactically allowed hostname resolving to %s", async address => {
    mocks.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    expect((await request("https://instance.test")).status).toBe(400);
    expect(mocks.network).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not follow a provider redirect or persist its credentials", async () => {
    mocks.network.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://another.test/steal" } }));
    expect((await request("https://instance.test")).status).toBe(400);
    expect(mocks.network).toHaveBeenCalledTimes(1); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("stores only after successful pinned verification and excludes tokens from its response", async () => {
    const result = await request("https://instance.test/profile");
    expect(result.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ tenantId: "tenant", userId: "user" }, expect.objectContaining({ providerAccountId: "https://instance.test", accessToken: token }));
    expect(mocks.network.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(JSON.stringify(result.body)).not.toContain(token);
  });
});