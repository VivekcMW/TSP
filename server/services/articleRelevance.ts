import { normalizeKeywords, type KeywordInput } from "@shared/profile-preferences";
import type { FetchedArticle } from "./engines/types.js";
import type { TextEvidence } from "@shared/article-quality";
import { DOMAIN_CONCEPTS } from "./articleConcepts";

/** Service limits also accommodate older profiles with more than 20 selections. */
export const RELEVANCE_LIMITS = { title: 2000, content: 100_000, signalsPerType: 100, term: 100 } as const;

export interface RelevanceProfile {
  keywords?: readonly KeywordInput[] | null;
  companies?: readonly string[] | null;
  influencers?: readonly string[] | null;
  focusDescription?: string | null;
}

interface Signal {
  label: string;
  type: TextEvidence["type"];
  weight: number;
}
export type RelevanceEvidence = TextEvidence;

export interface ArticleRelevance {
  relevanceScore: number;
  matchedKeywords: string[];
  relevanceReason: string;
  evidence: RelevanceEvidence[];
}

const normalizeText = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const normalizeLabel = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim();

function boundedText(text: string, limit: number): string {
  // Discard a cut-off token, rather than manufacturing a match at the limit.
  let end = Math.min(text.length, limit);
  if (text.length > limit) {
    while (end > 0 && !/\s/u.test(text[end - 1])) end--;
  }
  return normalizeText(text.slice(0, end));
}

function noMatch(relevanceReason: string): ArticleRelevance {
  return { relevanceScore: 0, matchedKeywords: [], relevanceReason, evidence: [] };
}

function boundedKeyword(value: KeywordInput): KeywordInput {
  const label = typeof value === "string" ? value : value.keyword;
  // Bound before Unicode normalization or validation. Never turn an oversized
  // phrase into a shorter, different interest by slicing it.
  if (typeof label !== "string" || label.length > RELEVANCE_LIMITS.term) throw new Error("Term limit");
  if (typeof value === "string") return normalizeLabel(value);
  if (value.category !== undefined && (typeof value.category !== "string" || value.category.length > RELEVANCE_LIMITS.term)) {
    throw new Error("Category limit");
  }
  return { keyword: normalizeLabel(label), weight: value.weight, category: value.category };
}

function collectSignals(profile: RelevanceProfile): Map<string, Signal> {
  const groups = [
    { type: "keyword" as const, values: profile.keywords ?? [] },
    { type: "company" as const, values: profile.companies ?? [] },
    { type: "influencer" as const, values: profile.influencers ?? [] },
  ];
  const signals = new Map<string, Signal>();
  for (const { type, values } of groups) {
    if (!Array.isArray(values) || values.length > RELEVANCE_LIMITS.signalsPerType) throw new Error("Signal limit");
    for (const keyword of normalizeKeywords(values.map(boundedKeyword))) {
      if (keyword.weight === 0) continue;
      const key = normalizeText(keyword.keyword);
      if (!signals.has(key)) signals.set(key, { label: keyword.keyword, type, weight: keyword.weight });
    }
  }
  return signals;
}

/**
 * Pure lexical evidence, not a confidence estimate. Match only complete phrases
 * in title OR body (never metadata, and never a phrase bridging the two fields).
 * Shared normalization preserves zero/category and first-seen keyword metadata.
 * Across types, the first positive term wins: keyword, company, influencer.
 * Invalid/oversized signal input fails closed, including source-only selection.
 */
