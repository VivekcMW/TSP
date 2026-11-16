import { createHash } from "node:crypto";
import { and, desc, gte, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { redis } from "../lib/redis";
import { pooledArticles } from "@shared/schema";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { getSearchEdition } from "@shared/search-editions";
import { hasSearchTerms, matchedNewsTerms, matchesNewsQuery, newsQueryWindow, parseNewsQuery, type ParsedNewsQuery } from "@shared/news-search";
import type { FetchedArticle } from "./engines/types.js";
import { fetchArticlesForQuery } from "./keywordSearch";
import { fetchBingArticlesForQuery } from "./bingNewsSearch";

/**
 * Keyword news search for the Inbox: the shared article pool plus live Google News and Bing,
 * merged, deduplicated by canonical URL, grouped by near-identical headline and ranked by
 * match quality, recency and source diversity. Results are the same for every member, so
 * they may be cached per edition and query; Inbox membership is added by the route.
 */
export const NEWS_SEARCH_MAX_RESULTS = 50;
export const NEWS_SEARCH_DEADLINE_MS = 6000;
const POOL_LIMIT = 80;
const PROVIDER_ITEMS = 8;
const SNIPPET_CHARS = 280;
const ALSO_COVERED_MAX = 5;
const CACHE_PREFIX = "news-search:v1";
const CACHE_TTL_SECONDS = 120;
const PARTIAL_CACHE_TTL_SECONDS = 30;
const CACHE_READ_TIMEOUT_MS = 300;
const BING_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export type NewsProvider = "pool" | "google" | "bing";
export type NewsProviderStatus = "ok" | "failed" | "skipped";
export interface NewsSearchHit {
  id: string; title: string; url: string; source: string; publishedAt: string | null; snippet: string;
  matchedTerms: string[]; alsoCoveredBy: Array<{ source: string; url: string }>;
}
export interface NewsSearchOutcome {
  query: { normalized: string; warnings: string[] };
  providers: Record<NewsProvider, NewsProviderStatus>;
  results: NewsSearchHit[];
}
export interface NewsSearchCache { get(key: string): Promise<string | null>; set(key: string, value: string, ttlSeconds: number): Promise<unknown> }
type Fetcher = (query: string, maxItems: number, searchEdition: string, signal?: AbortSignal) => Promise<FetchedArticle[]>;
export interface NewsSearchDeps {
  searchPool: (parsed: ParsedNewsQuery, window: { from: Date | null; to: Date | null }, limit: number) => Promise<FetchedArticle[]>;
  fetchGoogle: Fetcher;
  fetchBing: Fetcher;
  cache: NewsSearchCache | null;
  now: () => Date;
  deadlineMs: number;
}

const HOST_EXPRESSION = sql`lower(substring(${pooledArticles.canonicalUrl} from '^https?://(?:www\\.)?([^/:?#]+)'))`;
const likeContains = (value: string) => `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`;

/** Every required group, and none of the exclusions: (group) && (group) && (!!exclusion). Null without groups. */
function poolMatcher(parsed: ParsedNewsQuery): SQL | null {
  if (!parsed.textGroups.length) return null;
  const parts = [
    ...parsed.textGroups.map(text => sql`websearch_to_tsquery('english', ${text})`),
    ...parsed.textExclusions.map(text => sql`(!!websearch_to_tsquery('english', ${text}))`),
  ];
  return sql`(${sql.join(parts, sql` && `)})`;
}

/** Pool stories in the window matching the words (English stemming) and source/site filters. */
export async function searchArticlePool(parsed: ParsedNewsQuery, window: { from: Date | null; to: Date | null }, limit: number): Promise<FetchedArticle[]> {
  const filters: SQL[] = [];
  const matcher = poolMatcher(parsed);
  if (matcher) filters.push(sql`search @@ ${matcher}`);
  if (parsed.sources.length) filters.push(or(...parsed.sources.map(source => sql`${pooledArticles.source} ilike ${likeContains(source)}`))!);
  if (parsed.sites.length) filters.push(or(...parsed.sites.map(site => sql`(${HOST_EXPRESSION} = ${site} or ${HOST_EXPRESSION} like ${`%.${site}`})`))!);
  if (!filters.length) return [];
  if (window.from) filters.push(gte(pooledArticles.publishedAt, window.from));
  if (window.to) filters.push(lt(pooledArticles.publishedAt, window.to));
  const rows = await db.select({
    title: pooledArticles.title, link: pooledArticles.canonicalUrl, source: pooledArticles.source, sourceOrigin: pooledArticles.sourceOrigin,
    content: sql<string>`left(${pooledArticles.content}, 1000)`, publishedAt: pooledArticles.publishedAt,
  }).from(pooledArticles).where(and(...filters))
    .orderBy(...(matcher ? [sql`ts_rank(search, ${matcher}) desc`] : []), desc(pooledArticles.publishedAt))
    .limit(Math.max(1, Math.min(limit, POOL_LIMIT)));
  return rows.map(row => {
    const publishedAt = row.publishedAt?.toISOString() ?? null;
    return { title: row.title, link: row.link, source: row.source, sourceOrigin: row.sourceOrigin, content: row.content, categories: [], pubDate: publishedAt, publishedAt, inputKind: "feed_excerpt" as const };
  });
}

const redisCache: NewsSearchCache | null = redis ? { get: key => redis!.get(key), set: (key, value, ttl) => redis!.set(key, value, "EX", ttl) } : null;

export const defaultNewsSearchDeps: NewsSearchDeps = {
  searchPool: searchArticlePool, fetchGoogle: fetchArticlesForQuery, fetchBing: fetchBingArticlesForQuery,
  cache: redisCache, now: () => new Date(), deadlineMs: NEWS_SEARCH_DEADLINE_MS,
};

interface Candidate {
  provider: NewsProvider; providers: Set<NewsProvider>; title: string; url: string; key: string; source: string;
  publishedAt: number | null; snippet: string; score: number; matchedTerms: string[];
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const hostOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");
/** Looser than the canonical URL: scheme, "www." and a trailing slash do not make a different story. */
function dedupeKey(url: string): string {
  const parsed = new URL(url);
  return `${hostOf(url)}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
}
function cleanTitle(title: string, source: string): string {
  const text = collapse(title);
  const suffix = ` - ${source}`;
  // Google News appends " - <publication>" to every headline.
  return (source && text.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase()) ? text.slice(0, -suffix.length) : text).trim().slice(0, 300);
}
function cleanSnippet(content: string, title: string, source: string): string {
  let text = collapse(content);
  if (text.toLocaleLowerCase().startsWith(title.toLocaleLowerCase())) text = text.slice(title.length).trim();
  if (!text || text.toLocaleLowerCase() === source.toLocaleLowerCase()) return "";
  if (text.length <= SNIPPET_CHARS) return text;
  const cut = text.slice(0, SNIPPET_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), SNIPPET_CHARS - 40)).trimEnd()}\u2026`;
}
function parseTime(value: string | null | undefined): number | null {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

function toCandidate(article: FetchedArticle, provider: NewsProvider): Candidate | null {
  const url = canonicalHttpUrl(article.link ?? "");
  if (!url) return null;
  const source = collapse(article.source ?? "").slice(0, 200) || hostOf(url);
  const title = cleanTitle(article.title ?? "", source);
  if (!title) return null;
  return {
    provider, providers: new Set([provider]), title, url, key: dedupeKey(url), source, snippet: cleanSnippet(article.content ?? "", title, source),
    publishedAt: parseTime(article.publishedAt ?? article.pubDate), score: 0, matchedTerms: [],
  };
}

function scoreCandidate(candidate: Candidate, parsed: ParsedNewsQuery, now: number): number {
  const inTitle = new Set(matchedNewsTerms({ title: candidate.title }, parsed));
  const inSnippet = new Set(matchedNewsTerms({ title: "", snippet: candidate.snippet }, parsed));
  let score = 0;
  let allInTitle = parsed.groups.length > 0;
  for (const group of parsed.groups) {
    const titleHit = group.find(term => inTitle.has(term.text));
    if (titleHit) score += titleHit.kind === "phrase" ? 4.5 : 3;
    else { allInTitle = false; if (group.some(term => inSnippet.has(term.text))) score += 1; }
  }
  if (allInTitle) score += 2;
  if (candidate.publishedAt !== null) score += 3 * Math.exp(-Math.max(0, now - candidate.publishedAt) / (72 * 3_600_000));
  return score + 0.5 * (candidate.providers.size - 1);
}

const STOP_WORDS = new Set(["a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are", "as", "at", "by", "with", "from", "its", "it", "be", "this", "that", "after", "over", "says", "new"]);
function headlineWords(title: string): Set<string> {
  const words = title.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter(word => word.length > 1 && !STOP_WORDS.has(word)).map(word => word.replace(/(?<=\w{3})s$/, "")));
}
/** Same story from another outlet: near-identical headlines (word overlap), or identical ones. */
function sameStory(a: Set<string>, b: Set<string>, rawA: string, rawB: string): boolean {
  if (collapse(rawA).toLocaleLowerCase() === collapse(rawB).toLocaleLowerCase()) return true;
  if (a.size < 4 || b.size < 4) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared) >= 0.7;
}

const sourceKey = (candidate: Candidate) => candidate.source.toLocaleLowerCase();
const byScore = (a: Candidate, b: Candidate) => b.score - a.score || (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || a.title.localeCompare(b.title);

/** Highest score first, but each further story from the same source pays a penalty. */
function diversify(ranked: Candidate[], penalty = 2): Candidate[] {
  const remaining = [...ranked].sort(byScore);
  const perSource = new Map<string, number>();
  const ordered: Candidate[] = [];
  while (remaining.length) {
    let bestIndex = 0, best = -Infinity;
    remaining.forEach((candidate, index) => {
      const adjusted = candidate.score - penalty * (perSource.get(sourceKey(candidate)) ?? 0);
      if (adjusted > best) { best = adjusted; bestIndex = index; }
    });
    const [picked] = remaining.splice(bestIndex, 1);
    perSource.set(sourceKey(picked), (perSource.get(sourceKey(picked)) ?? 0) + 1);
    ordered.push(picked);
  }
  return ordered;
}

const PROVIDER_ORDER: NewsProvider[] = ["pool", "google", "bing"];

/** Filters, merges by URL, groups by headline and ranks. Pure apart from the hash. */
export function mergeNewsResults(batches: Partial<Record<NewsProvider, FetchedArticle[]>>, parsed: ParsedNewsQuery, now: Date): NewsSearchHit[] {
  const byKey = new Map<string, Candidate>();
  for (const provider of PROVIDER_ORDER) {
    for (const article of batches[provider] ?? []) {
      const candidate = toCandidate(article, provider);
      if (!candidate) continue;
      // The pool's full-text search, or a provider given the whole query without OR, already matched the article body.
      const requireTerms = provider !== "pool" && !parsed.providerComplete;
      if (!matchesNewsQuery({ ...candidate, publishedAt: candidate.publishedAt === null ? null : new Date(candidate.publishedAt) }, parsed, { now, requireTerms })) continue;
      const known = byKey.get(candidate.key);
      if (!known) { byKey.set(candidate.key, candidate); continue; }
      known.providers.add(provider);
      known.publishedAt ??= candidate.publishedAt;
      if (!known.snippet) known.snippet = candidate.snippet;
    }
  }
  const candidates = [...byKey.values()];
  for (const candidate of candidates) {
    candidate.score = scoreCandidate(candidate, parsed, now.getTime());
    candidate.matchedTerms = matchedNewsTerms(candidate, parsed);
  }
  const groups: Array<{ primary: Candidate; words: Set<string>; members: Candidate[] }> = [];
  for (const candidate of [...candidates].sort(byScore)) {
    const words = headlineWords(candidate.title);
    const group = groups.find(entry => sameStory(entry.words, words, entry.primary.title, candidate.title));
    if (group) group.members.push(candidate);
    else groups.push({ primary: candidate, words, members: [] });
  }
  for (const group of groups) group.primary.score += Math.min(3, 0.75 * group.members.length);
  const alsoCovered = new Map(groups.map(group => [group.primary, group.members] as const));
  return diversify(groups.map(group => group.primary)).map(primary => {
    const seen = new Set([sourceKey(primary)]);
    const others = (alsoCovered.get(primary) ?? []).filter(member => !seen.has(sourceKey(member)) && Boolean(seen.add(sourceKey(member))));
    return {
      id: createHash("sha256").update(primary.key).digest("hex").slice(0, 16), title: primary.title, url: primary.url, source: primary.source,
      publishedAt: primary.publishedAt === null ? null : new Date(primary.publishedAt).toISOString(), snippet: primary.snippet,
      matchedTerms: primary.matchedTerms, alsoCoveredBy: others.slice(0, ALSO_COVERED_MAX).map(member => ({ source: member.source, url: member.url })),
    };
  });
}

/** Google News reads after:/before:/when: itself; only appended when the query stays within its 100 characters. */
function googleQuery(parsed: ParsedNewsQuery, window: { from: Date | null; to: Date | null }, now: Date): string {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const dates = window.to
    ? [`before:${day(window.to)}`, ...(window.from ? [`after:${day(window.from)}`] : [])]
    : window.from ? [`when:${Math.max(1, Math.ceil((now.getTime() - window.from.getTime()) / DAY_MS))}d`] : [];
  const full = [parsed.providerQuery, ...dates].join(" ");
  return full.length <= 100 ? full : parsed.providerQuery;
}

function cacheKey(edition: string, parsed: ParsedNewsQuery): string {
  return `${CACHE_PREFIX}:${edition}:${createHash("sha256").update(parsed.normalized.toLocaleLowerCase()).digest("hex")}`;
}
async function readCache(cache: NewsSearchCache | null, key: string): Promise<Omit<NewsSearchOutcome, "query"> | null> {
  if (!cache) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hit = await Promise.race([cache.get(key), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), CACHE_READ_TIMEOUT_MS); })]);
    const value = hit ? JSON.parse(hit) as Omit<NewsSearchOutcome, "query"> : null;
    return value && Array.isArray(value.results) && value.providers ? value : null;
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}

