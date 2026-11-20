import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storage, repo, tenancy, urls, scope, session, seenPermissions, NoteLimitError, TokenLimitError } = vi.hoisted(() => {
  class NoteLimitError extends Error { readonly status = 409; constructor() { super("You have reached the 200-note limit. Delete a note first."); } }
  class TokenLimitError extends Error { readonly status = 409; constructor() { super("You can have up to 5 active keys. Revoke one first."); } }
  return {
    storage: { addInboxItem: vi.fn(), updateInboxItem: vi.fn(), createUserNote: vi.fn() },
    repo: {
      CAPTURE_TOKEN_LIMIT: 5, INBOUND_DAILY_MESSAGE_LIMIT: 30, RECENT_INBOUND_LIMIT: 10, CaptureTokenLimitError: TokenLimitError,
      getInboundAddress: vi.fn(), createInboundAddress: vi.fn(), replaceInboundAddressToken: vi.fn(), disableInboundAddress: vi.fn(),
      resolveInboundAddress: vi.fn(), reserveInboundMessage: vi.fn(), finishInboundMessage: vi.fn(), releaseInboundMessage: vi.fn(),
      listInboundMessages: vi.fn(), listCaptureTokens: vi.fn(), createCaptureToken: vi.fn(), revokeCaptureToken: vi.fn(),
      resolveCaptureToken: vi.fn(), touchCaptureToken: vi.fn(),
    },
    tenancy: { resolveTenantContext: vi.fn() },
    urls: { resolvePublicHttpUrl: vi.fn() },
    scope: { tenantId: "tenant-1", userId: "user-1" },
    session: { viaPlatformRole: false },
    seenPermissions: [] as string[],
    NoteLimitError, TokenLimitError,
  };
});

vi.mock("../storage", () => ({ storage, UserNoteLimitError: NoteLimitError }));
vi.mock("../repositories/inputs", () => repo);
vi.mock("../services/tenancy", () => tenancy);
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../db", () => { throw new Error("Database must not load in inputs route tests"); });
vi.mock("../services/urlValidator", async importOriginal => ({ ...await importOriginal<typeof import("../services/urlValidator")>(), ...urls }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  authedOf: () => ({ tenant: { ...scope, role: "owner", platformRole: null, viaPlatformRole: session.viaPlatformRole }, dbUser: { id: scope.userId } }),
}));
vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: (permission: string) => (_req: Request, _res: Response, next: NextFunction) => { seenPermissions.push(permission); next(); },
}));

import { CAPTURE_HOURLY_LIMIT, registerInputsRoutes } from "./inputs";
import { INBOUND_EMAIL_PATH, inboundEmailGate, inboundEmailJson } from "../services/inboundEmail";
import { captureCors, generateCaptureToken, isCapturePath } from "../services/captureTokens";
import { encryptWebhookUrl } from "../services/webhookSecrets";

// Same middleware order as server/index.ts: capture CORS and the inbound parser come before the default JSON parser.
const app = express();
app.use((req, res, next) => (isCapturePath(req.path) ? captureCors(req, res, next) : next()));
app.use(INBOUND_EMAIL_PATH, inboundEmailGate, inboundEmailJson);
app.use(express.json());
registerInputsRoutes(app);

const DOMAIN = "in.thesocialpundit.com";
const SECRET = "inbound-webhook-secret-for-tests-0123456789";
const ADDRESS_TOKEN = "k3v9q2m8x7c4b1n6z5l0p2r8tw";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const basic = (secret = SECRET) => `Basic ${Buffer.from(`postmark:${secret}`).toString("base64")}`;
const member = { ...scope, role: "member", platformRole: null, viaPlatformRole: false };
const NEWSLETTER_HTML = `<html><body>
  <a href="https://brief.retailwire-news.com/p/issue-9">View this email in your browser</a>
  <h2><a href="https://www.adweek.com/commerce/amazon-sponsored-tv-for-all/?utm_source=brief">Amazon opens Sponsored TV to all sellers</a></h2>
  <p><a href="https://digiday.com/marketing/why-walmart-connect-is-hiring/">Why Walmart Connect is hiring</a></p>
  <p><a href="https://brief.retailwire-news.com/action/disable_email?token=x">Unsubscribe</a></p></body></html>`;
