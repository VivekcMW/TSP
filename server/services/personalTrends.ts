import { normalizeTopic, type PersonalTrend, type ArticleQuality } from "@shared/article-quality";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { sourceOrigin } from "./inboxDiversity";

export const TREND_ROW_LIMIT = 5000;
export const TREND_WINDOW_MS = 7 * 86_400_000;
export interface TrendRow {
  articleUrl: string; headline: string; source: string; discoveredAt: Date | null;
  matchedKeywords: string[] | null; relevanceScore: string | null; qualityMetadata: ArticleQuality | null;
}
/** A bounded personal admission sample, never a market or crawl-volume estimate. */
export function personalTrends(rows: readonly TrendRow[], now: Date, maxTrends = 5): PersonalTrend[] {
  const end = now.getTime(); const start = end - TREND_WINDOW_MS; const previousStart = start - TREND_WINDOW_MS;
  const seen = new Set<string>();
  const groups = new Map<string, { current: TrendRow[]; previous: number }>();
  for (const row of rows.slice(0, TREND_ROW_LIMIT)) {
    const time = row.discoveredAt?.getTime();
    if (time === undefined || !Number.isFinite(time) || time < previousStart || time >= end || !(Number(row.relevanceScore) > 0)) continue;
    // Explicit text evidence excludes manual additions and source-only admission.
    const evidence = row.qualityMetadata?.relevance?.evidence;
    if (!Array.isArray(evidence) || !evidence.length) continue;
    const canonical = canonicalHttpUrl(row.articleUrl);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    const topics = new Set(evidence.slice(0, 300).map(e => normalizeTopic(e.label)).filter(t => t.length > 0 && t.length <= 100));
    for (const topic of topics) {
      const group = groups.get(topic) ?? { current: [], previous: 0 };
      if (time >= start) group.current.push(row); else group.previous++;
      groups.set(topic, group);
    }
  }
  return [...groups.entries()].filter(([, g]) => g.current.length >= 2).map(([topic, group]): PersonalTrend => {
    const origins = new Set<string>(); let unknownSourceCount = 0;
    const links: TrendRow[] = []; const remaining: TrendRow[] = [];
    for (const row of group.current) {
      const origin = sourceOrigin(row.qualityMetadata?.diversity?.sourceOrigin);
      if (!origin) unknownSourceCount++;
      if (origin && !origins.has(origin)) links.push(row); else remaining.push(row);
      if (origin) origins.add(origin);
    }
    const count = group.current.length;
    return { topic, count, previousCount: group.previous, delta: count - group.previous,
      velocityPercent: group.previous ? Math.round((count - group.previous) / group.previous * 10000) / 100 : null,
      label: group.previous ? "continuing" : "new", sourceCount: origins.size, unknownSourceCount,
      articles: [...links, ...remaining].slice(0, 3).map(r => ({ title: r.headline, source: r.source, link: r.articleUrl })),
      windowStart: new Date(start).toISOString(), windowEnd: now.toISOString(), previousWindowStart: new Date(previousStart).toISOString(),
      timeBasis: "discoveredAt", coverage: { basis: "admitted-content", allStatuses: true,
        partial: rows.length > TREND_ROW_LIMIT, rowLimit: TREND_ROW_LIMIT, rowsExamined: Math.min(rows.length, TREND_ROW_LIMIT) } };
  }).sort((a, b) => b.count - a.count || (a.topic < b.topic ? -1 : 1))
    .slice(0, Math.max(0, Math.min(20, Number.isFinite(maxTrends) ? Math.floor(maxTrends) : 5)));
}