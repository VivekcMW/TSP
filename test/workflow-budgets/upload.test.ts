import express from "express";
import request from "supertest";
import { expect, it, vi } from "vitest";
import { memoryProbe, metric, MiB } from "./metrics";

const mocks = vi.hoisted(() => ({ lock: vi.fn(), save: vi.fn(), create: vi.fn() }));
vi.mock("../../server/middlewares/requireDbUser", () => ({ authedOf: () => ({ tenant: { tenantId: "mock-tenant", userId: "mock-user" } }),
  requireDbUser: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../server/middlewares/requirePermission", () => ({ requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../server/storage", () => ({ storage: { withMediaLock: mocks.lock } }));
vi.mock("../../server/services/mediaStorage", () => ({ MEDIA_MAX_BYTES: 50 * 1024 * 1024,
  saveMedia: mocks.save, readMedia: vi.fn(), deleteMedia: vi.fn() }));

it("bounds two concurrently buffered 50 MiB requests and rejects a third before persistence", async () => {
  vi.stubEnv("MAX_FILE_SIZE_MB", "50");
  vi.stubEnv("ALLOWED_MEDIA_TYPES", "image/png");
  const { registerMediaRoutes } = await import("../../server/routes/media");
  const app = express(); registerMediaRoutes(app);
  const memory = memoryProbe();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let notify!: () => void;
  const bothBuffered = new Promise<void>(resolve => { notify = resolve; });
  let bufferedRequests = 0, bytesSaved = 0;
  mocks.lock.mockImplementation(async (_scope, work) => {
    bufferedRequests++; memory.sample();
    if (bufferedRequests === 2) notify();
    // Simulates slow persistence AFTER the real parser has buffered both requests.
    await gate;
    return work({ create: mocks.create });
  });
  mocks.create.mockImplementation(async data => data);
  mocks.save.mockImplementation(async (_scope, bytes: Buffer) => {
    bytesSaved += bytes.length; memory.sample();
    return { id: `mock-${bytesSaved}`, storageKey: "mock-only" };
  });
  // Two files/request avoid Multer's per-file exact-limit rejection; the aggregate
  // is exactly 50 MiB. Real HTTP/parser; auth, locking and persistence are doubles.
  const file = Buffer.alloc(25 * MiB, 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(file);
  const requests = Array.from({ length: 2 }, () => request(app).post("/api/media/upload")
    .attach("files", file, { filename: "first.png", contentType: "image/png" })
    .attach("files", file, { filename: "second.png", contentType: "image/png" })
    .timeout({ deadline: 15_000 }).then(response => response));
  const outcomes = Promise.allSettled(requests);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([bothBuffered, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Two uploads did not reach persistence")), 10_000);
    })]);
    memory.sample();
    expect(bufferedRequests).toBe(2);
    expect(mocks.save).not.toHaveBeenCalled();
    const denied = await request(app).post("/api/media/upload")
      .attach("files", file.subarray(0, 8), { filename: "denied.png", contentType: "image/png" });
    expect(denied.status).toBe(503);
    expect(denied.headers["retry-after"]).toBe("5");
    expect(bufferedRequests).toBe(2);
    release();
    const results = await outcomes;
    expect(results.map(value => value.status === "fulfilled" ? value.value.status : "rejected")).toEqual([201, 201]);
    expect(mocks.save).toHaveBeenCalledTimes(4);
    expect(bytesSaved).toBe(100 * MiB);
    const measured = memory.result();
    // Includes the 25 MiB client fixture, HTTP chunks and Buffer.concat copies.
    // Sampled peaks can miss brief spikes; GC/RSS behavior is platform-dependent.
    expect(measured.deltaMiB.external).toBeLessThan(512);
    expect(measured.deltaMiB.rss).toBeLessThan(768);
    metric("upload-concurrent-buffers", { acceptedRequests: bufferedRequests, requestPayloadMiB: 50,
      savedBytes: bytesSaved, storageCalls: mocks.save.mock.calls.length, aggregateConcurrentCap: 2,
      aggregateReservedMiB: 100, deniedRequests: 1,
      clientFixtureIncludedMiB: 25, memory: measured, thresholdsMiB: { external: 512, rss: 768 } });
  } finally {
    if (timer) clearTimeout(timer);
    release(); await outcomes; vi.unstubAllEnvs();
  }
}, 20_000);