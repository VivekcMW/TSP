import type { Express } from "express";
import { z } from "zod";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { storage, UserNoteLimitError } from "../storage";

// Only `text` is read from the body; tenant and user always come from the session.
const noteSchema = z.object({ text: z.string().trim().min(1).max(1000) });
const NOTE_TEXT_MESSAGE = "Enter a note between 1 and 1000 characters.";

export function registerNotesRoutes(app: Express) {
  app.get("/api/notes", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    try { res.json(await storage.getUserNotes(authedOf(req).tenant)); }
    catch (error) { console.error("Error fetching notes:", error); res.status(500).json({ message: "Failed to load notes" }); }
  });

  app.post("/api/notes", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: NOTE_TEXT_MESSAGE });
    try { res.status(201).json(await storage.createUserNote(authedOf(req).tenant, parsed.data.text)); }
    catch (error) {
      if (error instanceof UserNoteLimitError) return res.status(409).json({ message: error.message });
      console.error("Error creating note:", error); res.status(500).json({ message: "Failed to save note" });
    }
  });

  app.patch("/api/notes/:id", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: NOTE_TEXT_MESSAGE });
    try {
      const note = await storage.updateUserNote(authedOf(req).tenant, req.params.id, parsed.data.text);
      if (!note) return res.status(404).json({ message: "Note not found" });
      res.json(note);
    } catch (error) { console.error("Error updating note:", error); res.status(500).json({ message: "Failed to update note" }); }
  });

  app.delete("/api/notes/:id", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    try {
      if (!await storage.deleteUserNote(authedOf(req).tenant, req.params.id)) return res.status(404).json({ message: "Note not found" });
      res.json({ success: true });
    } catch (error) { console.error("Error deleting note:", error); res.status(500).json({ message: "Failed to delete note" }); }
  });
}
