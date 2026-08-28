import Parser from "rss-parser";
import { GoogleGenAI } from "@google/genai";
import { validateUrlSync } from "../urlValidator.js";
import { resolvePublications } from "../publicationResolver.js";
import { getCachedArticles } from "./articleCache.js";
import type { 
  IIndustryEngine, 
  EngineConfig, 
  FetchedArticle, 
  ScoredArticle, 
  EngineRunResult,
  RSSFeedConfig 
} from "./types.js";
import type { IndustrySource, UserProfile } from "@shared/schema";
import { storage, type TenantScope } from "../../storage.js";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "TheSocialPundit/1.0 (Industry Content Curator)",
  },
});

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

export abstract class BaseIndustryEngine implements IIndustryEngine {
  abstract readonly config: EngineConfig;

  protected async fetchFeed(feed: RSSFeedConfig): Promise<FetchedArticle[]> {
    try {
      const result = await parser.parseURL(feed.url);
      const items = (result.items || []).slice(0, 15).map((item) => ({
        title: item.title || "Untitled",
        link: item.link || "",
        pubDate: item.pubDate || new Date().toISOString(),
        source: feed.name,
        content: item.contentSnippet || item.content || item.summary || "",
        categories: item.categories || [feed.category],
      }));
      
      const validItems = items.filter((item) => {
        if (!item.link) return false;
        return validateUrlSync(item.link);
      });
      
      return validItems.slice(0, 10);
    } catch (error) {
      console.error(`[${this.config.industry}] Failed to fetch RSS feed from ${feed.name}:`, 
        error instanceof Error ? error.message : error);
      return [];
    }
  }

  async fetchArticles(sources?: IndustrySource[]): Promise<FetchedArticle[]> {
    const feeds: RSSFeedConfig[] = sources?.length 
      ? sources.filter(s => s.isActive).map(s => ({
          name: s.name,
          url: s.feedUrl,
          category: this.config.industry,
          priority: s.priority || 0,
        }))
      : this.config.defaultFeeds;

    const doFetch = async (): Promise<FetchedArticle[]> => {
      const feedPromises = feeds.map((feed) => this.fetchFeed(feed));
      const results = await Promise.allSettled(feedPromises);

      const articles: FetchedArticle[] = [];
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          articles.push(...result.value);
        }
      });

      articles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

      return articles;
    };

    // Only cache the default-feeds path (the common case): custom per-user
    // `sources` overrides are rare enough not to warrant their own cache key.
    if (!sources?.length) {
      return getCachedArticles(`industry:${this.config.industry}`, doFetch);
    }

    return doFetch();
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

  async fetchFromUserPublications(publications: string[]): Promise<FetchedArticle[]> {
    if (!publications || publications.length === 0) {
      return [];
    }
    
    const { resolved, unresolved } = resolvePublications(publications);
    
    if (unresolved.length > 0) {
      console.log(`[${this.config.industry}] Could not resolve RSS feeds for: ${unresolved.join(", ")}`);
    }
    
    if (resolved.length === 0) {
      console.log(`[${this.config.industry}] No user publications could be resolved to RSS feeds`);
      return [];
    }
    
    console.log(`[${this.config.industry}] Fetching from ${resolved.length} user publications: ${resolved.map(f => f.name).join(", ")}`);
    
    const feedPromises = resolved.map((feed) => this.fetchFeed(feed));
    const results = await Promise.allSettled(feedPromises);
    
    const articles: FetchedArticle[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        articles.push(...result.value);
        console.log(`[${this.config.industry}] Fetched ${result.value.length} articles from ${resolved[index].name}`);
      } else {
        console.log(`[${this.config.industry}] Failed to fetch from ${resolved[index].name}: ${result.reason}`);
      }
    });
    
    return articles;
  }

  async processForUser(
    scope: TenantScope,
    userProfile: UserProfile
  ): Promise<EngineRunResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const MIN_ARTICLES_THRESHOLD = 5;
    
    try {
      const userPublications = userProfile.publications || [];
      let articles: FetchedArticle[] = [];
      
      if (userPublications.length > 0) {
        console.log(`[${this.config.industry}] Prioritizing ${userPublications.length} user publications`);
        articles = await this.fetchFromUserPublications(userPublications);
        console.log(`[${this.config.industry}] Got ${articles.length} articles from user publications`);
      }
      
      if (articles.length < MIN_ARTICLES_THRESHOLD) {
        console.log(`[${this.config.industry}] Supplementing with industry feeds (have ${articles.length}, need ${MIN_ARTICLES_THRESHOLD})`);
        const sources = await storage.getIndustrySources(this.config.industry);
        const industryArticles = await this.fetchArticles(sources);
        
        const existingUrls = new Set(articles.map(a => a.link));
        const newArticles = industryArticles.filter(a => !existingUrls.has(a.link));
        articles = [...articles, ...newArticles];
        console.log(`[${this.config.industry}] Total articles after industry supplement: ${articles.length}`);
      }
      
      if (articles.length === 0) {
        return {
          success: true,
          articlesProcessed: 0,
          articlesMatched: 0,
          newInboxItems: 0,
          durationMs: Date.now() - startTime,
        };
      }
      
      const scoredArticles = await this.scoreArticles(articles, userProfile);
      const topArticles = scoredArticles.slice(0, 10);
      
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
        articlesMatched: scoredArticles.length,
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

  async getHotTrends(maxTrends: number = 5): Promise<Array<{
    topic: string;
    count: number;
    articles: Array<{ title: string; source: string; link: string }>;
  }>> {
    const articles = await this.fetchArticles();
    
    const trendMap = new Map<string, { 
      count: number; 
      articles: Array<{ title: string; source: string; link: string }>;
    }>();
    
    articles.forEach((article) => {
      const text = `${article.title} ${article.content}`.toLowerCase();
      this.config.trendKeywords.forEach(({ keyword, display }) => {
        const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(text)) {
          const existing = trendMap.get(display) || { count: 0, articles: [] };
          existing.count++;
          if (existing.articles.length < 3) {
            existing.articles.push({
              title: article.title,
              source: article.source,
              link: article.link,
            });
          }
          trendMap.set(display, existing);
        }
      });
    });
    
    return Array.from(trendMap.entries())
      .map(([topic, data]) => ({ topic, count: data.count, articles: data.articles }))
      .filter((t) => t.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, maxTrends);
  }

  protected async generateAISummary(article: FetchedArticle): Promise<string> {
    try {
      const prompt = `Summarize this article in 2-3 sentences for a ${this.config.displayName} professional:
      
Title: ${article.title}
Content: ${article.content.slice(0, 1000)}

Return only the summary, no explanation.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const candidate = response.candidates?.[0];
      return candidate?.content?.parts?.[0]?.text || article.content.slice(0, 300);
    } catch (error) {
      console.error(`[${this.config.industry}] AI summary error:`, error);
      return article.content.slice(0, 300);
    }
  }
}
