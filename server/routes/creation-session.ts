import type { Express } from "express";
import { saveCreationSessionSchema } from "@shared/creation-session";
import { requireDbUser, authedOf } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { creationSession, CreationConflict } from "../repositories/creationSession";

export function registerCreationSessionRoutes(app: Express) {
  const guards = [requireDbUser, requirePermission("draft:write:own")];
  app.get("/api/creation-session", ...guards, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await creationSession(authedOf(req).tenant)); }
    catch {
      console.error("Could not load creation session");
      res.status(503).json({ message: "Saved creation is unavailable. Retry before making changes." });
    }
  });
  app.put("/api/creation-session", ...guards, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = saveCreationSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Creation could not be saved: invalid or oversized content." });
    try { res.json(await creationSession(authedOf(req).tenant, parsed.data)); }
    catch (error) {
      if (error instanceof CreationConflict) return res.status(409).json({ message: error.message });
      console.error("Could not save creation session");
      res.status(503).json({ message: "Creation save could not be confirmed. Keep this tab open and retry saving." });
    }
  });
}
