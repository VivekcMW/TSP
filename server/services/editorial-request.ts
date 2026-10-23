import type { Request } from "express";
import { z } from "zod";
import { ALL_PLATFORM_KEYS } from "@shared/schema";
import { authedOf } from "../middlewares/requireDbUser";
import { storage } from "../storage";
import { editorialContext, editorialPreferences, reviewUrl, validateEditorialFormat } from "../routes/editorial-context";
import { AIGenerationError } from "./openRouter";
import { generateMainDraftDetailed, generatePlatformReviewsDetailed, type EditorialOptions } from "./punditBrain";
import { fetchArticleFromUrl, type FetchedArticle } from "./urlFetcher";
import { findPooledArticle } from "./articlePool";
import { publicationDate } from "./articleDates";
import { CrawlError } from "./crawlerFetch";
import { isGoogleNewsArticleUrl, resolveGoogleNewsArticleUrl } from "./keywordSearch";
import { MAX_CREATION_REFERENCES } from "@shared/creation-session";
import { buildEvidenceBrief, MAX_SOURCE_CHARACTERS, MAX_SOURCE_PASSAGES } from "./editorialEvidence";

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
  try {
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
    return await fetchArticleFromUrl(target, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CrawlError) throw new CrawlError(error.code,
      `${new URL(url).hostname}: ${error.message}`, [{ url, message: error.message }]);
    throw error;
  }
}

const selection = z.array(z.enum(ALL_PLATFORM_KEYS)).max(4);
const requestIntent = z.string().uuid().optional();
const stage = z.enum(["main", "platform"]).optional();
const draftEditing = {
  instruction: z.string().trim().min(1).max(4000).optional(),
  currentDraft: z.string().max(5000).optional(),
};
const validSelection = (input: { stage?: "main" | "platform"; selectedPlatforms: string[] }) =>
  input.stage === "main" ? input.selectedPlatforms.length === 0 : input.selectedPlatforms.length > 0;
export const selectedReviewSchema = z.object({ ...editorialPreferences, ...draftEditing, requestIntent, stage, url: reviewUrl, selectedPlatforms: selection }).refine(validSelection);
export const manualReviewSchema = z.object({
  ...editorialPreferences,
  ...draftEditing,
  requestIntent,
  stage,
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().max(24_000),
  media: z.array(z.object({ id: z.string().uuid().optional(), type: z.enum(["image", "video", "audio"]), name: z.string().max(255), url: z.string().max(2_000) })).max(8).default([]),
  selectedPlatforms: selection.default(["linkedin"]),
  sourceUrl: reviewUrl.optional(),
  sourceLabel: z.string().trim().min(1).max(300).optional(),
  sourceUrls: z.array(reviewUrl).min(1).max(MAX_CREATION_REFERENCES).optional(),
}).refine(validSelection).refine(input => input.sourceUrls
  ? input.stage === "main" : input.content.length >= 20 && input.content.length <= (input.stage === "main" ? 24_000 : 20_000));

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
    for (const url of input.sourceUrls ?? []) {
      if (!await storage.getInboxItemByUrl(scope, url)) {
        throw Object.assign(new Error("A selected article is no longer available in this workspace. Refresh your sources."), { status: 404 });
      }
      signal.throwIfAborted();
    }
  }
  const options = preparedOptions(await editorialContext(req, input, signal));
  return { input: { ...input, selectedPlatforms: [...new Set(input.selectedPlatforms)] }, options };
}

