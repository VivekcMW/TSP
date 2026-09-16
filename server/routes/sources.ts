import type { Express } from "express";
import { z } from "zod";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { discoverFeed } from "../services/feedDiscovery";
import { assertPublicHttpUrl } from "../services/urlValidator";
import { normalizeIndustryToSlug } from "../services/metaEngine";
import { storage } from "../storage";

const addSourceSchema = z.union([
  z.object({ input: z.string().trim().min(1).max(300) }),
  z.object({ name: z.string().trim().min(1).max(200), feedUrl: z.string().trim().url() }),
]);

const updateSourceSchema = z.object({
  isActive: z.boolean(),
});

/**
 * A user's own Discover sources — the only thing (besides live keyword
 * search) Discover ever fetches from. No admin-curated list is applied
 * automatically; /suggestions is opt-in only.
 */
export function registerSourcesRoutes(app: Express) {
  app.get("/api/sources", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const sources = await storage.getUserSources(scope);
      res.json(sources);
    } catch (error) {
      console.error("Error fetching sources:", error);
      res.status(500).json({ message: "Failed to fetch sources" });
    }
  });

  app.get("/api/sources/suggestions", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    try {
      const { dbUser } = authedOf(req);
      const industry = normalizeIndustryToSlug(dbUser.industry) || "other";
      const suggestions = await storage.getIndustrySources(industry);
      // Read-only reference data - never fetched or auto-applied. The user
      // must explicitly add one via POST /api/sources for it to take effect.
      res.json(suggestions.map((s) => ({ id: s.id, name: s.name, feedUrl: s.feedUrl })));
    } catch (error) {
      console.error("Error fetching source suggestions:", error);
      res.status(500).json({ message: "Failed to fetch source suggestions" });
    }
  });

  app.post("/api/sources", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const parsed = addSourceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Provide a publication name/URL, or a name and feedUrl." });
      }

      let name: string;
      let feedUrl: string;
      let sourceType: "feed" | "webpage" = "feed";

      if ("input" in parsed.data) {
        const result = await discoverFeed(parsed.data.input);
        if ("error" in result) {
          return res.status(400).json({ message: result.error });
        }
        name = result.name;
        feedUrl = result.feedUrl;
        sourceType = result.sourceType;
      } else {
        const guard = await assertPublicHttpUrl(parsed.data.feedUrl);
        if (!guard.ok) {
          return res.status(400).json({ message: guard.reason });
        }
        name = parsed.data.name;
        feedUrl = parsed.data.feedUrl;
      }

      const created = await storage.createUserSource(scope, {
        name,
        feedUrl,
        sourceType,
        addedVia: "input" in parsed.data ? "manual" : "suggestion",
        isActive: true,
      });
      res.json(created);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "You've already added this source." });
      }
      console.error("Error adding source:", error);
      res.status(500).json({ message: "Failed to add source" });
    }
  });

  app.patch("/api/sources/:id", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const { id } = req.params;
      const parsed = updateSourceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request data" });
      }
      const updated = await storage.updateUserSource(scope, id, { isActive: parsed.data.isActive });
      if (!updated) {
        return res.status(404).json({ message: "Source not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating source:", error);
      res.status(500).json({ message: "Failed to update source" });
    }
  });

  app.delete("/api/sources/:id", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      const { tenant: scope } = authedOf(req);
      const { id } = req.params;
      await storage.deleteUserSource(scope, id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting source:", error);
      res.status(500).json({ message: "Failed to delete source" });
    }
  });
}