const inbound = (overrides: Record<string, unknown> = {}) => ({
  From: "editor@retailwire-news.com", FromName: "The Retail Media Brief", FromFull: { Email: "editor@retailwire-news.com", Name: "The Retail Media Brief" },
  To: "reader@gmail.com", ToFull: [{ Email: "reader@gmail.com", Name: "" }], OriginalRecipient: `${ADDRESS_TOKEN}@${DOMAIN}`,
  Subject: "Fwd: Issue 9: Retail media goes self-serve", MessageID: "pm-1", Date: "Mon, 16 Nov 2026 06:00:00 +0000",
  HtmlBody: NEWSLETTER_HTML, TextBody: "", Headers: [{ Name: "Message-ID", Value: "<issue9@retailwire-news.com>" }], Attachments: [],
  ...overrides,
});
const item = (overrides: Record<string, unknown> = {}) => ({ id: "item-1", headline: "Saved page", articleUrl: "https://news.site.com/story", status: "saved", ...overrides });
const owner = { id: "token-row-1", ...scope };

beforeEach(() => {
  vi.clearAllMocks();
  seenPermissions.length = 0;
  session.viaPlatformRole = false;
  vi.stubEnv("INBOUND_EMAIL_DOMAIN", DOMAIN);
  vi.stubEnv("INBOUND_EMAIL_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  tenancy.resolveTenantContext.mockResolvedValue(member);
  urls.resolvePublicHttpUrl.mockResolvedValue({ ok: true, records: [{ address: "93.184.216.34", family: 4 }] });
  repo.resolveInboundAddress.mockResolvedValue({ id: "address-1", ...scope });
  repo.reserveInboundMessage.mockResolvedValue({ outcome: "reserved", id: "message-1" });
  repo.finishInboundMessage.mockResolvedValue(undefined);
  repo.releaseInboundMessage.mockResolvedValue(undefined);
  repo.touchCaptureToken.mockResolvedValue(undefined);
  storage.addInboxItem.mockImplementation(async (_scope, value) => ({ item: item({ headline: value.headline, articleUrl: value.articleUrl }), alreadyExists: false }));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("POST /api/inbound/email", () => {
  const post = (body: unknown, authorization = basic()) => request(app).post(INBOUND_EMAIL_PATH).set("Authorization", authorization).send(body as object);

  it("is unavailable until the domain and secret are configured", async () => {
    vi.stubEnv("INBOUND_EMAIL_SECRET", "");
    await post(inbound()).expect(503);
    expect(repo.resolveInboundAddress).not.toHaveBeenCalled();
  });

  it.each([["no credentials", ""], ["a wrong secret", basic("wrong-secret-of-a-similar-length-0123456789")], ["a bearer token", `Bearer ${SECRET}`]])(
    "rejects %s with 401 before reading the message", async (_label, authorization) => {
      await post(inbound(), authorization).expect(401);
      expect(repo.resolveInboundAddress).not.toHaveBeenCalled();
    });

  it("also accepts the secret in the X-Inbound-Secret header", async () => {
    await request(app).post(INBOUND_EMAIL_PATH).set("X-Inbound-Secret", SECRET).send(inbound()).expect(200);
  });

  it("rejects a payload that is not an inbound email with 400", async () => {
    await post({ hello: "world" }).expect(400);
    await post(inbound({ Subject: { nested: true } })).expect(400);
  });

  it("saves the newsletter's article links to the owner's Shortlist without fetching them", async () => {
    storage.addInboxItem.mockResolvedValueOnce({ item: item(), alreadyExists: true });
    expect((await post(inbound()).expect(200)).body).toEqual({ received: true });
    expect(repo.resolveInboundAddress).toHaveBeenCalledExactlyOnceWith(sha256(ADDRESS_TOKEN));
    expect(tenancy.resolveTenantContext).toHaveBeenCalledWith(scope.userId, scope.tenantId);
    expect(repo.reserveInboundMessage).toHaveBeenCalledExactlyOnceWith(scope, {
      messageId: "issue9@retailwire-news.com", fromAddress: "editor@retailwire-news.com", fromName: "The Retail Media Brief", subject: "Fwd: Issue 9: Retail media goes self-serve",
    });
    expect(storage.addInboxItem.mock.calls.map(([target, value]) => [target, value.articleUrl, value.headline, value.status, value.source])).toEqual([
      [scope, "https://www.adweek.com/commerce/amazon-sponsored-tv-for-all/", "Amazon opens Sponsored TV to all sellers", "saved", "Newsletter: The Retail Media Brief"],
      [scope, "https://digiday.com/marketing/why-walmart-connect-is-hiring/", "Why Walmart Connect is hiring", "saved", "Newsletter: The Retail Media Brief"],
    ]);
    expect(storage.addInboxItem.mock.calls[0][1]).toMatchObject({ summary: "From the newsletter “Issue 9: Retail media goes self-serve”.", relevanceScore: "0" });
    expect(repo.finishInboundMessage).toHaveBeenCalledExactlyOnceWith(scope, "message-1", { status: "processed", linksFound: 2, itemsCreated: 1 });
    expect(urls.resolvePublicHttpUrl).not.toHaveBeenCalled();
  });

  it("answers 200 the same way for unknown recipients and stores nothing", async () => {
    repo.resolveInboundAddress.mockResolvedValue(undefined);
    expect((await post(inbound()).expect(200)).body).toEqual({ received: true });
    expect((await post(inbound({ OriginalRecipient: "someone@elsewhere.com" })).expect(200)).body).toEqual({ received: true });
    expect(repo.reserveInboundMessage).not.toHaveBeenCalled();
    expect(storage.addInboxItem).not.toHaveBeenCalled();
  });

  it("ignores addresses whose owner is no longer a member", async () => {
    tenancy.resolveTenantContext.mockResolvedValue(null);
    await post(inbound()).expect(200);
    expect(repo.reserveInboundMessage).not.toHaveBeenCalled();
  });

  it.each(["duplicate", "rate_limited"] as const)("creates nothing for a %s message", async outcome => {
    repo.reserveInboundMessage.mockResolvedValue({ outcome });
    expect((await post(inbound()).expect(200)).body).toEqual({ received: true });
    expect(storage.addInboxItem).not.toHaveBeenCalled();
    expect(repo.finishInboundMessage).not.toHaveBeenCalled();
  });

  it("records Gmail's forwarding confirmation without saving its links", async () => {
    await post(inbound({
      From: "forwarding-noreply@google.com", FromName: "Gmail Team", FromFull: { Email: "forwarding-noreply@google.com", Name: "Gmail Team" },
      Subject: "(#482913507) Gmail Forwarding Confirmation - Receive Mail from reader@gmail.com",
      HtmlBody: '<a href="https://mail-settings.google.com/mail/vf-abc">https://mail-settings.google.com/mail/vf-abc</a>',
    })).expect(200);
    expect(repo.finishInboundMessage).toHaveBeenCalledExactlyOnceWith(scope, "message-1", { status: "confirmation", linksFound: 0, itemsCreated: 0 });
    expect(storage.addInboxItem).not.toHaveBeenCalled();
  });

  it("releases the reservation and returns 500 so the provider retries when saving fails", async () => {
    storage.addInboxItem.mockRejectedValue(new Error("database down"));
    await post(inbound()).expect(500);
    expect(repo.releaseInboundMessage).toHaveBeenCalledExactlyOnceWith(scope, "message-1");
    expect(repo.finishInboundMessage).not.toHaveBeenCalled();
  });

  it("accepts newsletters larger than the default 100 kB JSON limit", async () => {
    const padding = `<p>${"Long newsletter paragraph. ".repeat(12_000)}</p>`;
    await post(inbound({ HtmlBody: NEWSLETTER_HTML.replace("</body>", `${padding}</body>`) })).expect(200);
    expect(storage.addInboxItem).toHaveBeenCalledTimes(2);
  });
});

describe("/api/capture", () => {
  const save = (body: unknown, token = generateCaptureToken().token) =>
    request(app).post("/api/capture").set("Origin", "https://news.site.com").set("Authorization", `Bearer ${token}`).send(body as object);

  beforeEach(() => { repo.resolveCaptureToken.mockResolvedValue(owner); });

  it("answers CORS preflight for any origin, without credentials", async () => {
    const response = await request(app).options("/api/capture").set("Origin", "chrome-extension://abcdefghijklmnop")
      .set("Access-Control-Request-Method", "POST").expect(204);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["access-control-allow-headers"]).toBe("Authorization, Content-Type");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("requires a well-formed, active key", async () => {
    const missing = await request(app).post("/api/capture").set("Origin", "https://news.site.com").send({ url: "https://news.site.com/a" }).expect(401);
    expect(missing.headers["access-control-allow-origin"]).toBe("*");
    await save({ url: "https://news.site.com/a" }, "tsp_cap_tooshort").expect(401);
    repo.resolveCaptureToken.mockResolvedValue(undefined);
    const { token } = generateCaptureToken();
    await save({ url: "https://news.site.com/a" }, token).expect(401);
    expect(repo.resolveCaptureToken).toHaveBeenLastCalledWith(sha256(token));
    expect(storage.addInboxItem).not.toHaveBeenCalled();
  });

  it("rejects keys whose owner left the workspace", async () => {
    tenancy.resolveTenantContext.mockResolvedValue(null);
    await save({ url: "https://news.site.com/a" }).expect(401);
    tenancy.resolveTenantContext.mockResolvedValue({ ...member, viaPlatformRole: true });
    await save({ url: "https://news.site.com/a" }).expect(401);
    expect(storage.addInboxItem).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing URL", {}],
    ["a selection over 2000 characters", { url: "https://news.site.com/a", selection: "s".repeat(2001) }],
    ["a note over 1000 characters", { url: "https://news.site.com/a", note: "n".repeat(1001) }],
    ["a javascript: URL", { url: "javascript:alert(1)" }],
    ["a blocked example domain", { url: "https://example.com/a" }],
  ])("rejects %s with 400", async (_label, body) => {
    await save(body).expect(400);
    expect(storage.addInboxItem).not.toHaveBeenCalled();
  });

  it("rejects pages on private or internal addresses", async () => {
    urls.resolvePublicHttpUrl.mockResolvedValue({ ok: false, reason: "This host resolves to a private/internal address and isn't allowed." });
    expect((await save({ url: "https://intranet.corp.site.com/wiki" }).expect(400)).body.message).toMatch(/private/);
    expect(storage.addInboxItem).not.toHaveBeenCalled();
  });

  it("saves the page to Shortlist and records the key's use", async () => {
    const response = await save({ url: "https://www.ft.com/content/retail-media-2026", title: "  Retail media in 2026  " }).expect(201);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.body).toMatchObject({ created: true, noteCreated: false, message: "Saved to your Shortlist.", item: { status: "saved" } });
    expect(storage.addInboxItem).toHaveBeenCalledExactlyOnceWith(scope, expect.objectContaining({
      headline: "Retail media in 2026", source: "ft.com", articleUrl: "https://www.ft.com/content/retail-media-2026", status: "saved", summary: null,
    }));
    expect(storage.createUserNote).not.toHaveBeenCalled();
    expect(repo.touchCaptureToken).toHaveBeenCalledExactlyOnceWith(scope, owner.id);
  });

  it("also saves the selection and note as a Note", async () => {
    storage.createUserNote.mockResolvedValue({ id: "note-1" });
    const body = { url: "https://www.ft.com/content/retail-media-2026", title: "Retail media in 2026", selection: "Ad spend grew 20%.", note: "Use on Friday" };
    expect((await save(body).expect(201)).body.noteCreated).toBe(true);
    expect(storage.createUserNote).toHaveBeenCalledExactlyOnceWith(scope, "From Retail media in 2026: “Ad spend grew 20%.” — Use on Friday");
    expect(storage.addInboxItem.mock.calls[0][1].summary).toBe("Ad spend grew 20%.");
  });

  it("moves an existing story into Shortlist instead of duplicating it", async () => {
    storage.addInboxItem.mockResolvedValue({ item: item({ status: "dismissed" }), alreadyExists: true });
    storage.updateInboxItem.mockResolvedValue(item({ status: "saved" }));
    const response = await save({ url: "https://news.site.com/story" }).expect(200);
    expect(response.body).toMatchObject({ created: false, item: { id: "item-1", status: "saved" } });
    expect(storage.updateInboxItem).toHaveBeenCalledExactlyOnceWith(scope, "item-1", { status: "saved" });
  });

  it("still saves the page when the note limit is reached", async () => {
    storage.createUserNote.mockRejectedValue(new NoteLimitError());
    const response = await save({ url: "https://news.site.com/story", note: "Remember this" }).expect(201);
    expect(response.body).toMatchObject({ noteCreated: false, noteMessage: "You have reached the 200-note limit. Delete a note first." });
  });

  it(`limits one key to ${CAPTURE_HOURLY_LIMIT} saves an hour`, async () => {
    const { token } = generateCaptureToken();
    for (let i = 0; i < CAPTURE_HOURLY_LIMIT; i++) await save({ url: `https://news.site.com/story-${i}` }, token).expect(201);
    const limited = await save({ url: "https://news.site.com/one-more" }, token).expect(429);
    expect(limited.headers["access-control-allow-origin"]).toBe("*");
    await save({ url: "https://news.site.com/other-key" }).expect(201);
  }, 20_000);
});

describe("/api/inputs", () => {
  it("reports forwarding as unavailable when it is not configured and still lists keys", async () => {
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "");
    repo.listCaptureTokens.mockResolvedValue([{ id: "k1", label: "Laptop", tokenHint: "Ab_9", tokenHash: "x".repeat(64), createdAt: new Date("2026-11-01T00:00:00Z"), lastUsedAt: null }]);
    const { body } = await request(app).get("/api/inputs").expect(200);
    expect(body).toMatchObject({ forwarding: { available: false, domain: null, address: null, recent: [] }, capture: { limit: 5, tokens: [{ id: "k1", label: "Laptop", hint: "Ab_9", lastUsedAt: null }] } });
    expect(JSON.stringify(body)).not.toContain("x".repeat(64));
    expect(repo.getInboundAddress).not.toHaveBeenCalled();
    expect(seenPermissions).toEqual(["inbox:read:own"]);
  });

  it("shows the stored address to its owner, and recent forwards with any confirmation code", async () => {
    repo.getInboundAddress.mockResolvedValue({ tokenEncrypted: encryptWebhookUrl(ADDRESS_TOKEN), tokenHint: "r8tw", createdAt: new Date(), rotatedAt: null, disabled: false });
    repo.listInboundMessages.mockResolvedValue([{ id: "m1", fromName: "Gmail Team", fromAddress: "forwarding-noreply@google.com", status: "confirmation",
      subject: "(#482913507) Gmail Forwarding Confirmation - Receive Mail from reader@gmail.com", receivedAt: new Date(), linksFound: 0, itemsCreated: 0 }]);
    repo.listCaptureTokens.mockResolvedValue([]);
    const { body } = await request(app).get("/api/inputs").expect(200);
    expect(body.forwarding).toMatchObject({ available: true, domain: DOMAIN, address: { email: `${ADDRESS_TOKEN}@${DOMAIN}`, hint: "r8tw" } });
    expect(body.forwarding.recent[0]).toMatchObject({ status: "confirmation", confirmationCode: "482913507" });
    session.viaPlatformRole = true;
    expect((await request(app).get("/api/inputs").expect(200)).body.forwarding.address.email).toBeNull();
  });

  it("creates a private address once and stores only its hash, hint and encrypted copy", async () => {
    repo.createInboundAddress.mockImplementation(async (_scope, secret) => ({ created: true,
      address: { tokenHash: secret.hash, tokenHint: secret.hint, tokenEncrypted: secret.encrypted, createdAt: new Date(), rotatedAt: null, disabled: false } }));
    const { body } = await request(app).post("/api/inputs/address").expect(201);
    const token = body.email.split("@")[0];
    expect(body.email).toMatch(new RegExp(`^[a-z0-9]{26}@${DOMAIN.replace(/\./g, "\\.")}$`));
    const [target, secret] = repo.createInboundAddress.mock.calls[0];
    expect(target).toMatchObject(scope);
    expect(secret).toMatchObject({ hash: sha256(token), hint: token.slice(-4) });
    expect(secret.encrypted).toMatch(/^enc:v1:/);
    expect(secret.encrypted).not.toContain(token);
    expect(seenPermissions).toEqual(["inbox:write:own"]);
  });

  it("returns the existing address instead of replacing it", async () => {
    repo.createInboundAddress.mockResolvedValue({ created: false,
      address: { tokenEncrypted: encryptWebhookUrl(ADDRESS_TOKEN), tokenHint: "r8tw", createdAt: new Date(), rotatedAt: null, disabled: false } });
    expect((await request(app).post("/api/inputs/address").expect(200)).body.email).toBe(`${ADDRESS_TOKEN}@${DOMAIN}`);
    expect(repo.replaceInboundAddressToken).not.toHaveBeenCalled();
  });

  it("rotates to a new address and 404s when there is none", async () => {
    repo.replaceInboundAddressToken.mockImplementation(async (_scope, secret) => ({ tokenHint: secret.hint, createdAt: new Date(), rotatedAt: new Date(), disabled: false }));
    const { body } = await request(app).post("/api/inputs/address/rotate").expect(200);
    expect(body.email).not.toBe(`${ADDRESS_TOKEN}@${DOMAIN}`);
    expect(repo.replaceInboundAddressToken.mock.calls[0][1].hash).toBe(sha256(body.email.split("@")[0]));
    repo.replaceInboundAddressToken.mockResolvedValue(undefined);
    await request(app).post("/api/inputs/address/rotate").expect(404);
  });

  it("refuses to create addresses when forwarding is unavailable", async () => {
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "");
    expect((await request(app).post("/api/inputs/address").expect(503)).body.code).toBe("inbound_unavailable");
    expect(repo.createInboundAddress).not.toHaveBeenCalled();
  });

  it("turns the address off", async () => {
    repo.disableInboundAddress.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await request(app).delete("/api/inputs/address").expect(200, { disabled: true });
    await request(app).delete("/api/inputs/address").expect(404);
  });

  it("creates a key, returning the token once and storing only its hash", async () => {
    repo.createCaptureToken.mockImplementation(async (_scope, secret, label) => ({ id: "k1", label, tokenHint: secret.hint, createdAt: new Date(), lastUsedAt: null }));
    const { body } = await request(app).post("/api/inputs/capture-tokens").send({ label: " Work laptop " }).expect(201);
    expect(body).toMatchObject({ id: "k1", label: "Work laptop", hint: body.token.slice(-4) });
    expect(body.token).toMatch(/^tsp_cap_[A-Za-z0-9_-]{43}$/);
    expect(repo.createCaptureToken).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(scope), { hash: sha256(body.token), hint: body.token.slice(-4) }, "Work laptop");
    await request(app).post("/api/inputs/capture-tokens").send({}).expect(201);
    expect(repo.createCaptureToken.mock.calls[1][2]).toBe("Browser");
  });

  it("enforces the key limit and label length", async () => {
    repo.createCaptureToken.mockRejectedValue(new TokenLimitError());
    expect((await request(app).post("/api/inputs/capture-tokens").send({}).expect(409)).body.message).toBe("You can have up to 5 active keys. Revoke one first.");
    await request(app).post("/api/inputs/capture-tokens").send({ label: "x".repeat(61) }).expect(400);
  });

  it("revokes a key in the session scope", async () => {
    repo.revokeCaptureToken.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await request(app).delete("/api/inputs/capture-tokens/k1").expect(200, { revoked: true });
    expect(repo.revokeCaptureToken).toHaveBeenCalledWith(expect.objectContaining(scope), "k1");
    await request(app).delete("/api/inputs/capture-tokens/other").expect(404);
  });
});
