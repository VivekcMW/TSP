import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), create: vi.fn(), update: vi.fn(), cas: vi.fn(),
  devto: vi.fn(), hashnode: vi.fn(), mastodon: vi.fn(), bluesky: vi.fn(), telegram: vi.fn(), webhook: vi.fn(),
}));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: { getSocialAccountByProvider: mocks.get, createSocialAccount: mocks.create, updateSocialAccount: mocks.update, compareAndSwapSocialCredentials: mocks.cas } }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  authedOf: () => ({ tenant: { tenantId: "test-tenant", userId: "test-user" } }),
}));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: Request, _res: Response, next: NextFunction) => next() }));
vi.mock("../services/publishers/devto", () => ({ verifyDevToApiKey: mocks.devto }));
vi.mock("../services/publishers/hashnode", () => ({ resolveHashnodePublication: mocks.hashnode }));
vi.mock("../services/publishers/mastodon", () => ({ verifyMastodonAccessToken: mocks.mastodon }));
vi.mock("../services/publishers/bluesky", () => ({ verifyBlueskyAppPassword: mocks.bluesky }));
vi.mock("../services/publishers/telegram", () => ({ verifyTelegramBot: mocks.telegram }));
vi.mock("../services/webhookPublisher", () => ({ WEBHOOK_PROVIDERS: ["slack", "discord"], isValidWebhookUrl: () => true, verifyWebhook: mocks.webhook }));
import { registerIntegrationsRoutes } from "./integrations";
import { encryptWebhookUrl } from "../services/webhookSecrets";

const app = express(); app.use(express.json()); registerIntegrationsRoutes(app);
const secret = "fake-route-credential-token-1234567890";
const scope = { tenantId: "test-tenant", userId: "test-user" };
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.get.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async (_scope, data) => ({ id: "id", ...data }));
  mocks.update.mockImplementation(async (_scope, id, data) => ({ id, ...data }));
  mocks.cas.mockImplementation(async (_scope, id, version, data) => ({ id, ...data, credentialVersion: version + 1 }));
  for (const name of ["devto", "mastodon", "bluesky"] as const) mocks[name].mockResolvedValue({ ok: true });
  mocks.hashnode.mockResolvedValue({ publicationId: "verified-publication" });
  mocks.telegram.mockResolvedValue({ ok: true, chatTitle: "Verified chat" });
  mocks.webhook.mockResolvedValue(undefined);
  vi.stubEnv("WEBHOOK_ENCRYPTION_SECRET", "fake-route-test-key-at-least-32-characters");
  vi.stubEnv("WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS", "[]");
  vi.stubEnv("LINKEDIN_CLIENT_ID", "fake-id"); vi.stubEnv("LINKEDIN_CLIENT_SECRET", "fake-secret");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network call")));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const dedicated = [
  { route: "devto/api-key", verifier: "devto", body: { apiKey: secret } },
  { route: "hashnode/personal-access-token", verifier: "hashnode", body: { personalAccessToken: secret } },
  { route: "mastodon/access-token", verifier: "mastodon", body: { instanceUrl: "https://mastodon.example", accessToken: secret } },
  { route: "bluesky/app-password", verifier: "bluesky", body: { handle: "test.bsky.social", appPassword: secret } },
  { route: "telegram/bot-token", verifier: "telegram", body: { botToken: secret, chatId: "-100123" } },
] as const;