async function readSelectedArticles(urls: string[], prepared: PreparedEditorialRequest, signal: AbortSignal) {
  const scope = prepared.options.voiceScope;
  if (!scope) throw new AIGenerationError("ai_invalid_input");
  const unique = [...new Set(urls)];
  const results = await Promise.allSettled(unique.map(async url => {
    if (!await storage.getInboxItemByUrl(scope, url)) {
      throw new AIGenerationError("ai_invalid_input");
    }
    signal.throwIfAborted();
    return readArticle(url, signal);
  }));
  signal.throwIfAborted();
  const articles: FetchedArticle[] = [];
  const failures: CrawlError["sources"] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") articles.push(result.value);
    else if (result.reason instanceof CrawlError) failures.push({ url: unique[index], message: result.reason.message });
    else throw result.reason;
  }
  if (failures.length) throw new CrawlError("sources",
    `Could not read ${failures.map(source => new URL(source.url).hostname).join(", ")}. No draft was generated and no selected sources were skipped.`, failures);
  const headers = articles.map(article => `Source: ${article.source}\nTitle: ${article.title}\nURL: ${article.url}\n`);
  const available = MAX_SOURCE_CHARACTERS - headers.reduce((total, text) => total + text.length + 2, 0);
  if (available < articles.length * 20) throw new AIGenerationError("ai_invalid_input");
  const perArticle = Math.floor(available / articles.length);
  const passagesPerArticle = Math.floor(MAX_SOURCE_PASSAGES / articles.length);
  const content = articles.map((article, index) => {
    const section = headers[index] + article.content.slice(0, perArticle);
    // Reserve passage slots as well as characters so dense first sources cannot
    // displace every later source when the writer's evidence brief is built.
    const passages = buildEvidenceBrief({ ...article, content: section }).excerpts.slice(0, passagesPerArticle);
    const last = passages.at(-1);
    if (!last) throw new AIGenerationError("ai_invalid_input");
    return section.slice(0, last.end);
  }).join("\n\n");
  const originalLength = articles.reduce((total, article, index) => total + headers[index].length +
    Math.max(article.content.length, article.contentMetadata?.originalLength ?? 0), (articles.length - 1) * 2);
  return { ...articles[0], content,
    references: articles.map(({ title, source, url }) => ({ title, source, url })),
    contentMetadata: {
      extractionMethod: articles.some(article => article.contentMetadata?.extractionMethod === "metadata") ? "metadata" as const : "article" as const,
      originalLength, retainedLength: content.length, truncated: originalLength > content.length,
    },
  };
}

/** Same source fetch, evidence pipeline, and response contract for both transports. */
export async function executeEditorialRequest(prepared: PreparedEditorialRequest, signal: AbortSignal, onPlatformComplete?: EditorialOptions["onPlatformComplete"], timeoutMs?: number, context: EditorialExecutionContext = {}) {
  signal.throwIfAborted();
  const budget = executionBudgetSchema.safeParse({ ...context, timeoutMs });
  if (!budget.success) throw new AIGenerationError("ai_invalid_input");
  const deadlineAt = Math.min(timeoutMs === undefined ? Infinity : Date.now() + timeoutMs, budget.data.deadlineAt ?? Infinity);
  if (deadlineAt <= Date.now()) throw new AIGenerationError("ai_timeout");
  const { input, options } = prepared;
  const article = "url" in input ? await readArticle(input.url, signal) : input.sourceUrls
    ? { ...await readSelectedArticles(input.sourceUrls, prepared, signal), title: input.title } : {
    title: input.title, content: input.content, source: input.sourceLabel ?? "Your draft", url: input.sourceUrl ?? "",
    contentMetadata: { extractionMethod: "manual" as const, originalLength: input.content.length, retainedLength: input.content.length, truncated: false },
  };
  signal.throwIfAborted();
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new AIGenerationError("ai_timeout");
  // Attachments are returned for the editor, never treated as inspected evidence.
  const executionOptions = { ...preparedOptions(options), signal,
    ...(input.stage === "platform" ? { adaptReviewedDraft: true } : {}),
    ...(input.stage === "main" ? { draftInstruction: input.instruction, currentDraft: input.currentDraft } : {}),
    ...(input.tones ? { tones: input.tones } : {}),
    ...(onPlatformComplete ? { onPlatformComplete } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs: remaining }),
    ...(Number.isFinite(deadlineAt) ? { deadlineAt } : {}),
    ...(budget.data.jobId ? { jobId: budget.data.jobId } : {}) };
  const result = input.stage === "main" ? await generateMainDraftDetailed(article, executionOptions)
    : await generatePlatformReviewsDetailed(article, input.selectedPlatforms, executionOptions);
  signal.throwIfAborted();
  return { article: "media" in input ? { ...article, media: input.media, domain: "manual" } : article, ...result, format: input.format };
}