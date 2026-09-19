import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyEditorialVoice } from "@shared/editorial-voice";
const { get, mutate } = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn() }));
vi.mock("../repositories/editorialVoice", () => ({ editorialVoiceRepository: { get, mutate }, VoiceConflict: class extends Error {}, VoiceNotFound: class extends Error {} }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (req: express.Request, res: express.Response, next: express.NextFunction) => req.headers.authorization === "test" ? next() : res.sendStatus(401),
  authedOf: () => ({ tenant: { tenantId: "tenant-a", userId: "user-a" } }),
}));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (req: express.Request, res: express.Response, next: express.NextFunction) => req.headers["x-deny"] ? res.sendStatus(403) : next() }));
import { registerEditorialVoiceRoutes } from "./editorial-voice";
import { VoiceConflict, VoiceNotFound } from "../repositories/editorialVoice";
const app = express(); app.use(express.json()); registerEditorialVoiceRoutes(app);
const body = { action: "add", revision: 0, text: "A sample explicitly approved by its author.", origin: "approved-edit", consent: true };
beforeEach(() => { get.mockReset().mockResolvedValue(emptyEditorialVoice()); mutate.mockReset().mockResolvedValue({ ...emptyEditorialVoice(), revision: 1 }); });
describe("editorial voice authenticated routes", () => {
  it("requires authentication and own-profile permission for reads and writes", async () => {
    expect((await request(app).get("/api/editorial/voice")).status).toBe(401);
    expect((await request(app).patch("/api/editorial/voice").send(body)).status).toBe(401);
    expect((await request(app).patch("/api/editorial/voice").set("authorization", "test").set("x-deny", "1").send(body)).status).toBe(403);
    expect(get).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  });
  it("returns off-by-default scoped data without caching", async () => {
    const result = await request(app).get("/api/editorial/voice?tenantId=evil").set("authorization", "test");
    expect(result.status).toBe(200); expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.enabled).toBe(false);
    expect(get).toHaveBeenCalledWith({ tenantId: "tenant-a", userId: "user-a" });
  });
  it.each([{ ...body, consent: undefined }, { ...body, consent: false }, { ...body, text: {} }, { ...body, text: "x".repeat(1001) }, { ...body, userId: "evil" }, { action: "enable", revision: 0, enabled: true }])("rejects malformed/implicit-retention/scope input %#", async value => {
    const result = await request(app).patch("/api/editorial/voice").set("authorization", "test").send(value);
    expect(result.status).toBe(400); expect(mutate).not.toHaveBeenCalled();
  });
  it("passes only validated explicit changes with authenticated scope", async () => {
    const result = await request(app).patch("/api/editorial/voice").set("authorization", "test").send(body);
    expect(result.status).toBe(200);
    expect(mutate).toHaveBeenCalledWith({ tenantId: "tenant-a", userId: "user-a" }, body);
  });
  it.each([[new VoiceConflict("Reload"), 409], [new VoiceNotFound("Missing"), 404], [new Error("private DB detail"), 503]])("maps safe failures %#", async (error, status) => {
    mutate.mockRejectedValue(error);
    const result = await request(app).patch("/api/editorial/voice").set("authorization", "test").send(body);
    expect(result.status).toBe(status); expect(JSON.stringify(result.body)).not.toContain("private DB detail");
  });
});