import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { storage } from "../storage";
import { engineRegistry } from "../services/engines/index.js";
import { normalizeIndustryToSlug } from "../services/metaEngine";
import * as adminService from "../services/adminService";
import { featureFlags, insertFeatureFlagSchema, platformIntegrations } from "@shared/schema";
import { enqueueInboxRefresh, getInboxRefreshQueue } from "../jobs/queue";

const createFlagSchema = insertFeatureFlagSchema.pick({ key: true, description: true, enabled: true }).extend({
  key: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9_:-]*$/, "Use lowercase letters, numbers, underscores, colons, or hyphens."),
});
const updateFlagSchema = z.object({ enabled: z.boolean() });
const rerunSchema = z.object({ tenantId: z.string().min(1) });
const updateIntegrationSchema = z.object({ enabled: z.boolean(), notes: z.string().max(500).optional() });

export function registerAdminRoutes(app: Express) {
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
  app.get("/api/admin/engine-runs", requireDbUser, requirePermission("pipeline:operate:all"), async (_req, res) => {
    try {
      res.json(await adminService.listEngineRunsAcrossTenants());
    } catch (error) {
      console.error("Error listing engine runs:", error);
      res.status(500).json({ message: "Failed to list engine runs" });
    }
  });

  app.get("/api/admin/monitoring", requireDbUser, requirePermission("usage:read:all"), async (_req, res) => {
    try {
      res.json(await adminService.getPlatformMonitoring());
    } catch (error) {
      console.error("Error loading platform monitoring:", error);
      res.status(500).json({ message: "Failed to load platform monitoring" });
    }
  });

  app.post("/api/admin/engine-runs/:id/rerun", requireDbUser, requirePermission("pipeline:operate:all"), async (req, res) => {
    try {
      const validation = rerunSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "tenantId is required" });
      }
      const { tenantId } = validation.data;

      if (req.tenant?.tenantId !== tenantId) {
        return res.status(403).json({ message: "Tenant context does not match rerun target", code: "tenant_context_mismatch" });
      }

      const run = await adminService.getEngineRunById(req.params.id, tenantId);
      if (!run?.userId) {
        return res.status(404).json({ message: "Engine run not found" });
      }

      const scope = { tenantId, userId: run.userId };
      const profile = await storage.getUserProfile(scope);
      if (!profile) {
        return res.status(404).json({ message: "User profile not found for this run" });
      }

      if (getInboxRefreshQueue()) {
        const jobId = await enqueueInboxRefresh({ tenantId, userId: run.userId, manual: true, priority: "high", triggeredBy: "manual" });
        if (jobId) return res.status(202).json({ queued: true, jobId, tenantId, userId: run.userId });
      }

      const industry = normalizeIndustryToSlug(run.industry);
      const engine = engineRegistry.getEngine(industry);
      const result = await engine.processForUser(scope, profile);

      await storage.createEngineRunLog(scope, {
        industry,
        status: result.success ? "success" : "failed",
        articlesProcessed: result.articlesProcessed,
        articlesMatched: result.articlesMatched,
        errorMessage: result.errors?.join("; ") || null,
        durationMs: result.durationMs,
        completedAt: new Date(),
      });

      res.json(result);
    } catch (error) {
      console.error("Error re-running engine:", error);
      res.status(500).json({ message: "Failed to re-run engine" });
    }
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
    try {
      const validation = createFlagSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data", errors: validation.error.errors });
      }
      const [created] = await db.insert(featureFlags).values(validation.data).returning();
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
    try {
      const validation = updateFlagSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid request data" });
      }
      const [updated] = await db
        .update(featureFlags)
        .set({ enabled: validation.data.enabled, updatedAt: new Date() })
        .where(eq(featureFlags.id, req.params.id))
        .returning();
      if (!updated) {
        return res.status(404).json({ message: "Feature flag not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating feature flag:", error);
      res.status(500).json({ message: "Failed to update feature flag" });
    }
  });

  app.delete("/api/admin/feature-flags/:id", requireDbUser, requirePermission("flag:write:all"), async (req, res) => {
    try {
      const deleted = await db.delete(featureFlags).where(eq(featureFlags.id, req.params.id)).returning({ id: featureFlags.id });
      if (!deleted.length) return res.status(404).json({ message: "Feature flag not found" });
      res.json({ message: "Feature flag deleted" });
    } catch (error) {
      console.error("Error deleting feature flag:", error);
      res.status(500).json({ message: "Failed to delete feature flag" });
    }
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
