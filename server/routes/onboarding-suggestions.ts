import type { Express } from "express";
import { onboardingSuggestionRateLimit } from "../middlewares/rateLimit";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { onboardingSuggestionRequestSchema, suggestOnboardingItems } from "../services/onboardingSuggestions";
import { AIGenerationError, getAIErrorResponse } from "../services/openRouter";

const SUGGESTION_BUDGET_MS = 25_000;

export function registerOnboardingSuggestionRoutes(app: Express) {
  app.post("/api/onboarding/suggestions", requireDbUser, requirePermission("generation:create:own"), onboardingSuggestionRateLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = onboardingSuggestionRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "invalid_request", message: "Provide a step and a focus of 10–500 characters." });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new AIGenerationError("ai_timeout")), SUGGESTION_BUDGET_MS);
    // Stop provider and search work when the user leaves the step.
    res.on("close", () => { if (!res.writableFinished) controller.abort(new AIGenerationError("ai_cancelled")); });
    try {
      res.json(await suggestOnboardingItems(parsed.data, { tenantId: authedOf(req).tenant.tenantId }, controller.signal));
    } catch (error) {
      const failure = getAIErrorResponse(controller.signal.aborted ? controller.signal.reason : error);
      if (failure.retryAfterSeconds) res.setHeader("Retry-After", String(failure.retryAfterSeconds));
      if (!res.headersSent) res.status(failure.status).json(failure.body);
    } finally {
      clearTimeout(timer);
    }
  });
}
