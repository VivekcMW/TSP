import type { Express } from "express";
import { emailPreferencePatch } from "@shared/email-preferences";
import { getEmailPreferences, updateEmailPreferences } from "../services/email/preferences";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";

export function registerEmailPreferenceRoutes(app: Express) {
  app.get("/api/email-preferences", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await getEmailPreferences(authedOf(req).dbUser.id)); }
    catch { res.status(503).json({ message: "Email preferences unavailable" }); }
  });

  app.patch("/api/email-preferences", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const parsed = emailPreferencePatch.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid email preferences" });
    try { res.json(await updateEmailPreferences(authedOf(req).dbUser.id, parsed.data)); }
    catch { res.status(503).json({ message: "Could not save email preferences" }); }
  });
}
