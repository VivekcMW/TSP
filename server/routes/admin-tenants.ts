import type { Express } from "express";
import { z } from "zod";
import { tenantDirectoryQuerySchema } from "@shared/admin";
import { requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { getTenantDirectory, getTenantOverview } from "../services/admin-tenants";

export function registerAdminTenantRoutes(app: Express) {
  app.get("/api/admin/tenant-directory", requireDbUser, requirePermission("tenant:read:all"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const query = tenantDirectoryQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ message: "Invalid tenant filters", errors: query.error.flatten() });
    try { res.json(await getTenantDirectory(query.data)); }
    catch { console.error("[admin:tenants] Directory unavailable"); res.status(503).json({ message: "Tenant directory unavailable" }); }
  });
  app.get("/api/admin/tenants/:id/overview", requireDbUser, requirePermission("tenant:read:all"), requirePermission("user:read:all"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: "A valid tenant ID is required" });
    if (req.tenant?.tenantId !== req.params.id) return res.status(403).json({ message: "Tenant context does not match investigation target", code: "tenant_context_mismatch" });
    if (!req.get("x-access-reason")?.trim()) return res.status(400).json({ message: "An investigation reason is required", code: "justification_required" });
    const query = z.object({ memberPage: z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(req.query);
    if (!query.success) return res.status(400).json({ message: "Invalid member page" });
    try {
      const overview = await getTenantOverview(req.params.id, query.data.memberPage);
      if (!overview) return res.status(404).json({ message: "Tenant not found" });
      res.json(overview);
    } catch { console.error("[admin:tenants] Scoped investigation unavailable"); res.status(503).json({ message: "Tenant investigation unavailable" }); }
  });
}
