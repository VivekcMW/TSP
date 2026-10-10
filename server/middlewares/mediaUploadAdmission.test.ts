import { EventEmitter } from "node:events";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import multer from "multer";
import { createMediaUploadAdmission, mediaUploadLimits, UPLOAD_RESERVATION_BYTES as bytes } from "./mediaUploadAdmission";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function httpPair() {
  const req = Object.assign(new EventEmitter(), { complete: false, destroyed: false, aborted: false,
    destroy: vi.fn(() => { req.destroyed = true; req.aborted = true; req.emit("aborted"); req.emit("close"); return req; }) });
  const res = Object.assign(new EventEmitter(), { destroyed: false, headersSent: false, writableFinished: false,
    set: vi.fn().mockReturnThis(), setHeader: vi.fn(), status: vi.fn().mockReturnThis(),
    json: vi.fn(() => { res.headersSent = true; res.writableFinished = true; res.emit("finish"); return res; }) });
  return { req, res, invoke: (handler: RequestHandler, next = vi.fn()) => {
    handler(req as unknown as Request, res as unknown as Response, next);
    return next;
  } };
}
afterEach(() => vi.useRealTimers());

describe("media upload configuration", () => {
  it("defaults to two full batch reservations, independent of content length", () => {
    expect(mediaUploadLimits({})).toEqual({ maxActive: 2, maxBytes: 2 * bytes, parseTimeoutMs: 30_000 });
  });
  it("accepts bounded configuration with independent count and byte ceilings", () => {
    expect(mediaUploadLimits({ MEDIA_UPLOAD_MAX_ACTIVE: "8", MEDIA_UPLOAD_MAX_BYTES: String(bytes), MEDIA_UPLOAD_PARSE_TIMEOUT_MS: "1000" }))
      .toEqual({ maxActive: 8, maxBytes: bytes, parseTimeoutMs: 1000 });
  });
  it.each([
    ["MEDIA_UPLOAD_MAX_ACTIVE", "0"], ["MEDIA_UPLOAD_MAX_ACTIVE", "9"], ["MEDIA_UPLOAD_MAX_ACTIVE", "1.5"],
    ["MEDIA_UPLOAD_MAX_ACTIVE", "NaN"], ["MEDIA_UPLOAD_MAX_ACTIVE", ""], ["MEDIA_UPLOAD_MAX_ACTIVE", "Infinity"],
    ["MEDIA_UPLOAD_MAX_BYTES", "0"], ["MEDIA_UPLOAD_MAX_BYTES", String(bytes - 1)],
    ["MEDIA_UPLOAD_MAX_BYTES", String(bytes * 8 + 1)], ["MEDIA_UPLOAD_MAX_BYTES", "nonsense"],
    ["MEDIA_UPLOAD_PARSE_TIMEOUT_MS", "999"], ["MEDIA_UPLOAD_PARSE_TIMEOUT_MS", "120001"],
  ])("fails closed for %s=%s", (name, value) => { expect(() => mediaUploadLimits({ [name]: value })).toThrow(`Invalid ${name}`); });
});

