import { validateUrlSync } from "../urlValidator.js";
import { resolvePublicationSources } from "../publicationSources.js";
import { CrawlError, crawlErrorMessage, fetchPublicText, mapCrawlSettled } from "../crawlerFetch.js";
import { fetchArticlesForQuery, isGoogleNewsArticleUrl, resolveGoogleNewsArticleUrl } from "../keywordSearch.js";
import { parseFeedContent } from "../universalFeedParser.js";
import { scrapeWebpageArticles } from "../webpageScraper.js";
import { getCachedArticles } from "./articleCache.js";
import { scoreArticleRelevance } from "../articleRelevance.js";
import { freshnessMultiplier, type ArticleQuality, type PersonalTrend } from "@shared/article-quality";
import { publicationDate } from "../articleDates";
import { summarizeArticle } from "../articleSummary";
import { diversityFeatures, sourceOrigin } from "../inboxDiversity";
import { personalTrends } from "../personalTrends";
import type {
  IIndustryEngine,
  EngineConfig,
  FetchedArticle,
  ScoredArticle,
  EngineRunResult,
  RSSFeedConfig,
} from "./types.js";
import type { UserProfile } from "@shared/schema";
import { getSearchEdition } from "@shared/search-editions";
import { storage, type TenantScope } from "../../storage.js";
import { randomUUID } from "node:crypto";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { INBOX_CAPACITY, INBOX_CANDIDATE_LIMIT, InboxOperationConflictError, inboxRefreshMessage, type InboxRefreshOptions } from "@shared/inbox-refresh";

const KEYWORD_SEARCH_BUDGET_MS = 20000;
type SearchReservation = { queries: string[]; searchEdition: string; profile: UserProfile };

export abstract class BaseIndustryEngine implements IIndustryEngine {
  abstract readonly config: EngineConfig;

  /** Fetches and parses RSS, Atom, or JSON Feed alike (whichever the source actually is) via one shared parser, so content is consistently HTML-free. */
  protected async fetchFeed(feed: RSSFeedConfig, signal?: AbortSignal): Promise<FetchedArticle[]> {
      const res = await fetchPublicText(feed.url, { signal });
      const parsedItems = await parseFeedContent(res.text);
      if (!parsedItems) throw new CrawlError("feed", "The source did not return a readable RSS, Atom, or JSON feed.");

      const items = parsedItems.slice(0, 15).map((item) => ({
        ...item,
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        source: feed.name,
        sourceOrigin: sourceOrigin(item.link),
        content: item.content,
        categories: item.categories.length ? item.categories : [feed.category],
      }));

      const validItems = items.filter((item) => {
        if (!item.link) return false;
        return validateUrlSync(item.link);
      });

      return validItems.slice(0, 10);
  }

  /** Same contract as fetchFeed, but for a source with no RSS/Atom/JSON feed — scrapes the page directly instead. */
  protected async fetchWebpage(source: RSSFeedConfig, signal?: AbortSignal): Promise<FetchedArticle[]> {
      const items = await scrapeWebpageArticles(source.url, signal);
      const withCategories = items.slice(0, 15).map((item) => ({
        ...item,
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        source: source.name,
        content: item.content,
        categories: item.categories.length ? item.categories : [source.category],
      }));
      return withCategories.filter((item) => item.link && validateUrlSync(item.link)).slice(0, 10);
  }

