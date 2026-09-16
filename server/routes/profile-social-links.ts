import type { Express } from "express";
import { z } from "zod";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { storage } from "../storage";

const platformDomains: Record<string, string[]> = {
  linkedin: ["linkedin.com", "www.linkedin.com"],
  twitter: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  github: ["github.com", "www.github.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
};
const linkSchema = z.object({
  platform: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(500),
  isPrimary: z.boolean().optional(),
});
const reorderSchema = z.object({ ids: z.array(z.string().uuid()).max(30) });

function validateUrl(platform: string, rawUrl: string): string | null {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return "Enter a valid profile URL."; }
  if (parsed.protocol !== "https:") return "Social links must use HTTPS.";
  const domains = platformDomains[platform];
  if (domains && !domains.includes(parsed.hostname.toLowerCase())) return `Use a valid ${platform} profile URL.`;
  return null;
}

export function registerProfileSocialLinksRoutes(app: Express) {
  app.get("/api/profile/social-links", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    try { res.json(await storage.getProfileSocialLinks(authedOf(req).tenant)); }
    catch (error) { console.error("Error fetching profile social links:", error); res.status(500).json({ message: "Failed to load social links" }); }
  });

  app.post("/api/profile/social-links", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter a platform, label, and valid URL." });
    const urlError = validateUrl(parsed.data.platform, parsed.data.url);
    if (urlError) return res.status(400).json({ message: urlError });
    try {
      const link = await storage.createProfileSocialLink(authedOf(req).tenant, { ...parsed.data, isPrimary: parsed.data.isPrimary ?? false });
      res.status(201).json(link);
    } catch (error) {
      if (error instanceof Error && error.message.includes("uniq_profile_social_links")) return res.status(409).json({ message: "You already have a link for this platform." });
      console.error("Error creating profile social link:", error); res.status(500).json({ message: "Failed to add social link" });
    }
  });

  app.patch("/api/profile/social-links/:id", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    const parsed = linkSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid social link details." });
    if (parsed.data.url && parsed.data.platform) { const urlError = validateUrl(parsed.data.platform, parsed.data.url); if (urlError) return res.status(400).json({ message: urlError }); }
    try {
      const link = await storage.updateProfileSocialLink(authedOf(req).tenant, req.params.id, parsed.data);
      if (!link) return res.status(404).json({ message: "Social link not found" });
      res.json(link);
    }
    catch (error) { console.error("Error updating profile social link:", error); res.status(500).json({ message: "Failed to update social link" }); }
  });

  app.delete("/api/profile/social-links/:id", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    try { await storage.deleteProfileSocialLink(authedOf(req).tenant, req.params.id); res.json({ success: true }); }
    catch (error) { console.error("Error deleting profile social link:", error); res.status(500).json({ message: "Failed to delete social link" }); }
  });

  app.put("/api/profile/social-links/reorder", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid social link order." });
    try { res.json(await storage.reorderProfileSocialLinks(authedOf(req).tenant, parsed.data.ids)); }
    catch (error) { console.error("Error reordering profile social links:", error); res.status(500).json({ message: "Failed to reorder social links" }); }
  });
}
