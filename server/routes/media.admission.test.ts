import express, { type Request } from "express";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: true, permission: true, lock: vi.fn(), save: vi.fn(), create: vi.fn(),
  remove: vi.fn(), get: vi.fn(), read: vi.fn(), intent: vi.fn() }));
vi.mock("../middlewares/requireDbUser", () => ({ authedOf: () => ({ tenant: { tenantId: "mock", userId: "mock" } }),
  requireDbUser: (_req: unknown, res: express.Response, next: () => void) => m.auth ? next() : res.sendStatus(401) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: unknown, res: express.Response, next: () => void) => m.permission ? next() : res.sendStatus(403) }));
vi.mock("../storage", () => ({ storage: { withMediaLock: m.lock, getMediaAsset: m.get, requestMediaDeletion: m.intent } }));
vi.mock("../services/mediaStorage", () => ({ MEDIA_MAX_BYTES: 50 * 1024 * 1024,
  saveMedia: m.save, deleteMedia: m.remove, readMedia: m.read }));
import { registerMediaRoutes } from "./media";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(register = registerMediaRoutes) {
  const app = express();
  const incoming: Request[] = [];
  app.use((req, _res, next) => { incoming.push(req); vi.spyOn(req, "pipe"); next(); });
  register(app);
  app.get("/other", (_req, res) => res.sendStatus(204));
  return { app, incoming };
}
const upload = (app: express.Express) => request(app).post("/api/media/upload")
  .attach("files", png, "test.png").timeout({ deadline: 5000 });

