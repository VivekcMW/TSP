import type { TenantScope } from "../../storage.js";
import type { IndustrySlug, UserProfile } from "@shared/schema";

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
}

export interface EngineRunResult {
  success: boolean;
  articlesProcessed: number;
  articlesMatched: number;
  newInboxItems: number;
  durationMs: number;
  /** Set when the user has no keywords/companies/influencers and no active sources yet, so the caller can prompt setup instead of treating this as a failure. */
  needsSetup?: boolean;
  errors?: string[];
}

/**
 * Per-engine identity/voice only. There is no feed list or trend keyword list
 * here anymore — every user's Discover content comes exclusively from their
 * own sources (user_sources) and live keyword search, never a shared preset.
 */
export interface EngineConfig {
  industry: IndustrySlug;
  displayName: string;
  description: string;
  industryPrompt: string;
}

export interface IIndustryEngine {
  readonly config: EngineConfig;

  processForUser(
    scope: TenantScope,
    userProfile: UserProfile
  ): Promise<EngineRunResult>;

  getHotTrends(scope: TenantScope, maxTrends?: number): Promise<Array<{
    topic: string;
    count: number;
    articles: Array<{ title: string; source: string; link: string }>;
  }>>;
}
