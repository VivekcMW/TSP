import type { IndustrySlug, InboxItem, UserProfile, IndustrySource } from "@shared/schema";

export interface RSSFeedConfig {
  name: string;
  url: string;
  category: string;
  priority?: number;
}

export interface FetchedArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  content: string;
  categories: string[];
}

export interface ScoredArticle extends FetchedArticle {
  relevanceScore: number;
  matchedKeywords: string[];
  aiSummary?: string;
}

export interface EngineRunResult {
  success: boolean;
  articlesProcessed: number;
  articlesMatched: number;
  newInboxItems: number;
  durationMs: number;
  errors?: string[];
}

export interface EngineConfig {
  industry: IndustrySlug;
  displayName: string;
  description: string;
  defaultFeeds: RSSFeedConfig[];
  trendKeywords: Array<{ keyword: string; display: string }>;
  industryPrompt: string;
}

export interface IIndustryEngine {
  readonly config: EngineConfig;
  
  fetchArticles(sources?: IndustrySource[]): Promise<FetchedArticle[]>;
  
  scoreArticles(
    articles: FetchedArticle[],
    userProfile: UserProfile
  ): Promise<ScoredArticle[]>;
  
  processForUser(
    userId: string,
    userProfile: UserProfile
  ): Promise<EngineRunResult>;
  
  getHotTrends(maxTrends?: number): Promise<Array<{
    topic: string;
    count: number;
    articles: Array<{ title: string; source: string; link: string }>;
  }>>;
}
