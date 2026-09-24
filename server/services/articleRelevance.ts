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

/** Words that carry no topic meaning. */
const STOPWORDS = new Set(["a", "an", "and", "or", "the", "of", "for", "in", "on", "to", "with", "by", "at", "from", "vs", "via", "into", "about"]);
/** Qualifiers that narrow a topic but seldom appear in a headline about it (singular forms). */
const GENERIC_TOPIC_WORDS = new Set(["growth", "trend", "market", "industry", "strategy", "metric", "standard", "insight", "new", "update",
  "advertising", "marketing", "digital", "media", "business", "global", "future", "innovation", "management", "leadership",
  "india", "us", "uk", "asia", "apac", "europe", "world", "landscape", "outlook", "opportunity", "challenge", "role", "impact"]);
/** A topic matched by its words is weaker evidence than the exact phrase. */
const WORD_MATCH_FACTOR = 0.85;
/** A company or person named only outside the headline is usually a passing mention. */
const NAME_OUTSIDE_HEADLINE_FACTOR = 0.5;
/** Stock-market coverage that matched only a company or person ranks below topic stories. */
const MARKET_NOISE_FACTOR = 0.5;
const MARKET_TICKER = /\((?:(?:NASDAQ|NYSE|NSE|BSE|LSE|TSX|ASX|OTC)\s*:\s*)?[A-Z]{2,5}(?:\.[A-Z]{1,2})?\)/;
const MARKET_WORDING = new RegExp([
  String.raw`\b(?:stocks?|share price|price target|undervalued|overvalued|dividends?|market cap|52-week|nasdaq|nyse|sensex|nifty|shareholders?)\b`,
  String.raw`\bshares (?:rose|rise|rises|fell|fall|falls|jump|jumps|jumped|drop|drops|dropped|surge|surges|surged|slide|slides|slid|gain|gains|gained|climb|climbs|climbed|hit|hits|trade|traded|tumble|tumbled|plunge|plunged|soar|soared)\b`,
  String.raw`\b(?:q[1-4] )?earnings (?:call|report|beat|miss|season|results?)\b`,
  String.raw`\banalysts? (?:upgrade|downgrade|rating)s?\b`,
  String.raw`\b(?:falls?|drops?|jumps?|rises?|surges?|slides?|plunges?|soars?|gains?|climbs?|tumbles?|sinks?|rall(?:y|ies))\s+\d+(?:\.\d+)?\s?%`,
].join("|"), "i");
const looksLikeMarketCoverage = (title: string) => MARKET_TICKER.test(title) || MARKET_WORDING.test(title);

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

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Normalized words with UTF-16 spans into the original bounded field. */
function fieldWords(text: string, limit: number): Array<{ word: string; start: number; end: number }> {
  let end = Math.min(text.length, limit);
  if (text.length > limit) while (end > 0 && !/\s/u.test(text[end - 1])) end--;
  return [...text.slice(0, end).matchAll(/[\p{L}\p{N}]+/gu)]
    .map(match => ({ word: stem(match[0].normalize("NFKC").toLowerCase()), start: match.index, end: match.index + match[0].length }));
}

const topicWords = (label: string) => [...new Set((label.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  .map(stem).filter(word => !STOPWORDS.has(word)))];

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
 * Pure lexical evidence, not a confidence estimate. Match complete phrases in title
 * OR body (never metadata, and never a phrase bridging the two fields). In the default
 * mode a multi-word topic may also match by its specific words (weaker evidence).
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
  const hasTitle = Boolean(normalizeText(article.title.slice(0, RELEVANCE_LIMITS.title)));
  let words: { title: ReturnType<typeof fieldWords>; content: ReturnType<typeof fieldWords> } | undefined;
  /** A multi-word topic whose specific words appear: two or more words, one in the headline. */
  const locateWords = (label: string) => {
    const tokens = topicWords(label);
    if (tokens.length < 2) return undefined;
    words ??= { title: fieldWords(article.title, RELEVANCE_LIMITS.title), content: fieldWords(article.content, RELEVANCE_LIMITS.content) };
    const present = new Set([...words.title, ...words.content].map(entry => entry.word));
    const found = tokens.filter(token => present.has(token));
    const specific = tokens.filter(token => !GENERIC_TOPIC_WORDS.has(token));
    if (found.length < 2 || !(specific.length ? specific : tokens).every(token => found.includes(token))) return undefined;
    const inTitle = words.title.find(entry => found.includes(entry.word));
    if (hasTitle && !inTitle) return undefined;
    const field = inTitle ? "title" as const : "content" as const;
    const anchor = inTitle ?? words.content.find(entry => found.includes(entry.word))!;
    const source = field === "title" ? article.title : article.content;
    return { field, span: { start: anchor.start, end: anchor.end }, matchedSurface: source.slice(anchor.start, anchor.end) };
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
      let weight = signal.weight;
      if (!match && expanded && signal.type === "keyword") {
        match = locateWords(signal.label);
        if (match) { matchKind = "words"; weight = signal.weight * WORD_MATCH_FACTOR; }
      }
      if (!match) return [];
      if (concept) usedConcepts.add(concept.id);
      if ((signal.type === "company" || signal.type === "influencer") && hasTitle && match.field === "content") weight = signal.weight * NAME_OUTSIDE_HEADLINE_FACTOR;
      return [{ ...signal, ...match, weight, matchKind, ...(concept ? { concept: concept.id } : {}) }];
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
  const marketNoise = hasTitle && !evidence.some(e => e.type === "keyword")
    && evidence.some(e => e.type === "company" || e.type === "influencer") && looksLikeMarketCoverage(article.title.slice(0, RELEVANCE_LIMITS.title));
  return {
    // Positive evidence must survive quantization, even at tiny valid weights.
    relevanceScore: Math.max(0.0001, Math.round((sum / (1 + sum)) * (marketNoise ? MARKET_NOISE_FACTOR : 1) * 10_000) / 10_000),
    matchedKeywords: evidence.map(signal => signal.label),
    relevanceReason: `Matched article text: ${descriptions.join("; ")}.${marketNoise ? " Ranked lower: stock-market coverage that matched only a company or person." : ""}`,
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