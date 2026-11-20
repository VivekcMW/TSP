import type { Express, Response } from "express";
import { z } from "zod";
import { DISMISS_REASONS, FEED_PREFERENCE_LIMITS as LIMITS, type FeedbackResult, type FeedPreferencesChange, type FeedPreferencesReset } from "@shared/schema";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { inboxFeedbackRepository as repository } from "../repositories/inboxFeedback";
import { applyPreferenceChange, calibrationChange, dismissChange, FeedbackInputError, removalRestore, resetRestore, restorePreferences } from "../services/feedbackWeights";

const keyword = z.string().trim().min(1).max(LIMITS.keyword);
const source = z.string().trim().min(1).max(LIMITS.source);
const storyId = z.string().trim().min(1).max(100);
const atMost = (max: number) => (value: Record<string, unknown>) => Object.keys(value).length <= max;

// Only these fields are read from bodies; tenant and user always come from the session.
const feedbackSchema = z.object({
  reason: z.enum(DISMISS_REASONS),
  muteSource: z.boolean().optional(),
  lessAbout: z.array(keyword).max(10).optional(),
}).strict();
const calibrationSchema = z.object({
  votes: z.array(z.object({ id: storyId, vote: z.enum(["relevant", "not_relevant", "skip"]) }).strict()).min(1).max(10)
    .refine(votes => new Set(votes.map(vote => vote.id)).size === votes.length, "Vote once per story"),
  apply: z.object({
    moreAbout: z.array(keyword).max(10).default([]),
    lessAbout: z.array(keyword).max(10).default([]),
    mute: z.array(source).max(10).default([]),
  }).strict().default({}),
}).strict();
const delta = z.number().finite().min(LIMITS.minDelta).max(LIMITS.maxDelta).nullable();
const restoreSchema = z.object({
  keywords: z.record(keyword, z.object({ before: delta, after: delta }).strict()).refine(atMost(LIMITS.keywordAdjustments)).default({}),
  sources: z.record(source, z.object({ before: z.boolean(), after: z.boolean() }).strict()).refine(atMost(LIMITS.mutedSources)).default({}),
}).strict();
const patchSchema = z.union([
  z.object({ unmuteSource: source }).strict(),
  z.object({ resetKeyword: keyword }).strict(),
  z.object({ restore: restoreSchema, feedbackId: storyId.optional() }).strict(),
]);

class StoryNotFound extends Error {}

/** A missing table means migration 0062 has not been applied yet. */
function unavailable(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; current = (current as { cause?: unknown }).cause, depth++) {
    if ((current as { code?: unknown }).code === "42P01") return true;
  }
  return false;
}

function fail(res: Response, error: unknown, action: string) {
  if (error instanceof StoryNotFound) return res.status(404).json({ message: "Story not found" });
  if (error instanceof FeedbackInputError) return res.status(400).json({ message: error.message });
  if (unavailable(error)) return res.status(503).json({ message: "Feed preferences are not available yet" });
  console.error(`Error trying ${action}:`, error instanceof Error ? error.message : "unknown error");
  return res.status(500).json({ message: `Failed ${action}` });
}

/** Phase 4: dismiss reasons, story feedback and the 30-second calibration. */
export function registerInboxFeedbackRoutes(app: Express) {
  app.post("/api/inbox/calibration", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    const parsed = calibrationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Send up to 10 votes, one per story." });
    const { votes, apply } = parsed.data;
    try {
      const outcome = await repository.update(authedOf(req).tenant, votes.filter(vote => vote.vote !== "skip").map(vote => vote.id), (items, current) => {
        const { change, feedback } = calibrationChange(votes, items, apply);
        const { next, learned, undo } = applyPreferenceChange(current, change);
        return { next, feedback, result: { learned, undo } };
      });
      res.json({ ...outcome.result, feedbackIds: outcome.feedbackIds, preferences: outcome.preferences } satisfies FeedbackResult);
    } catch (error) { fail(res, error, "to save your calibration"); }
  });

  app.post("/api/inbox/:id/feedback", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    const parsed = feedbackSchema.safeParse(req.body);
    const id = storyId.safeParse(req.params.id);
    if (!parsed.success || !id.success) return res.status(400).json({ message: "Choose a reason." });
    const { reason, muteSource, lessAbout } = parsed.data;
    try {
      const outcome = await repository.update(authedOf(req).tenant, [id.data], (items, current) => {
        const item = items.find(entry => entry.id === id.data);
        if (!item) throw new StoryNotFound();
        const { change, feedback } = dismissChange(reason, item, { muteSource, lessAbout });
        const { next, learned, undo } = applyPreferenceChange(current, change);
        return { next, feedback: [feedback], result: { learned, undo } };
      });
      res.json({ ...outcome.result, feedbackIds: outcome.feedbackIds, preferences: outcome.preferences } satisfies FeedbackResult);
    } catch (error) { fail(res, error, "to save feedback"); }
  });

  app.get("/api/feed-preferences", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await repository.preferences(authedOf(req).tenant)); }
    catch (error) { fail(res, error, "to load feed preferences"); }
  });

  // Removes one learned item, or (Undo) reverts keys that still hold the value the change set; newer values are kept and reported.
  app.patch("/api/feed-preferences", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid feed preference change" });
    const body = parsed.data;
    const feedbackId = "feedbackId" in body ? body.feedbackId : undefined;
    try {
      // `current` is read under the row lock, so the compare and the write cannot interleave with another change.
      const outcome = await repository.update(authedOf(req).tenant, [], (_items, current) => {
        const restore = "restore" in body ? body.restore : removalRestore(current, "unmuteSource" in body ? { source: body.unmuteSource } : { keyword: body.resetKeyword });
        const { next, skipped } = restorePreferences(current, restore);
        return { next, feedback: [], deleteFeedbackIds: feedbackId ? [feedbackId] : [], result: skipped };
      });
      res.json({ preferences: outcome.preferences, skipped: outcome.result } satisfies FeedPreferencesChange);
    } catch (error) { fail(res, error, "to update feed preferences"); }
  });

  app.delete("/api/feed-preferences", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const { preferences, previous } = await repository.reset(authedOf(req).tenant);
      res.json({ preferences, previous, undo: resetRestore(previous) } satisfies FeedPreferencesReset);
    } catch (error) { fail(res, error, "to reset feed preferences"); }
  });
}
