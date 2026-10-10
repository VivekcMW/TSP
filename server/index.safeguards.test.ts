import express, { type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const { authHandler } = vi.hoisted(() => ({ authHandler: vi.fn() }));
// Import the real boundary without ever loading .env, routes, DB or workers.
vi.mock("dotenv/config", () => ({}));
vi.mock("./db", () => ({ pool: { end: vi.fn(), query: vi.fn() } }));
vi.mock("./lib/redis", () => ({ redis: undefined }));
vi.mock("./routes", () => ({ registerRoutes: vi.fn() }));
vi.mock("./static", () => ({ serveStatic: vi.fn() }));
vi.mock("./swagger", () => ({ setupSwagger: vi.fn() }));
vi.mock("./authentication", () => ({ auth: { handler: authHandler } }));
vi.mock("./jobs/queue", () => ({ initializeQueues: vi.fn(), getQueueHealth: vi.fn() }));
vi.mock("./jobs", () => ({ registerJobHandlers: vi.fn(), closeJobHandlers: vi.fn() }));
vi.mock("./jobs/scheduler", () => ({ initializeScheduler: vi.fn(), stopScheduler: vi.fn() }));
vi.mock("./services/email", () => ({ closeEmailQueue: vi.fn(), initializeEmailQueue: vi.fn(), registerEmailWorker: vi.fn() }));
import { app, errorHandler, createGracefulShutdown, shutdownTimeout } from "./index";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Express error safeguards", () => {
  describe.each(["status", "statusCode"])("error.%s", (field) => {
    const cases: Array<[unknown, number, string]> = [
      [400, 400, "Bad Request"],
      [401, 401, "Unauthorized"],
      [499, 499, "Request failed"],
      [500, 500, "Internal Server Error"],
      [503, 503, "Internal Server Error"],
      [599, 599, "Internal Server Error"],
      ...[-1, 0, 99, 100, 200, 300, 399, 600, 999, 1000,
        399.5, 400.5, 599.5, NaN, Infinity, -Infinity,
        "400", "500", "bad", "", true, false, null, undefined, {}, []]
        .map((value): [unknown, number, string] => [value, 500, "Internal Server Error"]),
    ];
    it.each(cases)("sanitizes %s to HTTP %s (%s)", async (value, expectedStatus, message) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const testApp = express();
      testApp.get("/fail", () => { throw Object.assign(new Error("SECRET_DB_PASSWORD"), { [field]: value }); });
      testApp.get("/ok", (_req, res) => { res.json({ ok: true }); });
      testApp.use(errorHandler);
      const failed = await request(testApp).get("/fail");
      expect(failed.status).toBe(expectedStatus);
      expect(failed.body).toEqual({ message });
      expect(failed.text).not.toContain("SECRET_DB_PASSWORD");
      expect(log).toHaveBeenCalledExactlyOnceWith(`[express] Request failed (${expectedStatus})`);
      expect((await request(testApp).get("/ok")).status).toBe(200);
    });
  });
  it.each([
    [undefined, 401, 401, "Unauthorized"],
    [null, 400, 400, "Bad Request"],
    [400, 503, 400, "Bad Request"],
    [999, 401, 500, "Internal Server Error"],
  ])("validates status=%s with statusCode=%s", (status, statusCode, expectedStatus, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    errorHandler({ status, statusCode, message: "SECRET" }, {} as Request, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledExactlyOnceWith(expectedStatus);
    expect(res.json).toHaveBeenCalledExactlyOnceWith({ message });
    expect(next).not.toHaveBeenCalled();
  });
  it("delegates a sanitized error if response headers were already sent", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const next = vi.fn();
    const res = { headersSent: true, status: vi.fn() };
    errorHandler(new Error("SECRET"), {} as Request, res as unknown as Response, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].message).toBe("Request failed");
  });
  it("catches rejection from the actual Node auth adapter in Express 4", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    authHandler.mockRejectedValueOnce(new Error("AUTH_SECRET"));
    app.use(errorHandler);
    const res = await request(app).get("/api/auth/ok");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal Server Error" });
    authHandler.mockResolvedValueOnce(Response.json({ ok: true }));
    expect((await request(app).get("/api/auth/ok")).status).toBe(200);
  });
});

