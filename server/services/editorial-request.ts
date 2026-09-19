import type { Request } from "express";
import { z } from "zod";
import { ALL_PLATFORM_KEYS } from "@shared/schema";
import { authedOf } from "../middlewares/requireDbUser";
import { storage } from "../storage";
import { editorialContext, editorialPreferences, reviewUrl, validateEditorialFormat } from "../routes/editorial-context";
import { AIGenerationError } from "./openRouter";
import { generatePlatformReviewsDetailed, type EditorialOptions } from "./punditBrain";
import { fetchArticleFromUrl } from "./urlFetcher";

const selection = z.array(z.enum(ALL_PLATFORM_KEYS)).min(1).max(4);
const requestIntent = z.string().uuid().optional();
export const selectedReviewSchema = z.object({ ...editorialPreferences, requestIntent, url: reviewUrl, selectedPlatforms: selection });
export const manualReviewSchema = z.object({
  ...editorialPreferences,
  requestIntent,
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(20).max(20_000),
  media: z.array(z.object({ id: z.string().uuid().optional(), type: z.enum(["image", "video", "audio"]), name: z.string().max(255), url: z.string().max(2_000) })).max(8).default([]),
  selectedPlatforms: selection.default(["linkedin"]),
});

export type EditorialKind = "selected" | "manual";
export interface PreparedEditorialRequest {
  input: z.infer<typeof selectedReviewSchema> | z.infer<typeof manualReviewSchema>;
  options: Pick<EditorialOptions, "voice" | "voiceScope" | "format" | "userContext" | "scope">;
}

/** Shared by HTTP and queue admission: never persist a Request, user row, or headers. */
export async function prepareEditorialRequest(req: Request, kind: EditorialKind, signal: AbortSignal): Promise<PreparedEditorialRequest> {
  const parsed = (kind === "manual" ? manualReviewSchema : selectedReviewSchema).safeParse(req.body);
  if (!parsed.success) throw new AIGenerationError("ai_invalid_input");
  const input = parsed.data;
  validateEditorialFormat(input.selectedPlatforms, input.format);
  if ("media" in input) {
    const scope = authedOf(req).tenant;
    for (const item of input.media) {
      if (item.id && !(await storage.getMediaAsset(scope, item.id))) {
        throw Object.assign(new Error("An attached media item is not available to this account"), { status: 403 });
      }
    }
  }
  const { signal: _signal, ...options } = await editorialContext(req, input, signal);
  return { input: { ...input, selectedPlatforms: [...new Set(input.selectedPlatforms)] }, options };
}

/** Same source fetch, evidence pipeline, and response contract for both transports. */
export async function executeEditorialRequest(prepared: PreparedEditorialRequest, signal: AbortSignal, onPlatformComplete?: EditorialOptions["onPlatformComplete"], timeoutMs?: number) {
  signal.throwIfAborted();
  const { input, options } = prepared;
  const article = "url" in input ? await fetchArticleFromUrl(input.url, signal) : {
    title: input.title, content: input.content, source: "Your draft", url: "",
    contentMetadata: { extractionMethod: "manual" as const, originalLength: input.content.length, retainedLength: input.content.length, truncated: false },
  };
  // Attachments are returned for the editor, never treated as inspected evidence.
  const result = await generatePlatformReviewsDetailed(article, input.selectedPlatforms, { ...options, signal,
    ...(onPlatformComplete ? { onPlatformComplete } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  signal.throwIfAborted();
  return { article: "media" in input ? { ...article, media: input.media, domain: "manual" } : article, ...result, format: input.format };
}