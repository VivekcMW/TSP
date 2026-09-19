import type { TenantScope } from "../../storage.js";
import type { IndustrySlug, UserProfile } from "@shared/schema";
import type { InboxRefreshOptions, InboxRefreshResult } from "@shared/inbox-refresh";
import type { ArticleInputKind, PersonalTrend, PublicationDate, TextEvidence } from "@shared/article-quality";

export interface RSSFeedConfig {
  name: string;
  url: string;
  category: string;
  priority?: number;
}

export interface FetchedArticle {
  title: string;
  link: string;
  pubDate: string | null;
  publishedAt?: string | null;
  publicationDate?: PublicationDate;
  inputKind?: ArticleInputKind;
  sourceOrigin?: string | null;
  source: string;
  content: string;
  categories: string[];
  /** Trusted server metadata: set ONLY by fetchUserSources after fetching an active row. Never infer from source/category text. */
  userSourceProvenance?: { kind: "active-user-source"; sourceId: string };
}

export interface ScoredArticle extends FetchedArticle {
  relevanceScore: number;
  rankingScore?: number;
  evidence?: TextEvidence[];
  matchedKeywords: string[];
  relevanceReason: string;
}

export interface EngineRunResult extends InboxRefreshResult {}

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
    userProfile: UserProfile,
    options?: InboxRefreshOptions
  ): Promise<EngineRunResult>;

  getHotTrends(scope: TenantScope, maxTrends?: number): Promise<PersonalTrend[]>;
}
