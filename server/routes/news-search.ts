import type { Express } from "express";
import net from "node:net";
import { z } from "zod";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { newsSearchRateLimit, newsSearchWriteRateLimit } from "../middlewares/rateLimit";
import { storage, type TenantScope } from "../storage";
import { NEWS_SEARCH_MAX_RESULTS, searchNews, type NewsSearchHit } from "../services/newsSearch";
import { validateUrlSync } from "../services/urlValidator";
import {
  createSavedSearch, deleteSavedSearch, findInboxItemsByCanonicalUrls, listSavedSearches, markSavedSearchViewed, renameSavedSearch,
  SAVED_SEARCH_NAME_MAX, SavedSearchLimitError,
} from "../repositories/savedSearches";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { hasSearchTerms, NEWS_QUERY_LIMITS, parseNewsQuery } from "@shared/news-search";

const DEFAULT_LIMIT = 30;
const searchSchema = z.object({
  q: z.string().trim().min(1).max(NEWS_QUERY_LIMITS.chars),
  limit: z.coerce.number().int().min(1).max(NEWS_SEARCH_MAX_RESULTS).optional(),
});
// Only these fields are read; tenant and user always come from the session.
const saveSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  title: z.string().trim().min(1).max(500),
  source: z.string().trim().min(1).max(200),
  publishedAt: z.string().datetime({ offset: true }).nullish(),
  snippet: z.string().trim().max(1000).nullish(),
});
const createSchema = z.object({
  query: z.string().trim().min(1).max(NEWS_QUERY_LIMITS.chars),
  name: z.string().trim().min(1).max(SAVED_SEARCH_NAME_MAX).optional(),
});
const renameSchema = z.object({ name: z.string().trim().min(1).max(SAVED_SEARCH_NAME_MAX) });
const idSchema = z.string().min(1).max(100);

/** A public http(s) article address in canonical form, or null. Saving never fetches it. */
export function safeArticleUrl(value: string): string | null {
  const canonical = canonicalHttpUrl(value);
  if (!canonical || !validateUrlSync(canonical)) return null;
  const host = new URL(canonical).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(host) || !host.includes(".") || /\.(local|localhost|internal|lan|home|invalid)$/.test(host)) return null;
  return canonical;
}

const searchName = (normalized: string) => normalized.length <= SAVED_SEARCH_NAME_MAX ? normalized : `${normalized.slice(0, SAVED_SEARCH_NAME_MAX - 1).trimEnd()}\u2026`;

/**
 * Which results the caller already has, by canonical URL of the story or another outlet's copy.
 * `url` is the copy they have, so the client can act on that item instead of saving a duplicate.
 */
async function withInboxState(scope: TenantScope, results: NewsSearchHit[]) {
  const urlsOf = (result: NewsSearchHit) => [result.url, ...result.alsoCoveredBy.map(entry => entry.url)];
  let known = new Map<string, { id: string; status: string; url: string }>();
  try {
    const rows = await findInboxItemsByCanonicalUrls(scope, results.flatMap(urlsOf));
    known = new Map(rows.map(row => [row.canonicalUrl, { id: row.id, status: row.status, url: row.canonicalUrl }]));
  } catch {
    console.error("[newsSearch] Inbox lookup failed; results are shown without Inbox state.");
  }
  return results.map(result => ({ ...result, inInbox: urlsOf(result).map(url => known.get(url)).find(Boolean) ?? null }));
}