const skippedAll = (): Record<NewsProvider, NewsProviderStatus> => ({ pool: "skipped", google: "skipped", bing: "skipped" });

export async function searchNews(input: { query: string; edition: string; limit: number }, deps: NewsSearchDeps = defaultNewsSearchDeps): Promise<NewsSearchOutcome> {
  const parsed = parseNewsQuery(input.query);
  const query = { normalized: parsed.normalized, warnings: parsed.warnings };
  const limit = Math.max(1, Math.min(NEWS_SEARCH_MAX_RESULTS, Math.floor(input.limit) || NEWS_SEARCH_MAX_RESULTS));
  if (!hasSearchTerms(parsed)) return { query, providers: skippedAll(), results: [] };
  const edition = getSearchEdition(input.edition).id;
  const key = cacheKey(edition, parsed);
  const cached = await readCache(deps.cache, key);
  if (cached) return { query, providers: cached.providers, results: cached.results.slice(0, limit) };

  const now = deps.now();
  const window = newsQueryWindow(parsed, now);
  const controller = new AbortController();
  const deadline = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("News search deadline")), { once: true }));
  deadline.catch(() => undefined);
  const timer = setTimeout(() => controller.abort(), deps.deadlineMs);
  const bingTooOld = window.to !== null && window.to.getTime() <= now.getTime() - BING_WINDOW_DAYS * DAY_MS;
  const tasks: Record<NewsProvider, (() => Promise<FetchedArticle[]>) | null> = {
    pool: parsed.textGroups.length || parsed.sources.length || parsed.sites.length ? () => deps.searchPool(parsed, window, POOL_LIMIT) : null,
    google: parsed.providerQuery ? () => deps.fetchGoogle(googleQuery(parsed, window, now), PROVIDER_ITEMS, edition, controller.signal) : null,
    bing: parsed.providerQuery && !bingTooOld ? () => deps.fetchBing(parsed.providerQuery, PROVIDER_ITEMS, edition, controller.signal) : null,
  };
  const settled = await Promise.allSettled(PROVIDER_ORDER.map(provider => {
    const task = tasks[provider];
    return task ? Promise.race([Promise.resolve().then(task), deadline]) : Promise.resolve(null);
  }));
  clearTimeout(timer);
  controller.abort();

  const providers = skippedAll();
  const batches: Partial<Record<NewsProvider, FetchedArticle[]>> = {};
  PROVIDER_ORDER.forEach((provider, index) => {
    const outcome = settled[index];
    if (!tasks[provider]) return;
    if (outcome.status === "fulfilled" && Array.isArray(outcome.value)) { providers[provider] = "ok"; batches[provider] = outcome.value; }
    else providers[provider] = "failed";
  });
  const results = mergeNewsResults(batches, parsed, now).slice(0, NEWS_SEARCH_MAX_RESULTS);
  const statuses = Object.values(providers);
  const cache = deps.cache;
  if (cache && statuses.includes("ok")) {
    const ttl = statuses.includes("failed") ? PARTIAL_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS;
    void Promise.resolve().then(() => cache.set(key, JSON.stringify({ providers, results }), ttl)).catch(() => undefined);
  }
  return { query, providers, results: results.slice(0, limit) };
}