describe("verified connection routes", () => {
  it.each(["linkedin", "twitter", "x", "reddit", "threads", "medium", "substack", "facebook", "mastodon", "telegram", "bluesky", "slack", "unknown"])("blocks generic unverified %s connections", async provider => {
    const response = await request(app).post(`/api/integrations/${provider}/connect`).send({ accessToken: secret });
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["devto", "hashnode"] as const)("verifies generic %s before writing and excludes credentials from response", async provider => {
    const response = await request(app).post(`/api/integrations/${provider}/connect`).send({ accessToken: secret });
    expect(response.status).toBe(200);
    expect(mocks[provider]).toHaveBeenCalledWith(secret);
    expect(mocks[provider].mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(mocks.create).toHaveBeenCalledWith(scope, expect.objectContaining({ accessToken: secret, providerAccountId: provider === "hashnode" ? "verified-publication" : "devto" }));
    expect(response.text).not.toContain(secret); expect(response.body.instance).not.toHaveProperty("accessToken");
  });
  it.each(["devto", "hashnode"] as const)("rejects failed generic %s verification without persistence", async provider => {
    mocks[provider].mockResolvedValue({ error: secret });
    const response = await request(app).post(`/api/integrations/${provider}/connect`).send({ accessToken: secret });
    expect(response.status).toBe(400); expect(response.text).not.toContain(secret);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects caller-supplied verified metadata, expiry and ciphertext", async () => {
    for (const body of [{ accessToken: secret, providerAccountId: "invented", tokenExpiresAt: "2030-01-01" }, { accessToken: encryptWebhookUrl(secret) }]) {
      expect((await request(app).post("/api/integrations/devto/connect").send(body)).status).toBe(400);
    }
    expect(mocks.devto).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(dedicated)("verifies $route before persistence and sanitizes response", async ({ route, verifier, body }) => {
    const response = await request(app).post(`/api/integrations/${route}`).send(body);
    expect(response.status).toBe(201);
    expect(mocks[verifier].mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(response.text).not.toContain(secret);
    expect(response.body.instance).not.toHaveProperty("accessToken");
  });
  it.each(dedicated)("rejects $route verification failures and catches thrown errors safely", async ({ route, verifier, body }) => {
    mocks[verifier].mockResolvedValueOnce({ error: secret }).mockRejectedValueOnce(new Error(secret));
    expect((await request(app).post(`/api/integrations/${route}`).send(body)).status).toBe(400);
    const thrown = await request(app).post(`/api/integrations/${route}`).send(body);
    expect(thrown.status).toBe(500); expect(thrown.text).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(dedicated)("rejects storage envelopes at $route before provider verification", async ({ route, verifier, body }) => {
    const encryptedBody = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, value === secret ? encryptWebhookUrl(secret) : value]));
    const response = await request(app).post(`/api/integrations/${route}`).send(encryptedBody);
    expect(response.status).toBe(400); expect(mocks[verifier]).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not report generic connect success if the connection disappears", async () => {
    mocks.get.mockResolvedValue({ id: "old" }); mocks.update.mockResolvedValue(undefined);
    const response = await request(app).post("/api/integrations/devto/connect").send({ accessToken: secret });
    expect(response.status).toBe(409); expect(response.body.success).not.toBe(true);
    expect(mocks.devto).toHaveBeenCalledWith(secret);
  });
  it("verifies webhooks before write and redacts webhook/provider errors", async () => {
    const body = { webhookUrl: `https://hooks.slack.com/services/T/B/${secret}` };
    expect((await request(app).post("/api/integrations/slack/webhook").send(body)).status).toBe(201);
    expect(mocks.webhook.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    mocks.create.mockClear(); mocks.webhook.mockRejectedValueOnce(new Error(body.webhookUrl));
    const response = await request(app).post("/api/integrations/slack/webhook").send(body);
    expect(response.status).toBe(400); expect(response.text).not.toContain(secret);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret);
  });
  it("hides raw storage exceptions", async () => {
    mocks.create.mockRejectedValue(new Error(`SQL params ${secret}`));
    const response = await request(app).post("/api/integrations/devto/connect").send({ accessToken: secret });
    expect(response.status).toBe(500); expect(response.text).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret);
  });
});

describe("refresh HTTP contract", () => {
  it("persists actual expiry, retains omitted refresh and never serializes tokens", async () => {
    const refreshToken = encryptWebhookUrl("fake-old-refresh");
    mocks.get.mockResolvedValue({ id: "existing", accessToken: "old", refreshToken, credentialVersion: 7 });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ access_token: secret, expires_in: 37 })));
    const start = Date.now();
    const response = await request(app).post("/api/integrations/linkedin/refresh").send({});
    expect(response.status).toBe(200); expect(response.body.result.success).toBe(true);
    expect(mocks.cas).toHaveBeenCalledWith(scope, "existing", 7, expect.any(Object));
    expect(mocks.update).not.toHaveBeenCalled();
    const data = mocks.cas.mock.calls[0][3];
    expect(data.accessToken).toBe(secret); expect(data).not.toHaveProperty("refreshToken");
    expect(data.tokenExpiresAt.getTime()).toBeGreaterThanOrEqual(start + 37000);
    expect(data.tokenExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 37000);
    expect(response.text).not.toContain(secret); expect(response.text).not.toContain(refreshToken);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("does not network without a connection", async () => {
    expect((await request(app).post("/api/integrations/linkedin/refresh").send({})).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not write on unsupported refresh and does not report success after a lost update", async () => {
    mocks.get.mockResolvedValue({ id: "existing", refreshToken: "fake-refresh", credentialVersion: 0 });
    const unsupported = await request(app).post("/api/integrations/devto/refresh").send({});
    expect(unsupported.body.result.status).toBe("unsupported"); expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ access_token: secret })));
    mocks.cas.mockResolvedValue(undefined);
    const response = await request(app).post("/api/integrations/linkedin/refresh").send({});
    expect(response.body.result.success).toBe(false); expect(response.text).not.toContain(secret);
  });
  it("rejects a legacy/missing version before sending credentials", async () => {
    mocks.get.mockResolvedValue({ id: "existing", refreshToken: "fake-refresh" });
    const response = await request(app).post("/api/integrations/linkedin/refresh").send({});
    expect(response.status).toBe(409); expect(response.body.message).toContain("reconnect");
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.cas).not.toHaveBeenCalled();
  });
  it("reconnect B wins while refresh A is in flight", async () => {
    let row = { id: "existing", providerAccountId: "identity-A", accessToken: "access-A", refreshToken: "refresh-A", credentialVersion: 3 };
    mocks.get.mockImplementation(async () => ({ ...row }));
    mocks.cas.mockImplementation(async (_scope, _id, version, data) => {
      if (row.credentialVersion !== version) return undefined;
      row = { ...row, ...data, credentialVersion: version + 1 }; return row;
    });
    let release!: (response: globalThis.Response) => void;
    let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    vi.mocked(fetch).mockImplementation(() => { began(); return new Promise(resolve => { release = resolve; }); });
    const pending = request(app).post("/api/integrations/linkedin/refresh").send({}).then(response => response);
    await started;
    row = { ...row, providerAccountId: "identity-B", accessToken: "access-B", refreshToken: "refresh-B", credentialVersion: 4 };
    release(new Response(JSON.stringify({ access_token: "late-access-A", refresh_token: "late-refresh-A" })));
    const response = await pending;
    expect(response.status).toBe(409); expect(response.body.result.reason).toContain("reload Connections");
    expect(response.body.result.success).toBe(false);
    expect(mocks.cas.mock.calls[0][2]).toBe(3);
    expect(row).toMatchObject({ providerAccountId: "identity-B", accessToken: "access-B", refreshToken: "refresh-B", credentialVersion: 4 });
    expect(response.text).not.toMatch(/late-access|late-refresh|access-B|refresh-B/);
  });
});