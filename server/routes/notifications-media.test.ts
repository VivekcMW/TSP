import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardNotificationsMediaNetwork } from "../../test/notifications-media-network";
const m = vi.hoisted(() => ({ auth: true, permission: true, scope: { tenantId: "tenant", userId: "user" },
  prefs: vi.fn(), update: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn(), intent: vi.fn(), save: vi.fn(), read: vi.fn(), delete: vi.fn(), lock: vi.fn() }));
vi.mock("../middlewares/requireDbUser", () => ({ authedOf: () => ({ tenant: m.scope, dbUser: { id: m.scope.userId } }), requireDbUser: (_req: unknown, res: express.Response, next: () => void) => m.auth ? next() : res.sendStatus(401) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: unknown, res: express.Response, next: () => void) => m.permission ? next() : res.sendStatus(403) }));
vi.mock("../services/email/preferences", () => ({ getEmailPreferences: m.prefs, updateEmailPreferences: m.update }));
vi.mock("../storage", () => ({ storage: { getMediaAsset: m.get, requestMediaDeletion: m.intent, withMediaLock: m.lock } }));
vi.mock("../services/mediaStorage", () => ({ saveMedia: m.save, readMedia: m.read, deleteMedia: m.delete, MEDIA_MAX_BYTES: 50 * 1024 * 1024 }));
import { registerEmailPreferenceRoutes } from "./email-preferences";
import { registerMediaRoutes } from "./media";
guardNotificationsMediaNetwork();
const app = express(); app.use(express.json()); registerEmailPreferenceRoutes(app); registerMediaRoutes(app);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
beforeEach(() => {
  vi.clearAllMocks(); m.auth = true; m.permission = true;
  m.lock.mockImplementation(async (_scope, work) => work({ create: m.create, get: (id: string) => m.get(m.scope, id), remove: m.remove }));
  m.save.mockResolvedValue({ id: "asset", storageKey: "owned-key", storageBackend: "s3", storageLocation: { bucket: "private" } });
  m.create.mockImplementation(async data => data); m.delete.mockResolvedValue(undefined); m.intent.mockResolvedValue(undefined);
  m.get.mockResolvedValue({ id: "asset", contentType: "image/png", storageKey: "owned-key", deletionRequestedAt: null });
  m.read.mockResolvedValue(png); m.prefs.mockResolvedValue({ dailyDigest: false }); m.update.mockImplementation(async (_id, data) => data);
});
describe("preference and media HTTP boundaries", () => {
  it.each([401, 403])("enforces auth/permission before upload and reads (%i)", async code => {
    m.auth = code !== 401; m.permission = code !== 403;
    expect((await request(app).get("/api/email-preferences")).status).toBe(code);
    expect((await request(app).get("/api/media/asset")).status).toBe(code);
    expect((await request(app).post("/api/media/upload").attach("files", png, "x.png")).status).toBe(code);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("validates preferences and uses only authenticated identity", async () => {
    expect((await request(app).patch("/api/email-preferences").send({ userId: "other", marketing: false })).status).toBe(400);
    expect((await request(app).patch("/api/email-preferences").send({ marketing: false })).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith("user", { marketing: false });
    expect((await request(app).get("/api/email-preferences")).headers["cache-control"]).toBe("no-store");
  });
  it("foreign and deletion-pending assets never reach storage adapter", async () => {
    m.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ deletionRequestedAt: new Date() });
    expect((await request(app).get("/api/media/foreign")).status).toBe(404);
    expect((await request(app).get("/api/media/pending")).status).toBe(404);
    expect(m.get).toHaveBeenCalledWith(m.scope, "foreign");
    expect(m.read).not.toHaveBeenCalled();
  });
  it("serves a private authenticated proxy, not a public URL", async () => {
    const response = await request(app).get("/api/media/asset");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers.location).toBeUndefined();
  });
  it("checks signatures before uploading", async () => {
    const response = await request(app).post("/api/media/upload").attach("files", Buffer.from("fake png"), { filename: "a.png", contentType: "image/png" });
    expect(response.status).toBe(400); expect(m.save).not.toHaveBeenCalled();
  });
  it("rejects too many files before uploading", async () => {
    let req = request(app).post("/api/media/upload");
    for (let i = 0; i < 9; i++) req = req.attach("files", png, "x.png");
    expect((await req).status).toBe(400); expect(m.save).not.toHaveBeenCalled();
  });
  it("accepts eight small files within the aggregate limit", async () => {
    let req = request(app).post("/api/media/upload");
    for (let i = 0; i < 8; i++) req = req.attach("files", png, "x.png");
    expect((await req).status).toBe(201); expect(m.save).toHaveBeenCalledTimes(8);
  });
  it("rejects aggregate size over 50 MiB during parsing before any object upload", async () => {
    const file = Buffer.alloc(26 * 1024 * 1024); png.copy(file);
    const response = await request(app).post("/api/media/upload").attach("files", file, "first.png").attach("files", file, "second.png");
    expect(response.status).toBe(413); expect(m.save).not.toHaveBeenCalled();
  });
  it("compensates object upload on failed DB insertion", async () => {
    m.create.mockRejectedValue(new Error("DB insert failed"));
    expect((await request(app).post("/api/media/upload").attach("files", png, "x.png")).status).toBe(500);
    expect(m.delete).toHaveBeenCalledWith("owned-key");
  });
  it("returns no backend locator or credentials to upload callers", async () => {
    const response = await request(app).post("/api/media/upload").attach("files", png, "x.png");
    expect(response.status).toBe(201);
    expect(response.body.assets[0]).toEqual({ id: "asset", type: "image", name: "x.png", url: "/api/media/asset", sizeBytes: 8 });
  });
  it("commits delete intent before object removal and safely retries failures", async () => {
    m.delete.mockRejectedValueOnce(new Error("provider secret"));
    expect((await request(app).delete("/api/media/asset")).status).toBe(503);
    expect(m.remove).not.toHaveBeenCalled();
    expect((await request(app).delete("/api/media/asset")).status).toBe(204);
    expect(m.intent).toHaveBeenCalledWith(m.scope, "asset");
    m.get.mockResolvedValue(undefined);
    expect((await request(app).delete("/api/media/asset")).status).toBe(204);
  });
});