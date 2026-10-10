/** Versioned, bounded metadata. Scores are policies, never confidence or verification. */
export type PublicationDateSource = "rss-pubDate" | "atom-published" | "json-date_published" | "article-meta" | "jsonld-datePublished" | "unknown";
export interface PublicationDate {
  publishedAt: string | null;
  publicationDateSource: PublicationDateSource;
  precision: "instant" | "day" | "unknown";
  day?: string;
  quality: "valid" | "missing" | "invalid" | "ambiguous" | "future" | "conflicting";
}
export type ArticleInputKind = "page_body" | "feed_excerpt" | "provider_excerpt";
export interface TextEvidence {
  label: string;
  type: "keyword" | "company" | "influencer" | "focus";
  weight: number;
  /** "words": a multi-word topic matched by its specific words, not the exact phrase. */
  matchKind: "exact" | "alias" | "focus" | "words";
  matchedSurface: string;
  field: "title" | "content";
  /** UTF-16 offsets into the original bounded field, not normalized text. */
  span: { start: number; end: number };
  concept?: string;
}
export interface SummaryProvenance {
  version: "contiguous-v1";
  method: "extractive" | "source_excerpt" | "unavailable";
  inputKind: ArticleInputKind;
  inputHash: string;
  inputLength: number;
  spans: Array<{ start: number; end: number }>;
  warnings: Array<"input_bounded" | "excerpt_only" | "insufficient_complete_text">;
}
export interface DiversityFeatures {
  sourceOrigin: string | null;
  /** Bounded normalized body identity; different updates must not collapse. */
  contentFingerprint?: string;
  titleTokens: string[];
  titleKey: string;
  figures: string[];
  topics: string[];
}
export interface ArticleQuality {
  version: "quality-v1";
  date: PublicationDate;
  freshness: { policy: "balanced-v1"; multiplier: number; evaluatedAt: string };
  relevance: { version: "concept-v1"; evidence: TextEvidence[] };
  diversity: DiversityFeatures;
  summary: SummaryProvenance;
}
export interface PersonalTrend {
  topic: string;
  count: number;
  articles: Array<{ title: string; source: string; link: string }>;
  previousCount: number;
  delta: number;
  velocityPercent: number | null;
  label: "new" | "continuing";
  sourceCount: number;
  unknownSourceCount: number;
  windowStart: string;
  windowEnd: string;
  previousWindowStart: string;
  timeBasis: "discoveredAt";
  coverage: { basis: "admitted-content"; allStatuses: true; partial: boolean; rowLimit: number; rowsExamined: number };
}

export const normalizeTopic = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

/** UTC age buckets; unknown/invalid/future values never receive a fresh boost. */
export function freshnessMultiplier(publishedAt: string | null | undefined, now: number): number {
  const time = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  if (!Number.isFinite(time) || time > now) return 0.6;
  const days = Math.floor((now - time) / 86_400_000);
  if (days <= 7) return 1;
  return days <= 30 ? 0.85 : 0.6;
}