  protected async fetchUserSources(scope: TenantScope): Promise<FetchedArticle[]> {
    // Oldest-first rotation keeps a large source list from starving later rows.
    const sources = (await storage.getUserSources(scope)).filter((s) => s.isActive)
      .sort((a, b) => new Date(a.lastFetchedAt ?? 0).getTime() - new Date(b.lastFetchedAt ?? 0).getTime())
      .slice(0, 30);
    if (!sources.length) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const articles: FetchedArticle[] = [];
    let succeeded = 0;
    try {
      const outcomes = await mapCrawlSettled(sources, 3, async (source) => {
        // Leave unattempted sources untouched so the next refresh picks them first.
        if (controller.signal.aborted) return;
        let errorMessage: string | null = null;
        try {
          const config = { name: source.name, url: source.feedUrl, category: "user-source" };
          const items = source.sourceType === "webpage"
            ? await this.fetchWebpage(config, controller.signal)
            : await this.fetchFeed(config, controller.signal);
          articles.push(...items.map((item): FetchedArticle => ({
            ...item,
            userSourceProvenance: { kind: "active-user-source", sourceId: source.id },
          })));
          succeeded++;
        } catch (error) {
          errorMessage = crawlErrorMessage(error);
        }
        await storage.updateUserSource(scope, source.id, {
          lastFetchedAt: new Date(), lastFetchStatus: errorMessage ? "error" : "ok", lastFetchError: errorMessage,
        }).catch(() => { /* Best-effort status tracking, but never detached work. */ });
      });
      if (controller.signal.aborted) throw new CrawlError("sources", "Article sources could not complete. Please try again.");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    if (!succeeded) throw new CrawlError("sources", "None of your sources could be read. Check their fetch errors in Manage Sources.");
    return articles;
  }

  /**
   * Reserve from the current persisted profile under its storage lock, never a
   * caller's stale snapshot. All allocated queries count as consumed, including
   * cache hits, failures and cancellation before starting. Advancing first keeps
   * failing/slow queries from starving later selections across refreshes.
   */
  protected async reserveSearch(scope: TenantScope): Promise<SearchReservation> {
    const reservation = await storage.reserveSearchQueryPlan(scope).catch(() => {
      // Storage/driver errors can contain profile values; never surface them.
      throw new CrawlError("search-plan", "The search query plan could not be reserved. Please try again.");
    });
    if (!reservation?.profile) {
      throw new CrawlError("search-plan", "Your saved profile could not be loaded. Please try again.");
    }
    return reservation;
  }

  protected async fetchKeywordSearchArticles({ queries, searchEdition }: SearchReservation): Promise<FetchedArticle[]> {
    if (!queries.length) return [];

    const edition = getSearchEdition(searchEdition);
    // Preserve query order/case and boundaries; delimiters in labels cannot collide.
    const cacheKey = `keywords:${JSON.stringify([edition.id, queries])}`;
    let partialFailure = false;
    return getCachedArticles(cacheKey, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), KEYWORD_SEARCH_BUDGET_MS);
      try {
        const results = await mapCrawlSettled(queries, 2, async (query) => {
          // Unstarted allocations are failures too, not successful empty results.
          if (controller.signal.aborted) throw new CrawlError("search-timeout", "The search time budget expired.");
          return fetchArticlesForQuery(query, 8, edition.id, controller.signal);
        });
        const failed = results.filter((result) => result.status === "rejected").length;
        partialFailure = failed > 0;
        if ((failed === results.length && results.length > 0) || controller.signal.aborted) {
          // Never cache a fully failed/deadline batch or include provider/query details.
          throw new CrawlError("search-batch", "Article search could not complete. Please try again.");
        }
        const articles: FetchedArticle[] = [];
        results.forEach((result) => {
          if (result.status === "fulfilled") articles.push(...result.value);
        });
        return articles;
      } finally {
        // All started fetches settle before returning; no detached race losers.
        clearTimeout(timer);
        controller.abort();
      }
    }, () => !partialFailure);
  }

  async scoreArticles(
    articles: FetchedArticle[],
    userProfile: UserProfile,
    now = Date.now(),
  ): Promise<ScoredArticle[]> {
    const scored = articles.map((article) => {
      const relevance = scoreArticleRelevance(article, userProfile);
      return { ...article, ...relevance, rankingScore: relevance.relevanceScore * freshnessMultiplier(article.publicationDate?.publishedAt, now) };
    });

    return scored
      .filter((item) => item.relevanceScore > 0)
      .sort((a, b) => b.rankingScore - a.rankingScore || (a.link < b.link ? -1 : a.link > b.link ? 1 : 0));
  }

  async processForUser(
    scope: TenantScope,
    _userProfile: UserProfile,
    options: InboxRefreshOptions = {},
  ): Promise<EngineRunResult> {
    const startTime = Date.now();
    const operationId = options.operationId ?? randomUUID();
    const autoRefresh = options.autoRefresh ?? false;
    let activeCount = 0;
    let discoveryWarnings: string[] = [];

    try {
      const begin = await storage.beginInboxRefresh(scope, operationId, autoRefresh);
      if (begin.receipt) return begin.receipt;
      activeCount = begin.activeCount;
      if (autoRefresh && activeCount > INBOX_CAPACITY) {
        return await storage.commitInboxRefresh(scope, operationId, autoRefresh, begin.snapshot, [], {
          articlesProcessed: 0, articlesMatched: 0, durationMs: Date.now() - startTime,
        });
      }
      // Reserve ONCE before any discovery/crawl starts. Every stage uses the
      // same locked persisted snapshot, not a potentially stale caller profile.
      const reservation = await this.reserveSearch(scope);
      const userProfile = reservation.profile;
      const existingSources = await storage.getUserSources(scope);
      discoveryWarnings = await resolvePublicationSources(scope, userProfile);
      if (activeCount > 0) await this.repairStoredGoogleNewsUrls(scope);

      const [sourceOutcome, searchOutcome] = await Promise.allSettled([
        this.fetchUserSources(scope),
        this.fetchKeywordSearchArticles(reservation),
      ]);
      const stageWarnings: string[] = [];
      if (sourceOutcome.status === "rejected") stageWarnings.push("Some saved sources could not be fetched. Check Manage Sources for details.");
      if (searchOutcome.status === "rejected") stageWarnings.push("Keyword search could not complete. Your saved-source results are still available.");
      const sourceArticles = sourceOutcome.status === "fulfilled" ? sourceOutcome.value : [];
      const searchArticles = searchOutcome.status === "fulfilled" ? searchOutcome.value : [];
      if ((sourceOutcome.status === "rejected" && searchOutcome.status === "rejected")
        || (sourceOutcome.status === "rejected" && searchArticles.length === 0)
        || (searchOutcome.status === "rejected" && sourceArticles.length === 0)) {
        throw new CrawlError("refresh-incomplete", inboxRefreshMessage("failure"));
      }
      const userSourceArticles = sourceArticles;
      const keywordArticles = searchArticles;

      const hasAnyInterestSignal =
        existingSources.some(source => source.isActive) ||
        (userProfile.keywords?.length ?? 0) > 0 ||
        (userProfile.companies?.length ?? 0) > 0 ||
        (userProfile.influencers?.length ?? 0) > 0 ||
        (userProfile.publications?.length ?? 0) > 0;

      const seen = new Set<string>();
      const articles: FetchedArticle[] = [];
      // Completion timing must not choose the representative. Prefer source body,
      // then longer text, with a stable full-record tie break. Story grouping is
      // deferred until AFTER history exclusion inside commit.
      const fetched = [...userSourceArticles, ...keywordArticles].sort((a, b) =>
        Number(b.inputKind === "page_body") - Number(a.inputKind === "page_body") || b.content.length - a.content.length ||
        (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0));
      for (const article of fetched) {
        const canonical = canonicalHttpUrl(article.link);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        articles.push(article);
        if (articles.length >= INBOX_CANDIDATE_LIMIT) break;
      }

      const evaluatedAt = Date.now();
      const scoredArticles = await this.scoreArticles(articles, userProfile, evaluatedAt);
      // Pass the bounded RANKED pool, not its top ten: historical matches must
      // not consume quota or hide fresh candidates further down the ranking.
      return await storage.commitInboxRefresh(scope, operationId, autoRefresh, begin.snapshot,
        scoredArticles.map(article => {
          const date = article.publicationDate ?? publicationDate(null, "unknown");
          const extracted = summarizeArticle(article.content, article.inputKind);
          const qualityMetadata: ArticleQuality = { version: "quality-v1", date,
            freshness: { policy: "balanced-v1", multiplier: freshnessMultiplier(date.publishedAt, evaluatedAt), evaluatedAt: new Date(evaluatedAt).toISOString() },
            relevance: { version: "concept-v1", evidence: article.evidence ?? [] },
            diversity: diversityFeatures(article.title, article.sourceOrigin === undefined ? sourceOrigin(article.link) : article.sourceOrigin, article.matchedKeywords, article.content),
            summary: extracted.provenance };
          return ({
            headline: article.title,
            source: article.source,
            articleUrl: article.link,
            summary: extracted.summary,
            publishedAt: date.publishedAt ? new Date(date.publishedAt) : null,
            rankingScore: String(article.relevanceScore * qualityMetadata.freshness.multiplier),
            qualityMetadata,
            matchedKeywords: article.matchedKeywords,
            relevanceScore: String(article.relevanceScore),
            relevanceReason: article.relevanceReason,
            status: "active",
        }); }), {
        articlesProcessed: articles.length,
        articlesMatched: scoredArticles.length,
        durationMs: Date.now() - startTime,
        needsSetup: !hasAnyInterestSignal,
        discoveryWarnings: [...discoveryWarnings, ...stageWarnings],
      });
    } catch (error) {
      if (error instanceof InboxOperationConflictError) throw error;
      return {
        success: false,
        outcome: "failure",
        count: 0, articlesCreated: 0, items: [], activeCount, replacedCount: 0,
        articlesProcessed: 0,
        articlesMatched: 0,
        newInboxItems: 0,
        durationMs: Date.now() - startTime,
        errors: [inboxRefreshMessage("failure")],
        discoveryWarnings,
        message: inboxRefreshMessage("failure"),
      };
    }
  }

  private async repairStoredGoogleNewsUrls(scope: TenantScope): Promise<void> {
    const existing = await storage.getInboxItems(scope, { status: "active", limit: 100 });
    if (!Array.isArray(existing)) return;
    const wrappers = existing.filter(item => isGoogleNewsArticleUrl(item.articleUrl));
    if (!wrappers.length) return;
    await mapCrawlSettled(wrappers, 2, async item => {
      const direct = await resolveGoogleNewsArticleUrl(item.articleUrl);
      if (direct !== item.articleUrl && !isGoogleNewsArticleUrl(direct)) await storage.updateInboxArticleUrl(scope, item.id, direct);
    });
  }

  /**
   * "Trending for you" — computed entirely from this user's own recent
   * inbox history (matchedKeywords already recorded per item), never a
   * shared static per-industry keyword list.
   */
  async getHotTrends(scope: TenantScope, maxTrends: number = 5): Promise<PersonalTrend[]> {
    const now = new Date();
    return personalTrends(await storage.getInboxDiscoveryWindow(scope, now), now, maxTrends);
  }
}
