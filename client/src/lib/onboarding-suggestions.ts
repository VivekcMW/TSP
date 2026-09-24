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
/** `picks` are the items the agent pre-selects; `note` is its one-sentence explanation. */
export interface SuggestionResult { grounded: boolean; items: SuggestedChoice[]; picks: string[]; note: string }

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
  const items = unique(step === "people"
    ? [...parseItems("leader", data.people), ...parseItems("company", data.companies)]
    : parseItems(step === "publications" ? "source" : "topic", data.items));
  // A pick must name a returned item; use the item's spelling.
  const byKey = new Map(items.map(item => [item.name.toLowerCase(), item.name]));
  const picks = [...new Set((Array.isArray(data.picks) ? data.picks : []).flatMap(pick => typeof pick === "string" && byKey.has(pick.trim().toLowerCase()) ? [byKey.get(pick.trim().toLowerCase())!] : []))];
  const note = typeof data.note === "string" ? data.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return { grounded: data.grounded, items, picks, note };
}

export interface Understanding {
  role: string;
  industry: string;
  focusAreas: string[];
  region: string | null;
  audience: string | null;
  question: { text: string; options: string[] } | null;
}

const text = (max: number) => z.string().trim().max(max).catch("");
const nullableText = z.string().trim().min(1).max(60).nullable().catch(null).default(null);
const textList = (max: number, count: number) => z.array(z.unknown()).catch([]).default([])
  .transform(values => values.flatMap(value => typeof value === "string" && value.trim() ? [value.trim().slice(0, max)] : []).slice(0, count));

export function parseUnderstanding(value: unknown): Understanding {
  const data = z.object({
    role: text(60), industry: text(60), focusAreas: textList(40, 5), region: nullableText, audience: nullableText,
    question: z.object({ text: z.string().trim().min(1).max(160), options: textList(40, 4) }).nullable().catch(null).default(null),
  }).parse(value);
  return { ...data, question: data.question && data.question.options.length >= 2 ? data.question : null };
}

export type AgentEvent =
  | { type: "progress"; step: SuggestionStep; message: string }
  | { type: "result"; step: SuggestionStep; result: SuggestionResult }
  | { type: "error"; step: SuggestionStep | null; code: string }
  | { type: "done" };
const stepSchema = z.enum(["publications", "topics", "people"]);

/** Untrusted stream data: unknown or malformed events are ignored. */
export function parseAgentEvent(value: unknown): AgentEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (event.type === "done") return { type: "done" };
  if (event.type === "error") {
    const step = event.step === null ? null : stepSchema.safeParse(event.step);
    const code = typeof event.code === "string" ? event.code.slice(0, 60) : "ai_unavailable";
    if (step === null) return { type: "error", step: null, code };
    return step.success ? { type: "error", step: step.data, code } : null;
  }
  const step = stepSchema.safeParse(event.step);
  if (!step.success) return null;
  if (event.type === "progress") return typeof event.message === "string" && event.message.trim() ? { type: "progress", step: step.data, message: event.message.trim().slice(0, 240) } : null;
  if (event.type === "result") {
    try { return { type: "result", step: step.data, result: parseOnboardingSuggestions(step.data, event) }; } catch { return null; }
  }
  return null;
}

/** Read a server-sent event stream, calling `onEvent` with each decoded `data:` payload. */
export async function readEventStream(response: Response, onEvent: (event: unknown) => void): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block: string) => {
    const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    try { onEvent(JSON.parse(data)); } catch { /* skip a malformed event */ }
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      flush(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
    if (done) break;
  }
  if (buffer.trim()) flush(buffer);
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
