import type { Express, Response } from "express";
import type { ZodError } from "zod";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { CheckinConflictError, SavedIdeaLimitError, StrategyConflictError } from "../repositories/strategy";
import { CheckinWeekError, getContentPlan, getCurrentCheckin, getStrategy, getTopicIdeas, saveCurrentCheckin, saveStrategy, setIdeaState } from "../services/topicIdeas";
import { checkinUpdateSchema, IDEA_ID_PATTERN, ideasQuerySchema, ideaStateUpdateSchema, planQuerySchema, strategyUpdateSchema } from "@shared/topic-ideas";

const issue = (error: ZodError, fallback: string) => error.issues[0]?.message || fallback;
function failed(res: Response, action: string, error: unknown) {
  console.error(`Error: ${action}:`, error);
  res.status(500).json({ message: `Failed to ${action}` });
}

/** Phase 3: content strategy, topic ideas, weekly check-ins and the 30-day plan. Tenant and user always come from the session. */
export function registerStrategyRoutes(app: Express) {
  app.get("/api/strategy", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    try { res.json(await getStrategy(authedOf(req).tenant)); }
    catch (error) { failed(res, "load your strategy", error); }
  });

  app.put("/api/strategy", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    const parsed = strategyUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: issue(parsed.error, "Check your strategy and try again.") });
    const scope = authedOf(req).tenant;
    try { res.json(await saveStrategy(scope, parsed.data.revision, parsed.data.strategy)); }
    catch (error) {
      if (!(error instanceof StrategyConflictError)) return failed(res, "save your strategy", error);
      try { res.status(409).json({ message: error.message, current: await getStrategy(scope) }); }
      catch (reloadError) { failed(res, "load your strategy", reloadError); }
    }
  });

  app.get("/api/checkins/current", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    try { res.json(await getCurrentCheckin(authedOf(req).tenant)); }
    catch (error) { failed(res, "load this week's check-in", error); }
  });

  app.put("/api/checkins/current", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    const parsed = checkinUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: issue(parsed.error, "Check your answers and try again.") });
    const scope = authedOf(req).tenant;
    const { weekStart, answers, replace } = parsed.data;
    try { res.json(await saveCurrentCheckin(scope, weekStart, answers, replace)); }
    catch (error) {
      if (!(error instanceof CheckinWeekError || error instanceof CheckinConflictError)) return failed(res, "save this week's check-in", error);
      try { res.status(409).json({ message: error.message, current: await getCurrentCheckin(scope) }); }
      catch (reloadError) { failed(res, "load this week's check-in", reloadError); }
    }
  });

  app.get("/api/ideas", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    const parsed = ideasQuerySchema.safeParse({ extra: req.query.extra });
    if (!parsed.success) return res.status(400).json({ message: "Unknown idea ids." });
    try { res.json(await getTopicIdeas(authedOf(req).tenant, parsed.data.extra)); }
    catch (error) { failed(res, "load topic ideas", error); }
  });

  app.patch("/api/ideas/:id", requireDbUser, requirePermission("profile:write:own"), async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!IDEA_ID_PATTERN.test(id)) return res.status(400).json({ message: "Unknown idea." });
    const parsed = ideaStateUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Choose saved, dismissed, used or none." });
    if (parsed.data.idea && parsed.data.idea.id !== id) return res.status(400).json({ message: "The idea does not match." });
    try {
      await setIdeaState(authedOf(req).tenant, id, parsed.data.state, parsed.data.idea);
      res.json({ id, state: parsed.data.state });
    } catch (error) {
      if (error instanceof SavedIdeaLimitError) return res.status(409).json({ message: error.message });
      failed(res, "update the idea", error);
    }
  });

  app.get("/api/plan", requireDbUser, requirePermission("profile:read:own"), async (req, res) => {
    const parsed = planQuerySchema.safeParse({ days: req.query.days, extra: req.query.extra });
    if (!parsed.success) return res.status(400).json({ message: "Choose between 1 and 60 days." });
    try { res.json(await getContentPlan(authedOf(req).tenant, parsed.data.days, parsed.data.extra)); }
    catch (error) { failed(res, "load your plan", error); }
  });
}
