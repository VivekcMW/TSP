import type { Express } from "express";
import { voiceMutationSchema } from "@shared/editorial-voice";
import { requireDbUser, authedOf } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { editorialVoiceRepository, VoiceConflict, VoiceNotFound } from "../repositories/editorialVoice";

export function registerEditorialVoiceRoutes(app: Express) {
  const guards = [requireDbUser, requirePermission("profile:write:own")];
  app.get("/api/editorial/voice", ...guards, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await editorialVoiceRepository.get(authedOf(req).tenant)); }
    catch { res.status(503).json({ message: "Voice settings unavailable." }); }
  });
  app.patch("/api/editorial/voice", ...guards, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = voiceMutationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid voice change or missing explicit consent." });
    try { res.json(await editorialVoiceRepository.mutate(authedOf(req).tenant, parsed.data)); }
    catch (error) {
      if (error instanceof VoiceConflict) return res.status(409).json({ message: error.message });
      if (error instanceof VoiceNotFound) return res.status(404).json({ message: error.message });
      res.status(503).json({ message: "Voice change could not be confirmed. Reload before retrying." });
    }
  });
}