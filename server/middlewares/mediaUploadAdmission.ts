import type { Request, RequestHandler, Response } from "express";
import multer from "multer";
import { createBoundedPermitPool } from "../lib/boundedPermit";

export const UPLOAD_RESERVATION_BYTES = 50 * 1024 * 1024;
export const UPLOAD_RETRY_AFTER_SECONDS = 5;

export function mediaUploadLimits(env: Record<string, string | undefined>) {
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`Invalid ${name}`);
    }
    return value;
  };
  return {
    maxActive: integer("MEDIA_UPLOAD_MAX_ACTIVE", 2, 1, 8),
    maxBytes: integer("MEDIA_UPLOAD_MAX_BYTES", 2 * UPLOAD_RESERVATION_BYTES, UPLOAD_RESERVATION_BYTES, 8 * UPLOAD_RESERVATION_BYTES),
    parseTimeoutMs: integer("MEDIA_UPLOAD_PARSE_TIMEOUT_MS", 30_000, 1000, 120_000),
  };
}

/** Mount ONLY on the upload POST, after authentication and authorization. */
export function createMediaUploadAdmission(limits: ReturnType<typeof mediaUploadLimits>) {
  const pool = createBoundedPermitPool(limits.maxActive, limits.maxBytes);
  return {
    snapshot: pool.snapshot,
    wrap(parse: RequestHandler, handle: (req: Request, res: Response) => Promise<unknown>, discard: (req: Request) => void): RequestHandler {
      return boundedUploadHandler(pool, limits.parseTimeoutMs, parse, handle, discard);
    },
  };
}

function parseUpload(parse: RequestHandler, req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    parse(req, res, error => error ? reject(error) : resolve());
  });
}

function boundedUploadHandler(
  pool: ReturnType<typeof createBoundedPermitPool>, parseTimeoutMs: number, parse: RequestHandler,
  handle: (req: Request, res: Response) => Promise<unknown>, discard: (req: Request) => void,
): RequestHandler {
  return (req, res, next) => {
    const release = pool.tryAcquire(UPLOAD_RESERVATION_BYTES);
    if (!release) {
      res.set({ "Retry-After": String(UPLOAD_RETRY_AFTER_SECONDS), "Cache-Control": "no-store" });
      res.status(503).json({ message: "Media uploads are busy. Retry after at least 5 seconds; capacity is not guaranteed." });
      return;
    }
    let parsing = true;
    let disconnected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      disconnected = true;
      // Destroy stops input; Multer settles its callback after abort cleanup.
      // Never release here: a callback/provider may still own buffers.
      if (parsing && !req.destroyed) req.destroy();
    };
    const requestClose = () => { if (!req.complete) abort(); };
    const responseClose = () => { if (!res.writableFinished) abort(); };
    req.on("aborted", abort);
    req.on("error", abort);
    req.on("close", requestClose);
    res.on("close", responseClose);
    const run = async () => {
      try {
        if (req.destroyed || res.destroyed) return;
        timer = setTimeout(() => {
          if (!res.headersSent && !res.destroyed) {
            res.setHeader("Connection", "close");
            res.status(408).json({ message: "Media upload parsing timed out" });
          }
          abort();
        }, parseTimeoutMs);
        timer.unref();
        await parseUpload(parse, req, res);
        clearTimeout(timer);
        parsing = false;
        if (!disconnected && !res.destroyed) await handle(req, res);
      } catch (error) {
        if (disconnected || res.destroyed) return;
        if (!parsing) throw error;
        res.status(error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
          .json({ message: "Invalid upload type, size or count" });
      } finally {
        clearTimeout(timer);
        req.off("aborted", abort);
        req.off("error", abort);
        req.off("close", requestClose);
        res.off("close", responseClose);
        try { discard(req); }
        finally { release(); }
      }
    };
    void run().catch(next);
  };
}