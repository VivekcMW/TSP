import type { Request } from "express";
import { z } from "zod";
import { ALL_PLATFORM_KEYS } from "@shared/schema";
import { authedOf } from "../middlewares/requireDbUser";
import { storage } from "../storage";
import { editorialContext, editorialPreferences, reviewUrl, validateEditorialFormat } from "../routes/editorial-context";
import { AIGenerationError } from "./openRouter";
import { generatePlatformReviewsDetailed, type EditorialOptions } from "./punditBrain";
import { fetchArticleFromUrl, type FetchedArticle } from "./urlFetcher";
import { findPooledArticle } from "./articlePool";
import { publicationDate } from "./articleDates";
import { CrawlError } from "./crawlerFetch";
import { isGoogleNewsArticleUrl, resolveGoogleNewsArticleUrl } from "./keywordSearch";

// One link, so it can wait longer than the per-result budget during Discover refreshes.
const GOOGLE_NEWS_RESOLVE_TIMEOUT_MS = 5000;
const GOOGLE_NEWS_LINK_MESSAGE = "Google News hides the original link for this story. Open it, copy the publisher's link, and paste it here.";

/** Google News pages have no article body; read the publisher's page instead. */
async function publisherUrl(url: string, signal: AbortSignal): Promise<string> {
  if (!isGoogleNewsArticleUrl(url)) return url;
  const resolved = await resolveGoogleNewsArticleUrl(url, signal, GOOGLE_NEWS_RESOLVE_TIMEOUT_MS);
  if (isGoogleNewsArticleUrl(resolved)) throw new CrawlError("google-news", GOOGLE_NEWS_LINK_MESSAGE);
  return resolved;
}

/** Most Discover stories are already in the shared index with their page read; otherwise read the publisher live. */
async function readArticle(url: string, signal: AbortSignal): Promise<FetchedArticle> {
  const target = await publisherUrl(url, signal);
  const indexed = await findPooledArticle(target).catch(() => null);
  if (indexed?.readable && indexed.inputKind === "page_body" && indexed.content) {
    console.log("[shared-index] story read from the index");
    const publishedAt = indexed.publishedAt?.toISOString() ?? null;
    return {
      title: indexed.title, content: indexed.content, source: indexed.source, url: indexed.canonicalUrl,
      domain: new URL(indexed.canonicalUrl).hostname.replace(/^www\./, ""),
      contentMetadata: { extractionMethod: "index", originalLength: indexed.content.length, retainedLength: indexed.content.length, truncated: false },
      publishedAt, publicationDate: publicationDate(publishedAt, "rss-pubDate"),
    };
  }
  return fetchArticleFromUrl(target, signal);
}

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

/** Server execution context only; not part of admission, persistence, or dedupe. */
export interface EditorialExecutionContext {
  deadlineAt?: number;
  jobId?: string;
}
const executionBudgetSchema = z.object({
  timeoutMs: z.number().int().min(1).max(240_000).optional(),
  deadlineAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  jobId: z.string().uuid().optional(),
}).strict();

function preparedOptions({ voice, voiceScope, format, userContext, scope }: PreparedEditorialRequest["options"]): PreparedEditorialRequest["options"] {
  // Runtime allowlist too: arbitrary persisted preferences cannot set execution controls.
  return { voice, voiceScope, format, userContext, scope };
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
  const options = preparedOptions(await editorialContext(req, input, signal));
  return { input: { ...input, selectedPlatforms: [...new Set(input.selectedPlatforms)] }, options };
}

/** Same source fetch, evidence pipeline, and response contract for both transports. */
export async function executeEditorialRequest(prepared: PreparedEditorialRequest, signal: AbortSignal, onPlatformComplete?: EditorialOptions["onPlatformComplete"], timeoutMs?: number, context: EditorialExecutionContext = {}) {
  signal.throwIfAborted();
  const budget = executionBudgetSchema.safeParse({ ...context, timeoutMs });
  if (!budget.success) throw new AIGenerationError("ai_invalid_input");
  const deadlineAt = Math.min(timeoutMs === undefined ? Infinity : Date.now() + timeoutMs, budget.data.deadlineAt ?? Infinity);
  if (deadlineAt <= Date.now()) throw new AIGenerationError("ai_timeout");
  const { input, options } = prepared;
  const article = "url" in input ? await readArticle(input.url, signal) : {
    title: input.title, content: input.content, source: "Your draft", url: "",
    contentMetadata: { extractionMethod: "manual" as const, originalLength: input.content.length, retainedLength: input.content.length, truncated: false },
  };
  signal.throwIfAborted();
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new AIGenerationError("ai_timeout");
  // Attachments are returned for the editor, never treated as inspected evidence.
  const result = await generatePlatformReviewsDetailed(article, input.selectedPlatforms, { ...preparedOptions(options), signal,
    ...(input.tones ? { tones: input.tones } : {}),
    ...(onPlatformComplete ? { onPlatformComplete } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs: remaining }),
    ...(Number.isFinite(deadlineAt) ? { deadlineAt } : {}),
    ...(budget.data.jobId ? { jobId: budget.data.jobId } : {}) });
  signal.throwIfAborted();
  return { article: "media" in input ? { ...article, media: input.media, domain: "manual" } : article, ...result, format: input.format };
}