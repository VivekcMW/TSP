import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import * as adminService from "../services/adminService";
import { adminFlagHistory, featureFlags, insertFeatureFlagSchema, platformIntegrations } from "@shared/schema";
import { registerEmailAnnouncementRoutes } from "./email-announcements";
import { registerAdminTenantRoutes } from "./admin-tenants";
import { registerAdminRecordRoutes } from "./admin-records";
import { registerAdminOperationRoutes } from "./admin-operations";
import { flagHistory, mutateFlag } from "../services/admin-flags";
import { AdminControlConflict } from "../services/admin-quotas";
import { flagPolicySchema } from "@shared/admin-controls";
import { clearFeatureFlagCache } from "../services/featureFlags";

const createFlagSchema = insertFeatureFlagSchema.pick({ key: true, description: true, enabled: true }).extend({
  key: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9_:-]*$/, "Use lowercase letters, numbers, underscores, colons, or hyphens."),
  enabled: z.literal(false).default(false),
}).strict();
const updateFlagSchema = z.object({ enabled: z.boolean(), revision: z.number().int().positive() }).strict();
const updateIntegrationSchema = z.object({ enabled: z.boolean(), notes: z.string().max(500).optional() });

export function registerAdminRoutes(app: Express) {
  registerEmailAnnouncementRoutes(app);
  registerAdminTenantRoutes(app);
  registerAdminRecordRoutes(app);
  registerAdminOperationRoutes(app);
  // --- tenants ---------------------------------------------------------------
  app.get("/api/admin/tenants", requireDbUser, requirePermission("tenant:read:all"), async (_req, res) => {
    try {
      res.json(await adminService.listTenants());
    } catch (error) {
      console.error("Error listing tenants:", error);
      res.status(500).json({ message: "Failed to list tenants" });
    }
  });

  // --- users -------------------------------------------------------------------
  app.get("/api/admin/users", requireDbUser, requirePermission("user:read:all"), async (_req, res) => {
    try {
      res.json(await adminService.listUsers());
    } catch (error) {
      console.error("Error listing users:", error);
      res.status(500).json({ message: "Failed to list users" });
    }
  });

  // --- audit log -----------------------------------------------------------
  app.get("/api/admin/audit-log", requireDbUser, requirePermission("audit:read:all"), async (_req, res) => {
    try {
      res.json(await adminService.listAuditLog());
    } catch (error) {
      console.error("Error listing audit log:", error);
      res.status(500).json({ message: "Failed to list audit log" });
    }
  });

  // --- usage ---------------------------------------------------------------
  app.get("/api/admin/usage", requireDbUser, requirePermission("usage:read:all"), async (_req, res) => {
    try {
      res.json(await adminService.getPlatformUsage());
    } catch (error) {
      console.error("Error computing platform usage:", error);
      res.status(500).json({ message: "Failed to compute usage" });
    }
  });

  // --- pipeline / engine runs ------------------------------------------------
  /** The shared article index: catalogue, discovery, pool and the last crawl cycle. */
  app.get("/api/admin/index", requireDbUser, requirePermission("pipeline:operate:all"), async (_req, res) => {
    try {
      const [{ indexHealth }, { lastPoolCrawl }] = await Promise.all([import("../services/articlePool"), import("../jobs/pool-crawl")]);
      res.json({ ...await indexHealth(), lastCrawl: lastPoolCrawl });
    } catch {
      res.status(500).json({ message: "Index health unavailable" });
    }
  });

  app.get("/api/admin/engine-runs", requireDbUser, requirePermission("pipeline:operate:all"), async (_req, res) => {
    try {
      res.json(await adminService.listEngineRunsAcrossTenants());
    } catch (error) {
      console.error("Error listing engine runs:", error);
      res.status(500).json({ message: "Failed to list engine runs" });
    }
  });

  app.get("/api/admin/monitoring", requireDbUser, requirePermission("usage:read:all"), async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await adminService.getPlatformMonitoring());
    } catch (error) {
      console.error("Error loading platform monitoring:", error);
      res.status(500).json({ message: "Failed to load platform monitoring" });
    }
  });

  app.post("/api/admin/engine-runs/:id/rerun", requireDbUser, requirePermission("pipeline:operate:all"), (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(410).json({ code: "unsafe_rerun_retired", message: "Historical runs cannot create new recovery operations. Use Operations to inspect and recover an eligible retained failed discovery job with its original identity." });
  });

  // --- feature flags -----------------------------------------------------
  app.get("/api/admin/feature-flags", requireDbUser, requirePermission("flag:write:all"), async (_req, res) => {
    try {
      const rows = await db.select().from(featureFlags).orderBy(desc(featureFlags.createdAt));
      res.json(rows);
    } catch (error) {
      console.error("Error listing feature flags:", error);
      res.status(500).json({ message: "Failed to list feature flags" });
    }
  });

  app.post("/api/admin/feature-flags", requireDbUser, requirePermission("flag:write:all"), async (req, res) => {
    const reason = req.get("x-access-reason")?.trim();
    if (!reason) return res.status(400).json({ message: "A flag change reason is required" });
    try {
      const validation = createFlagSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }
      const created = await db.transaction(async tx => {
        const [row] = await tx.insert(featureFlags).values({ ...validation.data, enabled: false, owner: req.dbUser!.email,
          expiresAt: new Date(Date.now() + 30 * 86_400_000) }).returning();
        if (!row) throw new Error("Flag not created");
        await tx.insert(adminFlagHistory).values({ flagKey: row.key, actorId: req.dbUser!.id, reason, operation: "create", snapshot: { before: null, after: row } });
        return row;
      });
      clearFeatureFlagCache();
      res.json(created);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "A flag with that key already exists" });
      }
      console.error("Error creating feature flag:", error);
      res.status(500).json({ message: "Failed to create feature flag" });
    }
  });

  app.patch("/api/admin/feature-flags/:id", requireDbUser, requirePermission("flag:write:all"), async (req, res) => {
    const reason = req.get("x-access-reason")?.trim();
    if (!reason) return res.status(400).json({ message: "A flag change reason is required" });
    try {
      const validation = updateFlagSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data" });
      }
      const updated = await mutateFlag(req.params.id, req.dbUser!.id, reason, { operation: "toggle", ...validation.data });
      if (!updated) {
        return res.status(404).json({ message: "Feature flag not found" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof AdminControlConflict) return res.status(409).json({ message: error.message });
      console.error("Error updating feature flag:", error);
      res.status(500).json({ message: "Failed to update feature flag" });
    }
  });

  app.delete("/api/admin/feature-flags/:id", requireDbUser, requirePermission("flag:write:all"), async (req, res) => {
    const reason = req.get("x-access-reason")?.trim();
    const query = z.object({ revision: z.coerce.number().int().positive() }).strict().safeParse(req.query);
    if (!reason || !query.success) return res.status(400).json({ message: "Reason and current revision are required. Deletion restores the shipped default." });
    try {
      const deleted = await mutateFlag(req.params.id, req.dbUser!.id, reason, { operation: "delete", revision: query.data.revision });
      if (!deleted) return res.status(404).json({ message: "Feature flag not found" });
      res.json({ message: "Feature flag deleted" });
    } catch (error) {
      if (error instanceof AdminControlConflict) return res.status(409).json({ message: error.message });
      console.error("Error deleting feature flag:", error);
      res.status(500).json({ message: "Failed to delete feature flag" });
    }
  });
  app.patch("/api/admin/feature-flags/:id/policy", requireDbUser, requirePermission("flag:write:all"), async (req, res) => {
    const reason = req.get("x-access-reason")?.trim();
    const parsed = flagPolicySchema.safeParse(req.body);
    if (!reason || !parsed.success) return res.status(400).json({ message: "Valid ownership, expiry, tenant rollout and reason are required" });
    try {
      const row = await mutateFlag(req.params.id, req.dbUser!.id, reason, { operation: "policy", policy: parsed.data });
      if (!row) return res.status(404).json({ message: "Flag not found" });
      res.json(row);
    } catch (error) {
      if (error instanceof AdminControlConflict) return res.status(409).json({ message: error.message });
      console.error("[admin:flags] Policy update failed"); res.status(503).json({ message: "Flag policy unavailable" });
    }
  });
  app.get("/api/admin/feature-flag-history", requireDbUser, requirePermission("flag:write:all"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = z.object({ key: z.string().min(1).max(80) }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Flag key required" });
    try { res.json(await flagHistory(parsed.data.key)); }
    catch { console.error("[admin:flags] History unavailable"); res.status(503).json({ message: "Flag history unavailable" }); }
  });

  // --- integration management -----------------------------------------------
  app.get("/api/admin/integrations", requireDbUser, requirePermission("flag:write:all"), async (_req, res) => {
    try {
      const rows = await db.select().from(platformIntegrations).orderBy(platformIntegrations.label);
      res.json(rows);
    } catch (error) {
      console.error("Error listing integrations:", error);
      res.status(500).json({ message: "Failed to list integrations" });
    }
  });

  app.patch("/api/admin/integrations/:key", requireDbUser, requirePermission("flag:write:all"), async (req, res) => {
    try {
      const validation = updateIntegrationSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data" });
      }
      const [updated] = await db
        .update(platformIntegrations)
        .set({ ...validation.data, updatedAt: new Date() })
        .where(eq(platformIntegrations.key, req.params.key))
        .returning();
      if (!updated) {
        return res.status(404).json({ message: "Integration not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating integration:", error);
      res.status(500).json({ message: "Failed to update integration" });
    }
  });
}