/** Phase 3A: keyword news search (GET /api/search/news) and saved searches (/api/searches). */
export function registerNewsSearchRoutes(app: Express) {
  app.get("/api/search/news", requireDbUser, requirePermission("inbox:read:own"), newsSearchRateLimit, async (req, res) => {
    // Results carry this member's Inbox state.
    res.setHeader("Cache-Control", "private, no-store");
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: `Enter a search of 1 to ${NEWS_QUERY_LIMITS.chars} characters.` });
    try {
      const scope = authedOf(req).tenant;
      const profile = await storage.getUserProfile(scope);
      const outcome = await searchNews({ query: parsed.data.q, edition: profile?.searchEdition ?? "en-US", limit: parsed.data.limit ?? DEFAULT_LIMIT });
      res.json({ ...outcome, results: await withInboxState(scope, outcome.results) });
    } catch {
      console.error("[newsSearch] Search failed.");
      res.status(500).json({ message: "Search failed. Please try again." });
    }
  });

  app.post("/api/search/news/save", requireDbUser, requirePermission("inbox:write:own"), newsSearchWriteRateLimit, async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Choose a story with a title, a source and a link." });
    const articleUrl = safeArticleUrl(parsed.data.url);
    if (!articleUrl) return res.status(400).json({ message: "This link can't be saved. Use a public http or https address." });
    const published = parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null;
    try {
      const scope = authedOf(req).tenant;
      const { item, alreadyExists } = await storage.addInboxItem(scope, {
        headline: parsed.data.title, source: parsed.data.source, articleUrl, summary: parsed.data.snippet || null,
        matchedKeywords: [], relevanceScore: "0", relevanceReason: "Saved from a news search; relevance has not been scored.",
        // Shortlist, not For you: For you has a capacity limit and saving must always work.
        status: "saved", publishedAt: published && published.getTime() <= Date.now() + 86_400_000 ? published : null,
      });
      if (alreadyExists && item.status === "dismissed") return res.json(await storage.updateInboxItem(scope, item.id, { status: "saved" }) ?? item);
      res.status(alreadyExists ? 200 : 201).json(item);
    } catch {
      console.error("[newsSearch] Saving a search result failed.");
      res.status(500).json({ message: "Couldn't save the story. Please try again." });
    }
  });

  app.get("/api/searches", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    try { res.json(await listSavedSearches(authedOf(req).tenant)); }
    catch { console.error("[newsSearch] Listing saved searches failed."); res.status(500).json({ message: "Failed to load followed searches" }); }
  });

  app.post("/api/searches", requireDbUser, requirePermission("inbox:write:own"), newsSearchWriteRateLimit, async (req, res) => {
    const input = createSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: `Enter a search of 1 to ${NEWS_QUERY_LIMITS.chars} characters.` });
    const parsed = parseNewsQuery(input.data.query);
    if (!hasSearchTerms(parsed)) return res.status(400).json({ message: "Add a word, a \u201cphrase\u201d or source: to follow." });
    try {
      const { search, created } = await createSavedSearch(authedOf(req).tenant, { query: parsed.normalized, name: input.data.name ?? searchName(parsed.normalized) });
      res.status(created ? 201 : 200).json(search);
    } catch (error) {
      if (error instanceof SavedSearchLimitError) return res.status(409).json({ message: error.message });
      console.error("[newsSearch] Following a search failed.");
      res.status(500).json({ message: "Couldn't follow this search. Please try again." });
    }
  });

  app.patch("/api/searches/:id", requireDbUser, requirePermission("inbox:write:own"), newsSearchWriteRateLimit, async (req, res) => {
    const input = renameSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: `Enter a name of 1 to ${SAVED_SEARCH_NAME_MAX} characters.` });
    const id = idSchema.safeParse(req.params.id);
    try {
      const search = id.success ? await renameSavedSearch(authedOf(req).tenant, id.data, input.data.name) : undefined;
      if (!search) return res.status(404).json({ message: "Search not found" });
      res.json(search);
    } catch { console.error("[newsSearch] Renaming a search failed."); res.status(500).json({ message: "Couldn't rename the search" }); }
  });

  app.delete("/api/searches/:id", requireDbUser, requirePermission("inbox:write:own"), newsSearchWriteRateLimit, async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    try {
      if (!id.success || !await deleteSavedSearch(authedOf(req).tenant, id.data)) return res.status(404).json({ message: "Search not found" });
      res.json({ success: true });
    } catch { console.error("[newsSearch] Removing a search failed."); res.status(500).json({ message: "Couldn't stop following the search" }); }
  });

  app.post("/api/searches/:id/viewed", requireDbUser, requirePermission("inbox:write:own"), newsSearchWriteRateLimit, async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    try {
      const search = id.success ? await markSavedSearchViewed(authedOf(req).tenant, id.data) : undefined;
      if (!search) return res.status(404).json({ message: "Search not found" });
      res.json(search);
    } catch { console.error("[newsSearch] Marking a search viewed failed."); res.status(500).json({ message: "Couldn't update the search" }); }
  });
}