function resources() {
  return {
    drainHttp: vi.fn(async () => {}), stopScheduler: vi.fn(async () => {}),
    closeJobs: vi.fn(async () => {}), closeEmail: vi.fn(async () => {}),
    closePool: vi.fn(async () => {}), closeRedis: vi.fn(async () => {}),
    forceClose: vi.fn(), exit: vi.fn(),
  };
}

describe("graceful shutdown", () => {
  it("drains producers before queues before DB/Redis, and closes only once", async () => {
    const deps = resources();
    const shutdown = createGracefulShutdown(deps, 30_000);
    const first = shutdown();
    expect(shutdown()).toBe(first);
    await first;
    for (const fn of Object.values(deps)) expect(fn).toHaveBeenCalledTimes(1);
    expect(deps.drainHttp.mock.invocationCallOrder[0]).toBeLessThan(deps.closeJobs.mock.invocationCallOrder[0]);
    expect(deps.closeJobs.mock.invocationCallOrder[0]).toBeLessThan(deps.closePool.mock.invocationCallOrder[0]);
    expect(deps.closeRedis.mock.invocationCallOrder[0]).toBeLessThan(deps.exit.mock.invocationCallOrder[0]);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
  it("awaits active HTTP requests and jobs before closing their dependencies", async () => {
    let drain!: () => void;
    let jobs!: () => void;
    const deps = resources();
    deps.drainHttp.mockImplementation(() => new Promise<void>((resolve) => { drain = resolve; }));
    deps.closeJobs.mockImplementation(() => new Promise<void>((resolve) => { jobs = resolve; }));
    const done = createGracefulShutdown(deps, 30_000)();
    expect(deps.closeJobs).not.toHaveBeenCalled();
    drain();
    await vi.waitFor(() => expect(deps.closeJobs).toHaveBeenCalled());
    expect(deps.closePool).not.toHaveBeenCalled();
    jobs(); await done;
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
  it("attempts every cleanup even on synchronous throws and async rejections", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = resources();
    deps.stopScheduler.mockImplementation(() => { throw new Error("SECRET"); });
    deps.closeJobs.mockRejectedValue(new Error("SECRET"));
    deps.closeRedis.mockRejectedValue(new Error("SECRET"));
    await createGracefulShutdown(deps, 30_000)();
    for (const fn of Object.values(deps)) expect(fn).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });
  it("bounds hung stages, attempts later resources and catches late rejections", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = resources();
    let rejectLate!: (error: Error) => void;
    deps.stopScheduler.mockImplementation(() => new Promise<void>((_, reject) => { rejectLate = reject; }));
    deps.closeJobs.mockImplementation(() => new Promise<void>(() => {}));
    deps.closeRedis.mockImplementation(() => new Promise<void>(() => {}));
    const done = createGracefulShutdown(deps, 3000)();
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    for (const fn of Object.values(deps)) expect(fn).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
    rejectLate(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(1);
  });
  it("keeps failure exit status when duplicate signals arrive", async () => {
    const deps = resources();
    const shutdown = createGracefulShutdown(deps, 3000);
    const done = shutdown(1); shutdown(0); await done;
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
  it("uses a bounded configurable deadline", () => {
    vi.stubEnv("SHUTDOWN_TIMEOUT_MS", undefined);
    expect(shutdownTimeout()).toBe(30_000);
    expect(shutdownTimeout("5000")).toBe(5000);
    for (const value of ["", "0", "NaN", "Infinity", "999", "300001", "1000.5"]) {
      expect(() => shutdownTimeout(value)).toThrow("SHUTDOWN_TIMEOUT_MS");
    }
  });
});