import type { WatchTerm, WatchTermKind } from "@shared/schema";
import { WATCHLIST_MAX } from "@shared/moments";

export interface WatchProfile {
  keywords?: Array<{ keyword: string; weight: number }> | null;
  companies?: string[] | null;
  influencers?: string[] | null;
}

export interface WatchStory {
  id: string;
  headline: string;
  summary?: string | null;
  matchedKeywords?: string[] | null;
  qualityMetadata?: { relevance?: { evidence?: Array<{ type?: string; label?: string }> } } | null;
}

const OPTIONS_MAX = 90;
const EVIDENCE_TYPES: Record<WatchTermKind, string[]> = { company: ["company"], person: ["influencer"], topic: ["keyword", "focus"] };
const key = (term: WatchTerm) => `${term.kind}:${term.term.toLocaleLowerCase()}`;

/** What a person can watch: their profile companies, people and (positively weighted) topics. */
export function watchOptions(profile: WatchProfile | null | undefined): WatchTerm[] {
  if (!profile) return [];
  const groups: Array<[WatchTermKind, string[]]> = [
    ["company", profile.companies ?? []],
    ["person", profile.influencers ?? []],
    ["topic", (profile.keywords ?? []).filter(item => item?.weight > 0).map(item => item.keyword)],
  ];
  const seen = new Set<string>();
  const options: WatchTerm[] = [];
  for (const [kind, values] of groups) {
    for (const value of values) {
      const term = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
      if (!term || term.length > 80 || seen.has(key({ kind, term }))) continue;
      seen.add(key({ kind, term }));
      options.push({ kind, term });
    }
  }
  return options.slice(0, OPTIONS_MAX);
}

/** Stored terms still present in the profile, in the profile's spelling. Removed profile entries stop matching. */
export function effectiveWatchTerms(stored: readonly WatchTerm[] | null | undefined, profile: WatchProfile | null | undefined): WatchTerm[] {
  const options = new Map(watchOptions(profile).map(option => [key(option), option]));
  const result = new Map<string, WatchTerm>();
  for (const term of stored ?? []) {
    const option = options.get(key(term));
    if (option) result.set(key(option), option);
  }
  return [...result.values()].slice(0, WATCHLIST_MAX);
}

/** Unknown terms (not in the profile) are rejected rather than silently dropped. */
export function validateWatchSelection(selection: readonly WatchTerm[], profile: WatchProfile | null | undefined): WatchTerm[] | undefined {
  const chosen = effectiveWatchTerms(selection, profile);
  const unique = new Set(selection.map(key));
  return chosen.length === unique.size ? chosen : undefined;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive phrase match; internal spaces match any whitespace. */
export function mentions(text: string, term: string): boolean {
  const pattern = term.trim().split(/\s+/).map(escape).join("\\s+");
  return pattern.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

export function matchWatchTerms(story: WatchStory, terms: readonly WatchTerm[]): WatchTerm[] {
  const text = `${story.headline ?? ""}\n${story.summary ?? ""}`;
  const keywords = new Set((story.matchedKeywords ?? []).map(value => value.toLocaleLowerCase()));
  const evidence = story.qualityMetadata?.relevance?.evidence ?? [];
  return terms.filter(term => {
    const lower = term.term.toLocaleLowerCase();
    return mentions(text, term.term) || keywords.has(lower)
      || evidence.some(item => EVIDENCE_TYPES[term.kind].includes(item.type ?? "") && item.label?.toLocaleLowerCase() === lower);
  });
}

/** One alert per story and term, never repeated within a batch. */
export function alertsFor(stories: readonly WatchStory[], terms: readonly WatchTerm[]): Array<{ inboxItemId: string } & WatchTerm> {
  const alerts = new Map<string, { inboxItemId: string } & WatchTerm>();
  if (!terms.length) return [];
  for (const story of stories) {
    for (const term of matchWatchTerms(story, terms)) alerts.set(`${story.id}\n${term.term}`, { inboxItemId: story.id, ...term });
  }
  return [...alerts.values()];
}

/** Inbox admission hook (BaseEngine.processForUser): best effort, so a failure never affects the refresh. */
export async function recordWatchAlertsAfterRefresh(scope: { tenantId: string; userId: string },
  result: { success?: boolean; items?: readonly WatchStory[] } | null | undefined): Promise<void> {
  const items = result?.success ? result.items ?? [] : [];
  if (!items.length) return;
  try {
    const { recordWatchAlerts } = await import("../repositories/watchAlerts");
    await recordWatchAlerts(scope, items);
  } catch {
    console.warn("[watch-alerts] Alerts for this refresh could not be recorded");
  }
}
