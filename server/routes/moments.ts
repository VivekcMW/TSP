import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { storage, type TenantScope } from "../storage";
import { MOMENT_FILTERS, momentInputSchema, watchlistInputSchema } from "@shared/moments";
import { createMoment, findMomentsBetween, listAdminMoments, MomentNotFoundError, setMomentArchived, updateMoment, type MomentActor } from "../repositories/moments";
import { getWatchlist, listWatchAlerts, markWatchAlertsSeen, saveWatchlist, WatchlistTermError } from "../repositories/watchAlerts";
import { momentsForProfile, parseMomentWindow, todayIn } from "../services/moments";

/** Moments are global, admin-curated product configuration: platform-admin only, audited by requirePermission. */
const ADMIN_PERMISSION = "flag:write:all" as const;
const idSchema = z.string().uuid();
const adminListSchema = z.object({ filter: z.enum(MOMENT_FILTERS).default("upcoming") }).strict();
const archiveSchema = z.object({ archived: z.boolean() }).strict();
const seenSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

const scopeOf = (req: Request): TenantScope => {
  const { tenant } = authedOf(req);
  return { tenantId: tenant.tenantId, userId: tenant.userId };
};

/** Like other admin mutations, changes need a stated reason; it is stored with the audit entry. */
function actorOf(req: Request, res: Response): MomentActor | null {
  const reason = req.get("x-access-reason")?.trim();
  if (!reason || reason.length > 500) { res.status(400).json({ message: "A change reason of 1–500 characters is required" }); return null; }
  const { dbUser, tenant } = authedOf(req);
  return { userId: dbUser.id, platformRole: tenant.platformRole ?? null, reason, correlationId: req.get("x-correlation-id")?.trim().slice(0, 200) || undefined };
}

function invalid(res: Response, error: z.ZodError) {
  return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid moment", errors: error.flatten() });
}

function adminFailure(res: Response, error: unknown) {
  if (error instanceof MomentNotFoundError) return res.status(404).json({ message: "Moment not found" });
  console.error("[admin:moments] Change failed");
  return res.status(503).json({ message: "Moments are unavailable. Refresh and try again." });
}

function registerAdminMomentRoutes(app: Express) {
  app.get("/api/admin/moments", requireDbUser, requirePermission(ADMIN_PERMISSION), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = adminListSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid moment filter" });
    try { res.json(await listAdminMoments(parsed.data.filter, todayIn("UTC"))); }
    catch (error) { adminFailure(res, error); }
  });

  app.post("/api/admin/moments", requireDbUser, requirePermission(ADMIN_PERMISSION), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const actor = actorOf(req, res); if (!actor) return;
    const parsed = momentInputSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try { res.status(201).json(await createMoment(parsed.data, actor)); }
    catch (error) { adminFailure(res, error); }
  });

  app.patch("/api/admin/moments/:id", requireDbUser, requirePermission(ADMIN_PERMISSION), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const actor = actorOf(req, res); if (!actor) return;
    if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid moment ID" });
    const parsed = momentInputSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error);
    try { res.json(await updateMoment(req.params.id, parsed.data, actor)); }
    catch (error) { adminFailure(res, error); }
  });

  app.post("/api/admin/moments/:id/archive", requireDbUser, requirePermission(ADMIN_PERMISSION), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const actor = actorOf(req, res); if (!actor) return;
    const parsed = archiveSchema.safeParse(req.body);
    if (!parsed.success || !idSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "A valid moment and archive state are required" });
    try { res.json(await setMomentArchived(req.params.id, parsed.data.archived, actor)); }
    catch (error) { adminFailure(res, error); }
  });
}

/** Phase 5: industry moments (admin-managed), the watchlist and watch alerts. */
export function registerMomentsRoutes(app: Express) {
  registerAdminMomentRoutes(app);

  app.get("/api/moments", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    // Personal to this member and workspace: never reuse from the HTTP cache (React Query caches it client-side).
    res.setHeader("Cache-Control", "private, no-store");
    const scope = scopeOf(req);
    try {
      const profile = await storage.getUserProfile(scope);
      const today = todayIn(profile?.timezone);
      const window = parseMomentWindow(req.query, today);
      if (!window) return res.status(400).json({ message: "Use from and to as YYYY-MM-DD, at most 120 days apart" });
      const moments = momentsForProfile(await findMomentsBetween(window.from, window.to), profile, { ...window, today });
      res.json(moments);
    } catch {
      console.error("[moments] Listing failed");
      res.status(503).json({ message: "Moments are unavailable right now" });
    }
  });

  app.get("/api/watchlist", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await getWatchlist(scopeOf(req))); }
    catch { console.error("[watchlist] Read failed"); res.status(503).json({ message: "Watchlist unavailable" }); }
  });

  app.put("/api/watchlist", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = watchlistInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Choose up to 30 companies, people and topics" });
    try { res.json(await saveWatchlist(scopeOf(req), parsed.data.terms)); }
    catch (error) {
      if (error instanceof WatchlistTermError) return res.status(400).json({ message: error.message });
      console.error("[watchlist] Save failed"); res.status(503).json({ message: "Could not save your watchlist" });
    }
  });

  app.get("/api/watch-alerts", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await listWatchAlerts(scopeOf(req))); }
    catch { console.error("[watch-alerts] Read failed"); res.status(503).json({ message: "Alerts unavailable" }); }
  });

  app.post("/api/watch-alerts/seen", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = seenSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Send alert ids or all: true" });
    try { res.json({ updated: await markWatchAlertsSeen(scopeOf(req), "ids" in parsed.data ? parsed.data.ids : undefined) }); }
    catch { console.error("[watch-alerts] Update failed"); res.status(503).json({ message: "Could not update alerts" }); }
  });
}