describe("pre-parser upload lifecycle", () => {
  it("denies before parsing, ignores claimed body sizes, and recovers after awaited work", async () => {
    const admission = createMediaUploadAdmission(mediaUploadLimits({}));
    const gate = deferred();
    const parse = vi.fn((_req, _res, next: NextFunction) => next());
    const handle = vi.fn(() => gate.promise);
    const discard = vi.fn();
    const handler = admission.wrap(parse, handle, discard);
    const first = httpPair(), second = httpPair();
    first.invoke(handler); second.invoke(handler); await flush();
    for (let i = 0; i < 100; i++) {
      const denied = httpPair();
      Object.assign(denied.req, { headers: { "content-length": "1" } });
      denied.invoke(handler);
      expect(denied.res.status).toHaveBeenCalledWith(503);
      expect(denied.res.set).toHaveBeenCalledWith({ "Retry-After": "5", "Cache-Control": "no-store" });
    }
    expect(parse).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledTimes(2);
    expect(admission.snapshot()).toEqual({ active: 2, reservedBytes: 2 * bytes });
    gate.resolve(); await flush();
    expect(discard).toHaveBeenCalledTimes(2);
    expect(admission.snapshot()).toEqual({ active: 0, reservedBytes: 0 });
    httpPair().invoke(handler); await flush();
    expect(parse).toHaveBeenCalledTimes(3);
  });
  it.each(["aborted", "error", "close", "response-close", "finish"])("holds buffers through %s during async processing", async event => {
    vi.useFakeTimers();
    const admission = createMediaUploadAdmission(mediaUploadLimits({ MEDIA_UPLOAD_MAX_ACTIVE: "1" }));
    const gate = deferred();
    const discard = vi.fn();
    const handler = admission.wrap((_req, _res, next) => next(), () => gate.promise, discard);
    const pair = httpPair(); pair.invoke(handler); await flush();
    if (event === "response-close") pair.res.emit("close");
    else if (event === "finish") pair.res.emit("finish");
    else pair.req.emit(event, new Error("disconnected"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(admission.snapshot().active).toBe(1);
    expect(discard).not.toHaveBeenCalled();
    expect(pair.req.destroy).not.toHaveBeenCalled();
    const denied = httpPair(); denied.invoke(handler);
    expect(denied.res.status).toHaveBeenCalledWith(503);
    gate.resolve(); await flush();
    expect(admission.snapshot()).toEqual({ active: 0, reservedBytes: 0 });
    expect(discard).toHaveBeenCalledTimes(1);
    expect(pair.req.listenerCount("aborted")).toBe(0);
    expect(pair.req.listenerCount("error")).toBe(0);
    expect(pair.req.listenerCount("close")).toBe(0);
    expect(pair.res.listenerCount("close")).toBe(0);
  });
  it.each(["aborted", "error", "close", "response-close", "timeout"])("stops parsing on %s but waits for parser cleanup", async event => {
    vi.useFakeTimers();
    const admission = createMediaUploadAdmission(mediaUploadLimits({}));
    let parsed!: NextFunction;
    const work = vi.fn();
    const discard = vi.fn();
    const pair = httpPair();
    pair.invoke(admission.wrap((_req, _res, next) => { parsed = next; }, work, discard));
    if (event === "timeout") await vi.advanceTimersByTimeAsync(30_000);
    else if (event === "response-close") pair.res.emit("close");
    else pair.req.emit(event, new Error("disconnected"));
    expect(pair.req.destroy).toHaveBeenCalledTimes(1);
    expect(admission.snapshot().active).toBe(1);
    expect(discard).not.toHaveBeenCalled();
    parsed(new Error("parser aborted")); parsed(); await flush();
    expect(work).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledTimes(1);
    expect(admission.snapshot()).toEqual({ active: 0, reservedBytes: 0 });
    expect(vi.getTimerCount()).toBe(0);
    if (event === "timeout") expect(pair.res.status).toHaveBeenCalledWith(408);
  });
  it("does not treat normal request close as cancellation", async () => {
    const admission = createMediaUploadAdmission(mediaUploadLimits({}));
    let parsed!: NextFunction;
    const work = vi.fn().mockResolvedValue(undefined);
    const pair = httpPair();
    pair.invoke(admission.wrap((_req, _res, next) => { parsed = next; }, work, vi.fn()));
    pair.req.complete = true; pair.req.emit("close");
    expect(pair.req.destroy).not.toHaveBeenCalled();
    parsed(); await flush();
    expect(work).toHaveBeenCalledTimes(1);
    expect(admission.snapshot().active).toBe(0);
  });
  it.each(["sync-parse", "async-parse", "size", "handler", "discard"])("releases after %s failure without a leak", async mode => {
    const admission = createMediaUploadAdmission(mediaUploadLimits({}));
    const error = new Error("mock failure");
    const parse: RequestHandler = (_req, _res, next) => {
      if (mode === "sync-parse") throw error;
      if (mode === "async-parse") return queueMicrotask(() => next(error));
      next(mode === "size" ? new multer.MulterError("LIMIT_FILE_SIZE") : undefined);
    };
    const handle = vi.fn(async () => { if (mode === "handler") throw error; });
    const discard = vi.fn(() => { if (mode === "discard") throw error; });
    const pair = httpPair(); const next = pair.invoke(admission.wrap(parse, handle, discard));
    await flush();
    expect(admission.snapshot()).toEqual({ active: 0, reservedBytes: 0 });
    expect(discard).toHaveBeenCalledTimes(1);
    if (mode === "handler" || mode === "discard") expect(next).toHaveBeenCalledWith(error);
    else {
      expect(pair.res.status).toHaveBeenCalledWith(mode === "size" ? 413 : 400);
      expect(handle).not.toHaveBeenCalled();
    }
  });
  it("cleans up an already-aborted request without invoking the parser", async () => {
    const admission = createMediaUploadAdmission(mediaUploadLimits({}));
    const parse = vi.fn(); const discard = vi.fn();
    const pair = httpPair(); pair.req.destroyed = true;
    pair.invoke(admission.wrap(parse, vi.fn(), discard)); await flush();
    expect(parse).not.toHaveBeenCalled(); expect(discard).toHaveBeenCalledTimes(1);
    expect(admission.snapshot().active).toBe(0);
  });
});