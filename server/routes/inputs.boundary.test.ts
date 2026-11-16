import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real server/index.ts middleware chain, without .env, routes, DB or workers (as in index.safeguards.test.ts).
vi.mock("dotenv/config", () => ({}));
vi.mock("../db", () => ({ pool: { end: vi.fn(), query: vi.fn() } }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../routes", () => ({ registerRoutes: vi.fn() }));
vi.mock("../static", () => ({ serveStatic: vi.fn() }));
vi.mock("../swagger", () => ({ setupSwagger: vi.fn() }));
vi.mock("../authentication", () => ({ auth: { handler: vi.fn() } }));
vi.mock("../jobs/queue", () => ({ initializeQueues: vi.fn(), getQueueHealth: vi.fn() }));
vi.mock("../jobs", () => ({ registerJobHandlers: vi.fn(), closeJobHandlers: vi.fn() }));
vi.mock("../jobs/scheduler", () => ({ initializeScheduler: vi.fn(), stopScheduler: vi.fn() }));
vi.mock("../services/email", () => ({ closeEmailQueue: vi.fn(), initializeEmailQueue: vi.fn(), registerEmailWorker: vi.fn() }));
import { app } from "../index";

const SECRET = "inbound-webhook-secret-for-tests-0123456789";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("server boundary for external inputs", () => {
  it("lets any origin preflight /api/capture without credentials", async () => {
    const response = await request(app).options("/api/capture").set("Origin", "https://any-news-site.com")
      .set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", "authorization,content-type").expect(204);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("keeps the credentialed origin allowlist for every other API route", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const foreign = await request(app).options("/api/inputs").set("Origin", "https://any-news-site.com").set("Access-Control-Request-Method", "POST");
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
    const local = await request(app).options("/api/inputs").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "POST").expect(204);
    expect(local.headers).toMatchObject({ "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true" });
  });

  it("checks the inbound secret before parsing, then accepts bodies above the default JSON limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = { OriginalRecipient: "x@in.site.com", HtmlBody: "<p>news</p>".repeat(30_000) };
    await request(app).post("/api/inbound/email").send(body).expect(503);
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "in.site.com");
    vi.stubEnv("INBOUND_EMAIL_SECRET", SECRET);
    await request(app).post("/api/inbound/email").set("X-Inbound-Secret", "wrong").send(body).expect(401);
    // Routes are mocked out here: reaching the end of the chain (404), not a 413, proves the body was accepted.
    await request(app).post("/api/inbound/email").set("X-Inbound-Secret", SECRET).send(body).expect(404);
    await request(app).post("/api/notes").set("Content-Type", "application/json").send(JSON.stringify(body)).expect(413);
  });
});
