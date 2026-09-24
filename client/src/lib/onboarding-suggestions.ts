import { z } from "zod";
import type { WeightedKeyword } from "@shared/profile-preferences";
import type { SearchEditionId } from "@shared/search-editions";
import { parsePublicationCandidate } from "./publication-candidates";

export type SuggestionStep = "publications" | "topics" | "people";
export type SuggestionKind = "source" | "topic" | "leader" | "company";
export interface SuggestionEvidence { count: number; headline: string }
export interface SuggestedChoice {
  kind: SuggestionKind;
  name: string;
  url?: string;
  reason?: string;
  weight?: number;
  evidence?: SuggestionEvidence;
  /** A well-known name from the AI's general knowledge, not from a recent headline. */
  aiOnly?: true;
}
export interface SuggestionResult { grounded: boolean; items: SuggestedChoice[] }

const name = z.string().trim().min(1).max(100);
const evidence = z.object({ count: z.number().int().min(1), headline: z.string().trim().min(1).max(300) });
const envelope = (step: SuggestionStep | "preview") => z.object({ step: z.literal(step), grounded: z.boolean() }).passthrough();

/** Server output is untrusted: drop an invalid entry or field, never its valid siblings. */
function parseItems(kind: SuggestionKind, value: unknown): SuggestedChoice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): SuggestedChoice[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const parsedName = name.safeParse(item.name);
    if (!parsedName.success) return [];
    const choice: SuggestedChoice = { kind, name: parsedName.data };
    const url = kind === "source" && typeof item.url === "string" ? parsePublicationCandidate({ name: choice.name, url: item.url })?.url : undefined;
    if (url) choice.url = url;
    if (typeof item.reason === "string" && item.reason.trim()) choice.reason = item.reason.trim().slice(0, 200);
    const weight = z.number().finite().min(0).max(1).safeParse(item.weight);
    if (kind === "topic" && weight.success) choice.weight = weight.data;
    if (kind === "leader" && item.aiOnly === true) return [{ ...choice, aiOnly: true }];
    const proof = evidence.safeParse(item.evidence);
    if (proof.success) choice.evidence = proof.data;
    return [choice];
  });
}

function unique(items: SuggestedChoice[]) {
  const seen = new Set<string>();
  return items.filter(item => !seen.has(item.name.toLowerCase()) && seen.add(item.name.toLowerCase()));
}

export function parseOnboardingSuggestions(step: SuggestionStep, value: unknown): SuggestionResult {
  const data = envelope(step).parse(value);
  const items = step === "people"
    ? [...parseItems("leader", data.people), ...parseItems("company", data.companies)]
    : parseItems(step === "publications" ? "source" : "topic", data.items);
  return { grounded: data.grounded, items: unique(items) };
}

/** Compare names loosely: news sources often appear as domains ("bestmediainfo.com" = "BestMediaInfo"). */
export function choiceKey(name: string): string {
  return name.trim().toLowerCase().replace(/^www\./, "").replace(/\.(com|in|co\.uk|co|org|net|io|news|tv)$/, "").replace(/[^\p{L}\p{N}]/gu, "");
}

export function evidenceLabel(choice: SuggestedChoice): string | undefined {
  if (choice.aiOnly) return "AI suggestion";
  const count = choice.evidence?.count;
  if (!count) return undefined;
  if (choice.kind === "source") return `${count} recent article${count === 1 ? "" : "s"}`;
  return `in ${count} headline${count === 1 ? "" : "s"}`;
}

export interface PreviewHeadline { title: string; source: string; link: string | null; publishedAt: string | null; topic: string }

const previewHeadline = z.object({
  title: z.string().trim().min(1).max(300),
  source: z.string().trim().min(1).max(100),
  // Only Google News article pages; anything else renders as plain text.
  link: z.string().nullable().optional().transform(value => {
    try { const url = new URL(value ?? ""); return url.protocol === "https:" && url.hostname === "news.google.com" ? url.href : null; } catch { return null; }
  }),
  publishedAt: z.string().datetime().nullable().optional().catch(null).transform(value => value ?? null),
  topic: z.string().trim().min(1).max(100),
});

export function parsePreviewHeadlines(value: unknown): PreviewHeadline[] {
  const data = envelope("preview").parse(value);
  return (Array.isArray(data.headlines) ? data.headlines : []).flatMap(entry => {
    const parsed = previewHeadline.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, 3);
}

/** Discover favours higher-weighted topics, so the preview searches the top three. */
export function previewTopics(keywords: readonly WeightedKeyword[]): string[] {
  return keywords.map((keyword, index) => ({ keyword, index }))
    .sort((a, b) => b.keyword.weight - a.keyword.weight || a.index - b.index)
    .slice(0, 3).map(({ keyword }) => keyword.keyword);
}

const COUNTRY_EDITIONS: Record<string, SearchEditionId> = {
  "India": "en-IN", "United Kingdom": "en-GB", "Australia": "en-AU", "Canada": "en-CA", "United States": "en-US",
  "France": "fr-FR", "Germany": "de-DE", "Spain": "es-ES", "Brazil": "pt-BR", "Japan": "ja-JP",
};
const ZONE_COUNTRIES: Array<[RegExp, string]> = [
  [/^Asia\/(Kolkata|Calcutta)$/, "India"], [/^Europe\/London$/, "United Kingdom"], [/^Australia\//, "Australia"],
  [/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina)$/, "Canada"],
  [/^Europe\/Paris$/, "France"], [/^Europe\/Berlin$/, "Germany"], [/^Europe\/Madrid$/, "Spain"],
  [/^America\/Sao_Paulo$/, "Brazil"], [/^Asia\/Tokyo$/, "Japan"],
];
// A local-language edition returns local-language headlines, so it needs a matching browser language.
const LOCAL_LANGUAGE: Partial<Record<string, [string, SearchEditionId]>> = {
  "India": ["hi", "hi-IN"], "France": ["fr", "fr-FR"], "Germany": ["de", "de-DE"], "Spain": ["es", "es-ES"],
  "Brazil": ["pt", "pt-BR"], "Japan": ["ja", "ja-JP"],
};

/** Pick the Google News edition for onboarding searches from the profile, time zone and language. */
export function defaultSearchEdition({ country, timeZone, language }: { country?: string; timeZone?: string; language?: string }): SearchEditionId {
  const place = (country && COUNTRY_EDITIONS[country] ? country : undefined)
    ?? ZONE_COUNTRIES.find(([zone]) => timeZone && zone.test(timeZone))?.[1];
  if (!place) return "en-US";
  const local = LOCAL_LANGUAGE[place];
  if (local && language?.toLowerCase().split("-")[0] === local[0]) return local[1];
  const edition = COUNTRY_EDITIONS[place];
  return edition.startsWith("en-") ? edition : "en-US";
}

export function browserSearchEdition(country?: string): SearchEditionId {
  let timeZone: string | undefined;
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* use the country or the default */ }
  return defaultSearchEdition({ country, timeZone, language: typeof navigator === "undefined" ? undefined : navigator.language });
}