export function scoreArticleRelevance(
  article: Pick<FetchedArticle, "title" | "content" | "userSourceProvenance">,
  profile: RelevanceProfile,
  options: { mode?: "exact" | "concept" } = {},
): ArticleRelevance {
  let signals: Map<string, Signal>;
  try {
    signals = collectSignals(profile);
  } catch {
    return noMatch("Invalid or oversized relevance signals; no selection made.");
  }

  const expanded = options.mode !== "exact";
  const disabled = new Set(normalizeKeywords((profile.keywords ?? []).map(boundedKeyword)).filter(k => k.weight === 0)
    .map(k => normalizeText(k.keyword)));
  const conceptDisabled = (concept: typeof DOMAIN_CONCEPTS[number]) => [concept.label, ...concept.aliases].some(a => disabled.has(normalizeText(a)));
  const focus = expanded && typeof profile.focusDescription === "string" && profile.focusDescription.length <= 2000
    ? profile.focusDescription : "";
  const focusConcepts = DOMAIN_CONCEPTS.filter(c => !conceptDisabled(c) &&
    findSurface(focus, c.label, 2000)).slice(0, 6);
  for (const concept of focusConcepts) {
    if (!signals.has(concept.label)) signals.set(concept.label, { label: concept.label, type: "focus", weight: 0.1 });
  }
  if (!signals.size && !focus.trim()) {
    const provenance = article.userSourceProvenance;
    if (provenance?.kind === "active-user-source" && typeof provenance.sourceId === "string" && provenance.sourceId.trim()) {
      return { relevanceScore: 0.1, matchedKeywords: [], evidence: [],
        relevanceReason: "Selected from an active user source; no positive textual interests configured. This is source selection, not a topic match." };
    }
    return noMatch("No positive textual interests configured and no active user-source provenance.");
  }

  const fields = [{ field: "title" as const, text: article.title, limit: RELEVANCE_LIMITS.title },
    { field: "content" as const, text: article.content, limit: RELEVANCE_LIMITS.content }];
  const locate = (surface: string) => {
    for (const { field, text, limit } of fields) {
      const span = findSurface(text, surface, limit);
      if (span) return { field, span, matchedSurface: text.slice(span.start, span.end) };
    }
  };
  const usedConcepts = new Set<string>();
  let evidence: TextEvidence[] = [...signals.entries()]
    .sort(([a, left], [b, right]) => {
      // Explicit weighted interests must not be consumed by derived focus aliases.
      const focusOrder = Number(left.type === "focus") - Number(right.type === "focus");
      if (focusOrder) return focusOrder;
      if (a === b) return 0;
      return a < b ? -1 : 1;
    })
    .flatMap(([term, signal]) => {
      const concept = expanded && (signal.type === "keyword" || signal.type === "focus")
        ? DOMAIN_CONCEPTS.find(c => [c.label, ...c.aliases].some(a => normalizeText(a) === term)) : undefined;
      if (concept && usedConcepts.has(concept.id)) return [];
      let match = locate(term);
      let matchKind: TextEvidence["matchKind"] = signal.type === "focus" ? "focus" : "exact";
      if (!match && concept && !conceptDisabled(concept)) {
        for (const alias of [concept.label, ...concept.aliases].filter(a => normalizeText(a) !== term).slice(0, 4)) {
          // Ambiguous acronyms require independent domain-text corroboration.
          if (alias.length <= 4 && !concept.context.some(word => locate(word))) continue;
          match = locate(alias);
          if (match) { matchKind = signal.type === "focus" ? "focus" : "alias"; break; }
        }
      }
      if (!match) return [];
      if (concept) usedConcepts.add(concept.id);
      return [{ ...signal, ...match, matchKind, ...(concept ? { concept: concept.id } : {}) }];
    });
  // Focus alone requires two informative domain concepts. No common-word filler.
  if (evidence.length && evidence.every(e => e.type === "focus") && evidence.length < 2) evidence = [];
  // Focus contributes at most 0.3 raw evidence weight.
  let focusWeight = 0;
  evidence = evidence.filter(e => e.type !== "focus" || (focusWeight += e.weight) <= 0.30001);
  evidence.sort((a, b) => normalizeText(a.label).localeCompare(normalizeText(b.label), "en"));
  if (!evidence.length) return noMatch("No configured positive keyword, company or influencer phrases matched the article text.");

  const sum = evidence.reduce((total, signal) => total + signal.weight, 0);
  const descriptions = evidence.map(signal => `${signal.type} ${JSON.stringify(signal.label)}`);
  return {
    // Positive evidence must survive quantization, even at tiny valid weights.
    relevanceScore: Math.max(0.0001, Math.round((sum / (1 + sum)) * 10_000) / 10_000),
    matchedKeywords: evidence.map(signal => signal.label),
    relevanceReason: `Matched article text: ${descriptions.join("; ")}.`,
    evidence,
  };
}

/** NFKC/case/whitespace matching with exact original UTF-16 span projection. */
function findSurface(input: string, term: string, limit: number): { start: number; end: number } | undefined {
  let end = Math.min(input.length, limit);
  if (input.length > limit) while (end > 0 && !/\s/u.test(input[end - 1])) end--;
  const original = input.slice(0, end);
  const needle = normalizeText(term);
  const normalized = boundedText(original, limit);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}\p{Pc}])${escaped}(?![\p{L}\p{M}\p{N}\p{Pc}])`, "u").exec(normalized);
  if (!match) return undefined;
  // Build the mapping only for fields with an actual match.
  let mapped = ""; const starts: number[] = []; const ends: number[] = [];
  for (const segment of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(original)) {
    for (const char of segment.segment.normalize("NFKC").toLowerCase()) {
      const value = /\s/u.test(char) ? " " : char;
      if (value === " " && (!mapped || mapped.endsWith(" "))) {
        if (mapped.endsWith(" ")) ends[ends.length - 1] = segment.index + segment.segment.length;
        continue;
      }
      mapped += value;
      for (let i = 0; i < value.length; i++) { starts.push(segment.index); ends.push(segment.index + segment.segment.length); }
    }
  }
  return { start: starts[match.index], end: ends[match.index + match[0].length - 1] };
}