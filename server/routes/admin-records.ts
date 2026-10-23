import type { Express } from "express";
import { z } from "zod";
import { adminRecordsQuerySchema, emailDirectoryQuerySchema } from "@shared/admin";
import { requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { getAuditDirectory, getEmailDirectory, getUserDirectory, getUserOverview } from "../services/admin-records";

export function registerAdminRecordRoutes(app: Express) {
  for (const kind of ["users", "audit"] as const) {
    app.get(`/api/admin/${kind}-directory`, requireDbUser, requirePermission(kind === "users" ? "user:read:all" : "audit:read:all"), async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const parsed = adminRecordsQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ message: "Invalid directory filters" });
      try { res.json(kind === "users" ? await getUserDirectory(parsed.data) : await getAuditDirectory(parsed.data)); }
      catch { console.error(`[admin:${kind}] Directory read failed`); res.status(503).json({ message: "Directory unavailable" }); }
    });
  }
  app.get("/api/admin/email-directory", requireDbUser, requirePermission("user:read:all"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = emailDirectoryQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid delivery filters" });
    try { res.json(await getEmailDirectory(parsed.data)); }
    catch { console.error("[admin:email] Delivery search failed"); res.status(503).json({ message: "Delivery history unavailable" }); }
  });
  app.get("/api/admin/users/:id/overview", requireDbUser, requirePermission("user:read:all"), requirePermission("tenant:read:all"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!z.string().min(1).max(100).safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid user ID" });
    if (!req.get("x-access-reason")?.trim()) return res.status(400).json({ message: "An investigation reason is required" });
    const query = z.object({ membershipPage: z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(req.query);
    if (!query.success) return res.status(400).json({ message: "Invalid membership page" });
    try {
      const overview = await getUserOverview(req.params.id, query.data.membershipPage);
      if (!overview) return res.status(404).json({ message: "User not found" });
      res.json(overview);
    } catch { console.error("[admin:users] Investigation failed"); res.status(503).json({ message: "User investigation unavailable" }); }
  });
}
