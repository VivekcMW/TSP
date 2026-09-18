import { validateUrlSync } from "../urlValidator.js";
import { discoverFeed, normalizeToUrl } from "../feedDiscovery.js";
import { CrawlError, crawlErrorMessage, fetchPublicText, mapCrawlSettled } from "../crawlerFetch.js";
import { fetchArticlesForQuery } from "../keywordSearch.js";
import { parseFeedContent, normalizeTitleForDedup } from "../universalFeedParser.js";
import { scrapeWebpageArticles } from "../webpageScraper.js";
import { getCachedArticles } from "./articleCache.js";
import type {
  IIndustryEngine,
  EngineConfig,
  FetchedArticle,
  ScoredArticle,
  EngineRunResult,
  RSSFeedConfig,
} from "./types.js";
import type { UserProfile } from "@shared/schema";
import { storage, type TenantScope } from "../../storage.js";

/** Cap on how many keyword/company/influencer queries we live-search per refresh, to bound latency and outbound requests. */
const MAX_KEYWORD_QUERIES = 8;

export abstract class BaseIndustryEngine implements IIndustryEngine {
  abstract readonly config: EngineConfig;

  /** Fetches and parses RSS, Atom, or JSON Feed alike (whichever the source actually is) via one shared parser, so content is consistently HTML-free. */
  protected async fetchFeed(feed: RSSFeedConfig, signal?: AbortSignal): Promise<FetchedArticle[]> {
      const res = await fetchPublicText(feed.url, { signal });
      const parsedItems = await parseFeedContent(res.text);
      if (!parsedItems) throw new CrawlError("feed", "The source did not return a readable RSS, Atom, or JSON feed.");

      const items = parsedItems.slice(0, 15).map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        source: feed.name,
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
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        source: source.name,
        content: item.content,
        categories: item.categories.length ? item.categories : [source.category],
      }));
      return withCategories.filter((item) => item.link && validateUrlSync(item.link)).slice(0, 10);
  }

  /**
  * Only explicit publication URLs can be materialized. Plain names remain
  * interest signals until the user adds their correct URL in Manage Sources.
  * Cancellation stops probes AND prevents late writes after the budget expires.
   */
  private async materializePublicationsAsSources(
    scope: TenantScope,
    userProfile: UserProfile,
    existing: Array<{ name: string }>,
  ): Promise<void> {
    const publications = userProfile.publications || [];
    if (!publications.length) return;

    const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));
    const unresolved = [...new Set(publications.map((name) => name.trim()))]
      .filter((name) => normalizeToUrl(name) && !existingNames.has(name.toLowerCase())).slice(0, 4);
    if (!unresolved.length) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const materializeOne = async (name: string): Promise<void> => {
      if (controller.signal.aborted) return;
      const result = await discoverFeed(name, controller.signal);
      if ("feedUrl" in result && !controller.signal.aborted) {
        try {
          await storage.createUserSource(scope, {
            // Keep the explicit input as the idempotency name; don't relabel a guessed brand.
            name,
            feedUrl: result.feedUrl,
            sourceType: result.sourceType,
            addedVia: "publication",
            isActive: true,
          });
        } catch {
          // Likely a unique-constraint hit from a concurrent request resolving the same feed URL — safe to ignore.
        }
      }
    };

    try {
      await mapCrawlSettled(unresolved, 2, materializeOne);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
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
      await mapCrawlSettled(sources, 3, async (source) => {
        // Leave unattempted sources untouched so the next refresh picks them first.
        if (controller.signal.aborted) return;
        let errorMessage: string | null = null;
        try {
          const config = { name: source.name, url: source.feedUrl, category: "user-source" };
          const items = source.sourceType === "webpage"
            ? await this.fetchWebpage(config, controller.signal)
            : await this.fetchFeed(config, controller.signal);
          articles.push(...items);
          succeeded++;
        } catch (error) {
          errorMessage = crawlErrorMessage(error);
        }
        await storage.updateUserSource(scope, source.id, {
          lastFetchedAt: new Date(), lastFetchStatus: errorMessage ? "error" : "ok", lastFetchError: errorMessage,
        }).catch(() => { /* Best-effort status tracking, but never detached work. */ });
      });
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    if (!succeeded) throw new CrawlError("sources", "None of your sources could be read. Check their fetch errors in Manage Sources.");
    return articles;
  }

  /** Live keyword-driven search — the query IS the user's own text, so there is nothing to hardcode here. */
  protected async fetchKeywordSearchArticles(userProfile: UserProfile): Promise<FetchedArticle[]> {
    const queries = [
      ...(userProfile.keywords || []),
      ...(userProfile.companies || []),
      ...(userProfile.influencers || []),
    ]
      .map((q) => {
        // Handle both string and weighted keyword formats
        return typeof q === 'string' ? q : q.keyword;
      })
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, MAX_KEYWORD_QUERIES);

    if (!queries.length) return [];

    const cacheKey = `keywords:${queries.slice().sort((a, b) => a.localeCompare(b)).join("|").toLowerCase()}`;
    return getCachedArticles(cacheKey, async () => {
      const results = await mapCrawlSettled(queries, 2, (q) => fetchArticlesForQuery(q));
      const articles: FetchedArticle[] = [];
      results.forEach((result) => {
        if (result.status === "fulfilled") articles.push(...result.value);
      });
      return articles;
    });
  }

  async scoreArticles(
    articles: FetchedArticle[],
    userProfile: UserProfile
  ): Promise<ScoredArticle[]> {
    const userKeywords = [
      ...(userProfile.keywords || []),
      ...(userProfile.companies || []),
      ...(userProfile.influencers || []),
    ];

    const scored = articles.map((article) => {
      const text = `${article.title} ${article.content}`.toLowerCase();
      let score = 0;
      const matchedKeywords: string[] = [];

      userKeywords.forEach((kw) => {
        // Handle both string and weighted keyword formats
        const keyword = typeof kw === 'string' ? kw : kw.keyword;
        const keywordLower = keyword.toLowerCase();
        if (text.includes(keywordLower)) {
          score += 2;
          matchedKeywords.push(keyword);
        }
        const words = keywordLower.split(/\s+/);
        words.forEach((word: string) => {
          if (word.length > 3 && text.includes(word)) {
            score += 0.5;
          }
        });
      });

      const publications = userProfile.publications || [];
      if (publications.some(pub =>
        pub.toLowerCase().includes(article.source.toLowerCase()) ||
        article.source.toLowerCase().includes(pub.toLowerCase())
      )) {
        score += 3;
      }

      return {
        ...article,
        relevanceScore: score,
        matchedKeywords,
      };
    });

    return scored
      .filter((item) => item.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  async processForUser(
    scope: TenantScope,
    userProfile: UserProfile
  ): Promise<EngineRunResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      const existingSources = await storage.getUserSources(scope);
      await this.materializePublicationsAsSources(scope, userProfile, existingSources);

      const [userSourceArticles, keywordArticles] = await Promise.all([
        this.fetchUserSources(scope).catch((error) => { errors.push(crawlErrorMessage(error)); return []; }),
        this.fetchKeywordSearchArticles(userProfile),
      ]);

      const hasAnyInterestSignal =
        existingSources.length > 0 ||
        (userProfile.keywords?.length ?? 0) > 0 ||
        (userProfile.companies?.length ?? 0) > 0 ||
        (userProfile.influencers?.length ?? 0) > 0 ||
        (userProfile.publications?.length ?? 0) > 0;

      const seen = new Set<string>();
      const seenTitles = new Set<string>();
      const articles: FetchedArticle[] = [];
      for (const article of [...userSourceArticles, ...keywordArticles]) {
        if (!article.link || seen.has(article.link)) continue;
        // Catches syndicated re-headlines of the same story across different
        // outlets (common with keyword search) that a strict URL match would
        // let through as if they were distinct articles.
        const titleKey = normalizeTitleForDedup(article.title);
        if (titleKey && seenTitles.has(titleKey)) continue;
        seen.add(article.link);
        if (titleKey) seenTitles.add(titleKey);
        articles.push(article);
      }

      if (articles.length === 0) {
        return {
          success: errors.length === 0,
          articlesProcessed: 0,
          articlesMatched: 0,
          newInboxItems: 0,
          durationMs: Date.now() - startTime,
          needsSetup: !hasAnyInterestSignal,
          ...(errors.length ? { errors } : {}),
        };
      }

      const scoredArticles = await this.scoreArticles(articles, userProfile);
      // Keyword-search results already matched their query; if scoring found
      // nothing (e.g. no keywords set, only user_sources configured) still
      // rank the raw fetched articles rather than dropping them.
      const rankedArticles = scoredArticles.length > 0
        ? scoredArticles
        : articles.map((a) => ({ ...a, relevanceScore: 1, matchedKeywords: [] as string[] }));
      const topArticles = rankedArticles.slice(0, 10);

      let newItems = 0;
      for (const article of topArticles) {
        const existing = await storage.getInboxItemByUrl(scope, article.link);
        if (!existing) {
          // Import is at the top of the file; use the relevance scoring
          const { calculateArticleRelevance, normalizeKeywords } = await import("../punditBrain.js");
          
          // Get normalized keywords (weighted)
          const normalizedKeywords = normalizeKeywords(userProfile.keywords || []);
          
          // Calculate relevance score
          const relevance = calculateArticleRelevance(
            `${article.title} ${article.content.slice(0, 500)}`,
            normalizedKeywords,
          );

          const inboxItem: any = {
            headline: article.title,
            source: article.source,
            articleUrl: article.link,
            summary: article.content.slice(0, 500),
            matchedKeywords: article.matchedKeywords,
            relevanceScore: String(relevance.relevanceScore),
            relevanceReason: relevance.reasoning,
            status: "active",
          };
          await storage.createInboxItem(scope, inboxItem);
          newItems++;
        }
      }

      return {
        success: true,
        articlesProcessed: articles.length,
        articlesMatched: rankedArticles.length,
        newInboxItems: newItems,
        durationMs: Date.now() - startTime,
        ...(errors.length ? { errors } : {}),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(errorMsg);
      console.error(`[${this.config.industry}] Engine error for user ${scope.userId}:`, error);

      return {
        success: false,
        articlesProcessed: 0,
        articlesMatched: 0,
        newInboxItems: 0,
        durationMs: Date.now() - startTime,
        errors,
      };
    }
  }

  /**
   * "Trending for you" — computed entirely from this user's own recent
   * inbox history (matchedKeywords already recorded per item), never a
   * shared static per-industry keyword list.
   */
  async getHotTrends(scope: TenantScope, maxTrends: number = 5): Promise<Array<{
    topic: string;
    count: number;
    articles: Array<{ title: string; source: string; link: string }>;
  }>> {
    const recentItems = await storage.getInboxItems(scope, { limit: 200 });

    const trendMap = new Map<string, {
      count: number;
      articles: Array<{ title: string; source: string; link: string }>;
    }>();

    for (const item of recentItems) {
      for (const keyword of item.matchedKeywords || []) {
        const existing = trendMap.get(keyword) || { count: 0, articles: [] };
        existing.count++;
        if (existing.articles.length < 3) {
          existing.articles.push({ title: item.headline, source: item.source, link: item.articleUrl });
        }
        trendMap.set(keyword, existing);
      }
    }

    return Array.from(trendMap.entries())
      .map(([topic, data]) => ({ topic, count: data.count, articles: data.articles }))
      .filter((t) => t.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, maxTrends);
  }
}