beforeEach(() => {
  vi.resetAllMocks(); m.auth = true; m.permission = true;
  m.lock.mockImplementation(async (_scope, work) => work({ create: m.create, get: m.get, remove: vi.fn() }));
  m.save.mockResolvedValue({ id: "mock", storageKey: "mock-only" });
  m.create.mockImplementation(async data => data);
  m.remove.mockResolvedValue(undefined); m.intent.mockResolvedValue(undefined);
  m.get.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("real parser / mocked persistence upload admission", () => {
  it.each([401, 403])("checks %s before admission or Multer", async code => {
    const { app, incoming } = fixture();
    m.auth = code !== 401; m.permission = code !== 403;
    for (let i = 0; i < 3; i++) expect((await upload(app)).status).toBe(code);
    incoming.forEach(req => expect(req.pipe).not.toHaveBeenCalled());
    expect(m.lock).not.toHaveBeenCalled();
    m.auth = true; m.permission = true;
    expect((await upload(app)).status).toBe(201);
  });
  it("shares the cap across route registrations; denied bodies never reach Multer; GET/DELETE/other routes remain exempt", async () => {
    const one = fixture(), two = fixture();
    const gate = deferred();
    m.save.mockImplementation(async () => { await gate.promise; return { id: "mock", storageKey: "mock-only" }; });
    const pending = [upload(one.app).then(value => value), upload(two.app).then(value => value)];
    try {
      await vi.waitFor(() => expect(m.save).toHaveBeenCalledTimes(2));
      const denied = await upload(two.app);
      expect(denied.status).toBe(503); expect(denied.headers["retry-after"]).toBe("5");
      expect(two.incoming[1].pipe).not.toHaveBeenCalled();
      expect(two.incoming[1].files).toBeUndefined();
      expect(m.save).toHaveBeenCalledTimes(2);
      expect((await request(two.app).get("/api/media/missing")).status).toBe(404);
      expect((await request(two.app).delete("/api/media/missing")).status).toBe(204);
      expect((await request(two.app).get("/other")).status).toBe(204);
      m.auth = false;
      expect((await upload(two.app)).status).toBe(401);
      m.auth = true; m.permission = false;
      expect((await upload(two.app)).status).toBe(403);
      m.permission = true;
    } finally { gate.resolve(); await Promise.allSettled(pending); }
    expect((await Promise.all(pending)).map(value => value.status)).toEqual([201, 201]);
    expect(one.incoming[0].files).toBeUndefined();
    expect(two.incoming[0].files).toBeUndefined();
    expect((await upload(two.app)).status).toBe(201);
  });
  it.each(["lock", "provider", "db", "cleanup", "signature", "empty", "malformed"])("recovers after repeated %s failures", async failure => {
    const { app, incoming } = fixture();
    if (failure === "lock") m.lock.mockRejectedValue(new Error("mock lock failure"));
    if (failure === "provider") m.save.mockRejectedValue(new Error("mock provider failure"));
    if (failure === "db" || failure === "cleanup") m.create.mockRejectedValue(new Error("mock insert failure"));
    if (failure === "cleanup") m.remove.mockRejectedValue(new Error("mock cleanup failure"));
    for (let i = 0; i < 4; i++) {
      let attempt;
      if (failure === "signature") attempt = request(app).post("/api/media/upload").attach("files", Buffer.from("bad"), "bad.png");
      else if (failure === "empty") attempt = request(app).post("/api/media/upload");
      else if (failure === "malformed") attempt = request(app).post("/api/media/upload").set("Content-Type", "multipart/form-data").send("no boundary");
      else attempt = upload(app);
      expect((await attempt).status).toBe(["signature", "empty", "malformed"].includes(failure) ? 400 : 500);
    }
    incoming.forEach(req => expect(req.files).toBeUndefined());
    m.lock.mockImplementation(async (_scope, work) => work({ create: m.create }));
    m.save.mockResolvedValue({ id: "mock", storageKey: "mock-only" });
    m.create.mockImplementation(async data => data);
    expect((await upload(app)).status).toBe(201);
  });
  it("retains both permits until failed DB insertion compensation settles", async () => {
    const { app } = fixture(); const gate = deferred();
    m.create.mockRejectedValue(new Error("mock DB failure"));
    m.remove.mockImplementation(() => gate.promise);
    const pending = [upload(app).then(value => value), upload(app).then(value => value)];
    try {
      await vi.waitFor(() => expect(m.remove).toHaveBeenCalledTimes(2));
      expect((await upload(app)).status).toBe(503);
    } finally { gate.resolve(); await Promise.allSettled(pending); }
    expect((await Promise.all(pending)).map(value => value.status)).toEqual([500, 500]);
    m.create.mockImplementation(async data => data);
    expect((await upload(app)).status).toBe(201);
  });
  it("aborts incomplete real multipart streams without leaking buffers or permits", async () => {
    const { app, incoming } = fixture();
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      for (let i = 0; i < 4; i++) {
        const client = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/api/media/upload",
          headers: { "Content-Type": "multipart/form-data; boundary=partial" } });
        client.on("error", () => {});
        try {
          client.write('--partial\r\nContent-Disposition: form-data; name="files"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n');
          client.write(Buffer.alloc(64 * 1024)); // no final boundary / no end
          await vi.waitFor(() => expect((incoming[i]?.files as Express.Multer.File[] | undefined)?.length).toBe(1));
          client.destroy();
          await vi.waitFor(() => {
            expect(incoming[i].destroyed).toBe(true);
            expect(incoming[i].files).toBeUndefined();
          });
        } finally { client.destroy(); }
      }
      expect(m.save).not.toHaveBeenCalled();
      expect((await upload(app)).status).toBe(201);
    } finally {
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    }
  });
  it("retains uploaded buffers after connection close until provider work actually settles", async () => {
    const { app, incoming } = fixture(); const gate = deferred();
    m.save.mockImplementation(async () => { await gate.promise; return { id: "mock", storageKey: "mock-only" }; });
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const body = Buffer.concat([Buffer.from('--full\r\nContent-Disposition: form-data; name="files"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n'), png, Buffer.from('\r\n--full--\r\n')]);
    const clients = Array.from({ length: 2 }, () => {
      const client = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/api/media/upload",
        headers: { "Content-Type": "multipart/form-data; boundary=full", "Content-Length": body.length } });
      client.on("error", () => {}); client.end(body); return client;
    });
    try {
      await vi.waitFor(() => expect(m.save).toHaveBeenCalledTimes(2));
      clients.forEach(client => client.destroy());
      await vi.waitFor(() => incoming.slice(0, 2).forEach(req => expect(req.socket.destroyed).toBe(true)));
      incoming.slice(0, 2).forEach(req => expect((req.files as Express.Multer.File[])[0].buffer).toEqual(png));
      expect((await upload(app)).status).toBe(503);
      gate.resolve();
      await vi.waitFor(() => incoming.slice(0, 2).forEach(req => expect(req.files).toBeUndefined()));
      expect((await upload(app)).status).toBe(201);
    } finally {
      gate.resolve(); clients.forEach(client => client.destroy());
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    }
  });
  it("times out an incomplete real parser and makes the permit reusable", async () => {
    vi.stubEnv("MEDIA_UPLOAD_PARSE_TIMEOUT_MS", "1000");
    vi.stubEnv("MEDIA_UPLOAD_MAX_ACTIVE", "1");
    vi.resetModules();
    const { registerMediaRoutes: register } = await import("./media");
    const { app, incoming } = fixture(register);
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const client = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/api/media/upload",
      headers: { "Content-Type": "multipart/form-data; boundary=slow" } });
    client.on("error", () => {});
    client.on("response", response => response.resume());
    try {
      client.write('--slow\r\nContent-Disposition: form-data; name="files"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n');
      client.write(Buffer.alloc(64 * 1024));
      await vi.waitFor(() => expect((incoming[0]?.files as Express.Multer.File[] | undefined)?.length).toBe(1));
      expect((await upload(app)).status).toBe(503);
      await vi.waitFor(() => {
        expect(incoming[0].destroyed).toBe(true);
        expect(incoming[0].files).toBeUndefined();
      }, { timeout: 2500 });
      expect(m.save).not.toHaveBeenCalled();
      expect((await upload(app)).status).toBe(201);
    } finally {
      client.destroy();
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    }
  });
});