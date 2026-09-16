import type { Express, Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../lib/redis";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { instantReviewRateLimit } from "../middlewares/rateLimit";
import { getEditorialJobs, EditorialQueueUnavailableError } from "../jobs/editorial";
import { prepareEditorialRequest, executeEditorialRequest } from "../services/editorial-request";
import { getAIErrorResponse } from "../services/openRouter";
import { CrawlError } from "../services/crawlerFetch";
import { editorialCancellation } from "./editorial-context";

const statusRedis = redis;
const operationLimit = (operation: string, limit: number) => rateLimit({ windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => { const scope = authedOf(req).tenant; return JSON.stringify([scope.tenantId, scope.userId]); },
  store: statusRedis ? new RedisStore({ prefix: `rl:editorial-${operation}:`, sendCommand: (...args: string[]) => statusRedis.call(args[0], ...args.slice(1)) as Promise<any> }) : undefined,
});
const statusLimit = operationLimit("status", 180);
const cancelLimit = operationLimit("cancel", 60);

function admissionError(res: Response, error: unknown) {
  if (error instanceof EditorialQueueUnavailableError) return res.status(503).json({ code: "editorial_queue_unavailable", message: error.message });
  if (error instanceof Error && "status" in error && error.status === 403) return res.status(403).json({ message: "An attached media item is not available to this account" });
  if (error instanceof CrawlError) return res.status(422).json({ code: "source_unreadable", message: "Source could not be read. Try another public URL or use Write article." });
  const failure = getAIErrorResponse(error);
  if (failure.retryAfterSeconds) res.setHeader("Retry-After", String(failure.retryAfterSeconds));
  return res.status(failure.status).json(failure.body);
}

export function registerEditorialJobsRoutes(app: Express) {
  const guards = [requireDbUser, requirePermission("generation:create:own")];
  app.post(["/api/editorial/jobs/:kind", "/api/instant-review/selected", "/api/instant-review/manual"], (req, _res, next) => {
    // Non-opt-in callers continue to the unchanged direct HTTP routes.
    if (req.path.startsWith("/api/instant-review/") && req.get("Prefer") !== "respond-async") return next("route");
    next();
  }, ...guards, instantReviewRateLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const kind = req.params.kind ?? req.path.split("/").at(-1);
    if (kind !== "selected" && kind !== "manual") return res.status(400).json({ message: "Unsupported editorial request" });
    if (!z.string().uuid().safeParse(req.body?.requestIntent).success) return res.status(400).json({ message: "A valid requestIntent UUID is required" });
    const cancellation = editorialCancellation(req, res);
    try {
      const jobs = getEditorialJobs();
      if (!jobs && (redis || process.env.NODE_ENV === "production")) throw new EditorialQueueUnavailableError();
      const prepared = await prepareEditorialRequest(req, kind, cancellation.signal);
      if (!jobs) return res.json(await executeEditorialRequest(prepared, cancellation.signal));
      const jobId = await jobs.enqueue(authedOf(req).tenant, prepared);
      if (cancellation.signal.aborted) {
        await jobs.cancel(authedOf(req).tenant, jobId);
        return;
      }
      // Once admitted, HTTP disconnect does not own the job. Explicit DELETE does.
      res.setHeader("Preference-Applied", "respond-async");
      res.status(202).json({ jobId, status: "queued" });
    } catch (error) {
      admissionError(res, error);
    } finally { cancellation.dispose(); }
  });

  for (const operation of ["status", "result", "cancel"] as const) {
    const route = operation === "result" ? "/api/editorial/jobs/:id/result" : "/api/editorial/jobs/:id";
    const register = operation === "cancel" ? app.delete.bind(app) : app.get.bind(app);
    register(route, ...guards, operation === "cancel" ? cancelLimit : statusLimit, async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        const jobs = getEditorialJobs();
        if (!jobs) return res.status(503).json({ message: "Editorial queue unavailable" });
        const scope = authedOf(req).tenant;
        if (operation === "cancel") {
          if (!await jobs.cancel(scope, req.params.id)) return res.status(404).json({ message: "Job not found" });
          return res.json(await jobs.status(scope, req.params.id));
        }
        const status = await jobs.status(scope, req.params.id);
        if (!status) return res.status(404).json({ message: "Job not found" });
        if (operation === "status") return res.json(status);
        if (status.status !== "completed") return res.status(409).json(status);
        const result = await jobs.result(scope, req.params.id);
        if (!result) return res.status(404).json({ message: "Job result expired" });
        return res.json(result);
      } catch { return res.status(503).json({ message: "Editorial queue unavailable" }); }
    });
  }
}