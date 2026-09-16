import { validateUrlSync, assertPublicHttpUrl } from "../urlValidator.js";
import { discoverFeed } from "../feedDiscovery.js";
import { fetchArticlesForQuery } from "../keywordSearch.js";
import { parseFeedContent, normalizeTitleForDedup } from "../universalFeedParser.js";
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
  protected async fetchFeed(feed: RSSFeedConfig): Promise<FetchedArticle[]> {
    try {
      const guard = await assertPublicHttpUrl(feed.url);
      if (!guard.ok) {
        console.error(`[${this.config.industry}] Refusing to fetch ${feed.name}: ${guard.reason}`);
        return [];
      }

      const res = await fetch(feed.url, {
        headers: { "User-Agent": "TheSocialPundit/1.0 (Industry Content Curator)" },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      if (!res.ok) return [];

      const parsedItems = await parseFeedContent(await res.text());
      if (!parsedItems) return [];

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
    } catch (error) {
      console.error(`[${this.config.industry}] Failed to fetch feed from ${feed.name}:`,
        error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Ensures every entry in the user's free-text `publications` list has a
   * matching `user_sources` row, resolving new ones via live feed
   * autodiscovery (never a static per-site dictionary). Idempotent —
   * already-resolved publications are skipped by name match. Discovery runs
   * in parallel with an overall time budget, so a handful of slow or
   * unresolvable publications never stall a refresh for long; anything left
   * unresolved is simply retried on the next refresh.
   */
  private async materializePublicationsAsSources(
    scope: TenantScope,
    userProfile: UserProfile,
    existing: Array<{ name: string }>,
  ): Promise<void> {
    const publications = userProfile.publications || [];
    if (!publications.length) return;

    const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));
    const unresolved = publications.filter((name) => !existingNames.has(name.toLowerCase()));
    if (!unresolved.length) return;

    const materializeOne = async (name: string): Promise<void> => {
      const result = await discoverFeed(name);
      if ("feedUrl" in result) {
        try {
          await storage.createUserSource(scope, {
            name: result.name,
            feedUrl: result.feedUrl,
            addedVia: "publication",
            isActive: true,
          });
        } catch (error) {
          // Likely a unique-constraint hit from a concurrent request resolving the same feed URL — safe to ignore.
          console.log(`[${this.config.industry}] Skipped materializing "${name}":`, error instanceof Error ? error.message : error);
        }
      } else {
        console.log(`[${this.config.industry}] Could not auto-discover a feed for publication "${name}": ${result.error}`);
      }
    };

    const MATERIALIZE_BUDGET_MS = 6000;
    await Promise.race([
      Promise.allSettled(unresolved.map(materializeOne)),
      new Promise<void>((resolve) => setTimeout(resolve, MATERIALIZE_BUDGET_MS)),
    ]);
  }

  protected async fetchUserSources(scope: TenantScope): Promise<FetchedArticle[]> {
    const sources = (await storage.getUserSources(scope)).filter((s) => s.isActive);
    if (!sources.length) return [];

    const results = await Promise.allSettled(
      sources.map((source) => this.fetchFeed({ name: source.name, url: source.feedUrl, category: "user-source" })),
    );

    const articles: FetchedArticle[] = [];
    results.forEach((result, index) => {
      const source = sources[index];
      const ok = result.status === "fulfilled";
      if (ok) articles.push(...result.value);
      storage
        .updateUserSource(scope, source.id, {
          lastFetchedAt: new Date(),
          lastFetchStatus: ok ? "ok" : "error",
          lastFetchError: ok ? null : "Fetch failed",
        })
        .catch(() => {
          // Best-effort status tracking only.
        });
    });

    return articles;
  }

  /** Live keyword-driven search — the query IS the user's own text, so there is nothing to hardcode here. */
  protected async fetchKeywordSearchArticles(userProfile: UserProfile): Promise<FetchedArticle[]> {
    const queries = [
      ...(userProfile.keywords || []),
      ...(userProfile.companies || []),
      ...(userProfile.influencers || []),
    ]
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, MAX_KEYWORD_QUERIES);

    if (!queries.length) return [];

    const cacheKey = `keywords:${queries.slice().sort((a, b) => a.localeCompare(b)).join("|").toLowerCase()}`;
    return getCachedArticles(cacheKey, async () => {
      const results = await Promise.allSettled(queries.map((q) => fetchArticlesForQuery(q)));
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

      userKeywords.forEach((keyword) => {
        const keywordLower = keyword.toLowerCase();
        if (text.includes(keywordLower)) {
          score += 2;
          matchedKeywords.push(keyword);
        }
        const words = keywordLower.split(/\s+/);
        words.forEach((word) => {
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
        this.fetchUserSources(scope),
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
          success: true,
          articlesProcessed: 0,
          articlesMatched: 0,
          newInboxItems: 0,
          durationMs: Date.now() - startTime,
          needsSetup: !hasAnyInterestSignal,
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
          const inboxItem = {
            headline: article.title,
            source: article.source,
            articleUrl: article.link,
            summary: article.content.slice(0, 500),
            matchedKeywords: article.matchedKeywords,
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
