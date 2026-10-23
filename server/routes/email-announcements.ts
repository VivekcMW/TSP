import type { Express, Response } from "express";
import { z } from "zod";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { announcementSchema } from "@shared/email-announcements";
import { confirmAnnouncement, listAnnouncementCampaigns, prepareAnnouncement, sendAnnouncementTest, setAnnouncementPaused } from "../services/email/announcements";

const confirmSchema = z.object({ confirm: z.literal(true) }).strict();
const idSchema = z.string().uuid();
const enabled = () => process.env.EMAIL_ANNOUNCEMENTS_ENABLED === "true";
function disabled(res: Response) {
  return res.status(503).json({ message: "Announcement dispatch is disabled. Enable EMAIL_ANNOUNCEMENTS_ENABLED on the production scheduler before confirming." });
}
export function registerEmailAnnouncementRoutes(app: Express) {
  app.get("/api/admin/email-announcements", requireDbUser, requirePermission("email:send:all"), async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json({ enabled: enabled(), testEnabled: process.env.EMAIL_ANNOUNCEMENT_TEST_ENABLED === "true", campaigns: await listAnnouncementCampaigns() }); }
    catch { console.error("[email:announcement] Campaign listing failed"); res.status(503).json({ message: "Email announcements unavailable" }); }
  });
  app.post("/api/admin/email-announcements/preview", requireDbUser, requirePermission("email:send:all"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid announcement", errors: parsed.error.flatten() });
    try { res.status(201).json(await prepareAnnouncement(authedOf(req).dbUser.id, parsed.data)); }
    catch { console.error("[email:announcement] Preview preparation failed"); res.status(503).json({ message: "Could not prepare announcement preview" }); }
  });
  app.post("/api/admin/email-announcements/:id/confirm", requireDbUser, requirePermission("email:send:all"), async (req, res) => {
    if (!confirmSchema.safeParse(req.body).success || !idSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Explicit confirmation and a valid campaign ID are required" });
    if (!enabled()) return disabled(res);
    try {
      if (!await confirmAnnouncement(req.params.id)) return res.status(404).json({ message: "Announcement not found" });
      res.status(202).json({ accepted: true, message: "Announcement confirmed. Delivery progress will update as the scheduler processes recipients." });
    } catch { console.error("[email:announcement] Confirmation failed"); res.status(503).json({ message: "Could not confirm announcement; retry with the same campaign ID" }); }
  });
  app.post("/api/admin/email-announcements/:id/pause", requireDbUser, requirePermission("email:send:all"), async (req, res) => {
    const parsed = z.object({ paused: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success || !idSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "A valid campaign and explicit pause state are required" });
    if (!parsed.data.paused && !enabled()) return disabled(res);
    try {
      if (!await setAnnouncementPaused(req.params.id, parsed.data.paused)) return res.status(409).json({ message: "Campaign cannot make that transition. Refresh campaign progress." });
      res.json({ paused: parsed.data.paused, message: "Campaign admission updated. Already-admitted sends may finish." });
    } catch { console.error("[email:announcement] Pause transition failed"); res.status(503).json({ message: "Campaign state unavailable" }); }
  });
  app.post("/api/admin/email-announcements/:id/test", requireDbUser, requirePermission("email:send:all"), async (req, res) => {
    if (!confirmSchema.safeParse(req.body).success || !idSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Explicit confirmation and a valid campaign are required" });
    if (process.env.EMAIL_ANNOUNCEMENT_TEST_ENABLED !== "true") return res.status(503).json({ message: "Test sending is disabled. Enable EMAIL_ANNOUNCEMENT_TEST_ENABLED deliberately." });
    try {
      const actor = authedOf(req).dbUser;
      const outcome = await sendAnnouncementTest(req.params.id, actor);
      if (outcome === undefined) return res.status(404).json({ message: "Announcement not found" });
      res.json({ outcome: outcome ?? "pending", message: "Test addressed only to your signed-in account; preferences apply. Repeating this test uses the same delivery identity." });
    } catch { console.error("[email:announcement] Test send unavailable"); res.status(503).json({ message: "Test outcome unavailable; retry only this same campaign" }); }
  });
}
