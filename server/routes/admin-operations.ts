import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { quotaGrantSchema, incidentTransitionSchema } from "@shared/admin-controls";
import { grantQuota, listQuotaGrants, revokeQuota, AdminControlConflict } from "../services/admin-quotas";
import { getAdminJob, listAdminJobs, recoverDiscoveryJob } from "../services/admin-jobs";
import { listIncidents, operationalSnapshot, synchronizeIncidents, transitionIncident } from "../services/admin-incidents";
import { InboxRefreshAdmissionError } from "../jobs/queue";
import { getTenantInsights } from "../services/admin-insights";
import { collectTenantRollup, listAdminRollups } from "../services/admin-rollups";

const pageSchema = z.coerce.number().int().min(1).max(10000).default(1);
function reason(req: Request, res: Response): string | null {
  const value = req.get("x-access-reason")?.trim();
  if (!value || value.length > 500) { res.status(400).json({ message: "A reason of 1–500 characters is required" }); return null; }
  return value;
}
function failure(res: Response, error: unknown) {
  if (error instanceof AdminControlConflict || error instanceof InboxRefreshAdmissionError) return res.status(409).json({ message: error.message });
  console.error("[admin:operations] Operation unavailable");
  return res.status(503).json({ message: "Operation unavailable. Refresh current state before retrying the same request." });
}
export function registerAdminOperationRoutes(app: Express) {
  app.use("/api/admin/operations", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  app.get("/api/admin/operations/health", requireDbUser, requirePermission("usage:read:all"), async (_req, res) => {
    try { res.json(await operationalSnapshot()); } catch (error) { failure(res, error); }
  });
  app.get("/api/admin/operations/rollups", requireDbUser, requirePermission("usage:read:all"), async (req, res) => {
    const parsed = z.object({ page: pageSchema }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid rollup page" });
    try { res.json(await listAdminRollups(parsed.data.page)); } catch (error) { failure(res, error); }
  });
  app.post("/api/admin/operations/rollups/:tenant/refresh", requireDbUser, requirePermission("pipeline:operate:all"), async (req, res) => {
    if (!reason(req, res)) return;
    if (!z.string().uuid().safeParse(req.params.tenant).success || !z.object({ confirm: z.literal(true) }).strict().safeParse(req.body).success) return res.status(400).json({ message: "Explicit scoped refresh required" });
    if (req.tenant?.tenantId !== req.params.tenant) return res.status(403).json({ message: "Tenant context mismatch" });
    try { res.json(await collectTenantRollup(req.params.tenant)); } catch (error) { failure(res, error); }
  });
  app.get("/api/admin/operations/insights/:tenant", requireDbUser, requirePermission("usage:read:all"), async (req, res) => {
    if (!reason(req, res)) return;
    if (!z.string().uuid().safeParse(req.params.tenant).success) return res.status(400).json({ message: "Invalid workspace" });
    if (req.tenant?.tenantId !== req.params.tenant) return res.status(403).json({ message: "Tenant context mismatch" });
    try { res.json(await getTenantInsights(req.params.tenant)); } catch (error) { failure(res, error); }
  });
  app.post("/api/admin/operations/evaluate", requireDbUser, requirePermission("pipeline:operate:all"), async (req, res) => {
    if (!reason(req, res)) return;
    if (!z.object({ confirm: z.literal(true) }).strict().safeParse(req.body).success) return res.status(400).json({ message: "Explicit evaluation confirmation required" });
    try { res.json(await synchronizeIncidents()); } catch (error) { failure(res, error); }
  });
  app.get("/api/admin/operations/incidents", requireDbUser, requirePermission("usage:read:all"), async (req, res) => {
    const parsed = z.object({ page: pageSchema }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid incident page" });
    try { const rows = await listIncidents(parsed.data.page); res.json({ items: rows.slice(0, 25), hasMore: rows.length > 25, page: parsed.data.page }); }
    catch (error) { failure(res, error); }
  });
  app.patch("/api/admin/operations/incidents/:id", requireDbUser, requirePermission("pipeline:operate:all"), async (req, res) => {
    const justification = reason(req, res); if (!justification) return;
    const parsed = incidentTransitionSchema.safeParse(req.body);
    if (!parsed.success || !z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid incident transition" });
    try { res.json(await transitionIncident(req.params.id, parsed.data.state, parsed.data.version, req.dbUser!.id, justification)); } catch (error) { failure(res, error); }
  });
  app.get("/api/admin/operations/jobs", requireDbUser, requirePermission("pipeline:operate:all"), async (req, res) => {
    const parsed = z.object({ queue: z.enum(["inbox", "publishing"]), state: z.enum(["failed", "waiting", "active", "delayed"]).default("failed"), page: pageSchema }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid job filters" });
    try { res.json(await listAdminJobs(parsed.data.queue, parsed.data.state, parsed.data.page)); } catch (error) { failure(res, error); }
  });
  app.get("/api/admin/operations/jobs/:queue/:id", requireDbUser, requirePermission("pipeline:operate:all"), async (req, res) => {
    const queue = z.enum(["inbox", "publishing"]).safeParse(req.params.queue);
    if (!queue.success || req.params.id.length > 200) return res.status(400).json({ message: "Invalid job identity" });
    try { const job = await getAdminJob(queue.data, req.params.id); if (!job) return res.status(404).json({ message: "Retained job not found" }); res.json(job); }
    catch (error) { failure(res, error); }
  });
  app.post("/api/admin/operations/jobs/inbox/:id/recover", requireDbUser, requirePermission("pipeline:operate:all"), async (req, res) => {
    if (!reason(req, res)) return;
    const parsed = z.object({ operationId: z.string().min(1).max(200), tenantId: z.string().uuid(), confirm: z.literal(true) }).strict().safeParse(req.body);
    if (!parsed.success || req.params.id.length > 200) return res.status(400).json({ message: "Original operation, tenant and explicit confirmation required" });
    if (req.tenant?.tenantId !== parsed.data.tenantId) return res.status(403).json({ message: "Tenant context mismatch" });
    try { const result = await recoverDiscoveryJob(req.params.id, parsed.data.operationId, parsed.data.tenantId); if (!result) return res.status(404).json({ message: "Retained job not found" }); res.json(result); }
    catch (error) { failure(res, error); }
  });
  app.get("/api/admin/operations/quotas/:tenant", requireDbUser, requirePermission("quota:override:all"), async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.tenant).success) return res.status(400).json({ message: "Invalid workspace" });
    if (req.tenant?.tenantId !== req.params.tenant) return res.status(403).json({ message: "Tenant context mismatch" });
    try { res.json(await listQuotaGrants(req.params.tenant)); } catch (error) { failure(res, error); }
  });
  app.post("/api/admin/operations/quotas/:tenant", requireDbUser, requirePermission("quota:override:all"), async (req, res) => {
    const justification = reason(req, res); if (!justification) return;
    if (!z.string().uuid().safeParse(req.params.tenant).success || !quotaGrantSchema.safeParse(req.body).success) return res.status(400).json({ message: "Invalid allowance request" });
    if (req.tenant?.tenantId !== req.params.tenant) return res.status(403).json({ message: "Tenant context mismatch" });
    try { res.json(await grantQuota(req.params.tenant, req.dbUser!.id, justification, req.body)); } catch (error) { failure(res, error); }
  });
  app.post("/api/admin/operations/quotas/:tenant/:id/revoke", requireDbUser, requirePermission("quota:override:all"), async (req, res) => {
    if (!reason(req, res)) return;
    if (!z.string().uuid().safeParse(req.params.tenant).success || !z.string().uuid().safeParse(req.params.id).success
      || !z.object({ confirm: z.literal(true) }).strict().safeParse(req.body).success) return res.status(400).json({ message: "Invalid revocation" });
    if (req.tenant?.tenantId !== req.params.tenant) return res.status(403).json({ message: "Tenant context mismatch" });
    try { const grant = await revokeQuota(req.params.tenant, req.params.id); if (!grant) return res.status(404).json({ message: "Grant not found" }); res.json(grant); }
    catch (error) { failure(res, error); }
  });
}
