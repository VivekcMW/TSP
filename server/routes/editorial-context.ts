import type { Request, Response } from "express";
import { z } from "zod";
import { EDITORIAL_TONES, supportsArticle } from "@shared/editorial";
import { authedOf } from "../middlewares/requireDbUser";
import { storage } from "../storage";
import { AIGenerationError } from "../services/openRouter";
import type { EditorialOptions } from "../services/punditBrain";

export const editorialPreferences = {
  format: z.enum(["short-post", "article"]).default("short-post"),
  userContext: z.string().trim().max(4000).optional(),
  tones: z.array(z.enum(EDITORIAL_TONES)).min(1).max(EDITORIAL_TONES.length).optional(),
};
export const reviewUrl = z.string().trim().min(1).max(2048).refine(value => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, "Use a public HTTP(S) URL without credentials");

export function validateEditorialFormat(platforms: string[], format: EditorialOptions["format"]) {
  if (format === "article" && platforms.some(platform => !supportsArticle(platform))) {
    throw new AIGenerationError("ai_invalid_input");
  }
}

/** Listen to response close, not request close (which also fires after reading a POST). */
export function editorialCancellation(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(new AIGenerationError("ai_cancelled")); };
  req.once("aborted", abort);
  res.once("close", abort);
  if ((req.destroyed && !req.complete) || res.destroyed) abort();
  return { signal: controller.signal, dispose: () => { req.off("aborted", abort); res.off("close", abort); } };
}

/** Caller passes only validated preferences. Identity and saved voice never come from body. */
export async function editorialContext(req: Request, preferences: Pick<EditorialOptions, "format" | "userContext">, signal: AbortSignal): Promise<EditorialOptions> {
  const scope = authedOf(req).tenant;
  const profile = await storage.getUserProfile(scope);
  signal.throwIfAborted();
  const voice = profile ? JSON.stringify({
    defaultTone: profile.defaultTone?.slice(0, 100),
    professionalFocus: profile.focusDescription?.slice(0, 500),
  }) : undefined;
  return { scope: { tenantId: scope.tenantId }, voiceScope: { tenantId: scope.tenantId, userId: scope.userId }, voice, format: preferences.format, userContext: preferences.userContext, signal };
}