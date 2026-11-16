import { NEWS_QUERY_MAX } from "./inbox-view";

/**
 * Gmail-style keyword news search: plain words (all required), "exact phrases", -exclusions,
 * OR between terms, source:, site:, after:, before: and newer_than:. Pure so the client
 * (chips, follow state) and the server (filtering, provider queries) parse alike.
 */
export const NEWS_QUERY_LIMITS = { chars: NEWS_QUERY_MAX, terms: 12, exclusions: 10, sources: 5, sites: 5, termChars: 100, providerChars: 100 } as const;
export const NEWS_SEARCH_DEFAULT_DAYS = 30;
export const NEWS_SEARCH_MAX_DAYS = 365;
const DAY_MS = 86_400_000;

export type NewsTermKind = "word" | "phrase";
export interface NewsTerm { kind: NewsTermKind; text: string }
export type NewerThanUnit = "d" | "w" | "m";
export interface ParsedNewsQuery {
  /** Every group is required; any term inside a group may match (OR). */
  groups: NewsTerm[][];
  exclude: NewsTerm[];
  sources: string[];
  excludeSources: string[];
  sites: string[];
  excludeSites: string[];
  /** YYYY-MM-DD, UTC days. `after` is inclusive, `before` exclusive. */
  after: string | null;
  before: string | null;
  newerThan: { amount: number; unit: NewerThanUnit; days: number } | null;
  /** Canonical form: terms in order, then exclusions, then operators. Re-parses to itself. */
  normalized: string;
  warnings: string[];
  /** One websearch_to_tsquery input per required group ("amazon or walmart"); the database ANDs them. */
  textGroups: string[];
  /** One websearch_to_tsquery input per excluded term; the database negates each. */
  textExclusions: string[];
  /** Words, phrases, (OR groups), exclusions and one site: for Google News and Bing, at most 100 characters. */
  providerQuery: string;
  /**
   * True only when provider results satisfy the required terms on their own. False when terms did not
   * fit, or when any group uses OR (providers may read OR with the lowest precedence), so provider
   * results must be re-checked with matchesNewsQuery.
   */
  providerComplete: boolean;
}

const OPERATORS = ["source", "site", "after", "before", "newer_than"] as const;
type OperatorKey = typeof OPERATORS[number];
type RawToken =
  | { type: "or" }
  | { type: "term"; negated: boolean; kind: NewsTermKind; text: string }
  | { type: "op"; negated: boolean; key: OperatorKey; value: string };

const isOperator = (key: string): key is OperatorKey => (OPERATORS as readonly string[]).includes(key);
const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const WORD = /[\p{L}\p{N}]+/gu;
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

function readQuoted(input: string, start: number): { value: string; next: number } {
  const end = input.indexOf('"', start + 1);
  return { value: input.slice(start + 1, end < 0 ? undefined : end), next: end < 0 ? input.length : end + 1 };
}

function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }
    const negated = input[i] === "-" && i + 1 < input.length && !/\s/.test(input[i + 1]);
    if (negated) i++;
    if (input[i] === '"') {
      const { value, next } = readQuoted(input, i);
      i = next;
      if (collapse(value)) tokens.push({ type: "term", negated, kind: "phrase", text: collapse(value) });
      continue;
    }
    let j = i;
    while (j < input.length && !/\s/.test(input[j]) && input[j] !== '"') j++;
    const word = input.slice(i, j);
    i = j;
    const keyOnly = /^([a-z_]+):$/i.exec(word);
    if (keyOnly && isOperator(keyOnly[1].toLowerCase()) && input[i] === '"') {
      const { value, next } = readQuoted(input, i);
      i = next;
      tokens.push({ type: "op", negated, key: keyOnly[1].toLowerCase() as OperatorKey, value: collapse(value) });
      continue;
    }
    if (!negated && (word === "OR" || word === "|")) { tokens.push({ type: "or" }); continue; }
    const op = /^([a-z_]+):(.+)$/i.exec(word);
    if (op && isOperator(op[1].toLowerCase())) { tokens.push({ type: "op", negated, key: op[1].toLowerCase() as OperatorKey, value: op[2] }); continue; }
    const text = word.replace(/^[()]+|[()]+$/g, "");
    if (text.match(WORD)) tokens.push({ type: "term", negated, kind: "word", text });
  }
  return tokens;
}

/** "2026-01-31" or "2026/1/31" → "2026-01-31"; null when not a real calendar day. */
export function parseQueryDay(value: string): string | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1990 || year > 2100 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** A bare host name: protocol, "www.", port and path are dropped. Null when not a domain. */
export function normalizeSiteDomain(value: string): string | null {
  const bare = value.trim().replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  if (!bare || bare.includes("@")) return null;
  try {
    const host = new URL(`http://${bare}`).hostname.toLowerCase().replace(/^www\./, "");
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(host) ? host : null;
  } catch { return null; }
}

const termKey = (term: NewsTerm) => `${term.kind}:${term.text.toLocaleLowerCase()}`;
const termString = (term: NewsTerm) => term.kind === "phrase" ? `"${term.text}"` : term.text;
const quoteValue = (value: string) => /[\s:]/.test(value) ? `"${value}"` : value;

class Collector {
  readonly warnings: string[] = [];
  private readonly warned = new Set<string>();
  warn(message: string) { if (!this.warned.has(message)) { this.warned.add(message); this.warnings.push(message); } }
}

function pushUnique(list: string[], value: string, max: number, collector: Collector, limitMessage: string) {
  if (list.some(entry => entry.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
  if (list.length >= max) { collector.warn(limitMessage); return; }
  list.push(value);
}

export function parseNewsQuery(input: string): ParsedNewsQuery {
  const collector = new Collector();
  let text = collapse(typeof input === "string" ? input.normalize("NFKC") : "");
  if (text.length > NEWS_QUERY_LIMITS.chars) {
    text = text.slice(0, NEWS_QUERY_LIMITS.chars);
    collector.warn(`Your search was shortened to ${NEWS_QUERY_LIMITS.chars} characters.`);
  }
  const groups: NewsTerm[][] = [];
  const exclude: NewsTerm[] = [];
  const sources: string[] = [], excludeSources: string[] = [], sites: string[] = [], excludeSites: string[] = [];
  const afters: string[] = [], befores: string[] = [];
  let newerThan: ParsedNewsQuery["newerThan"] = null;
  let termCount = 0;
  let orPending = false;
  let lastWasTerm = false;

  const addTerm = (term: NewsTerm) => {
    const trimmed = { ...term, text: term.text.slice(0, NEWS_QUERY_LIMITS.termChars) };
    const joinPrevious = orPending && lastWasTerm && groups.length > 0;
    const target = joinPrevious ? groups[groups.length - 1] : null;
    if (target?.some(existing => termKey(existing) === termKey(trimmed))) return;
    if (!target && groups.some(group => group.length === 1 && termKey(group[0]) === termKey(trimmed))) return;
    if (termCount >= NEWS_QUERY_LIMITS.terms) { collector.warn(`Only the first ${NEWS_QUERY_LIMITS.terms} words and phrases are used.`); return; }
    termCount++;
    if (target) target.push(trimmed); else groups.push([trimmed]);
  };

  for (const token of tokenize(text)) {
    if (token.type === "or") { orPending = lastWasTerm; continue; }
    if (token.type === "term" && !token.negated) {
      addTerm({ kind: token.kind, text: token.text });
      orPending = false; lastWasTerm = true;
      continue;
    }
    orPending = false; lastWasTerm = false;
    if (token.type === "term") {
      const term = { kind: token.kind, text: token.text.slice(0, NEWS_QUERY_LIMITS.termChars) };
      if (exclude.some(existing => termKey(existing) === termKey(term))) continue;
      if (exclude.length >= NEWS_QUERY_LIMITS.exclusions) collector.warn(`Only the first ${NEWS_QUERY_LIMITS.exclusions} exclusions are used.`);
      else exclude.push(term);
      continue;
    }
    applyOperator(token, { sources, excludeSources, sites, excludeSites, afters, befores }, collector, value => { newerThan = value; }, () => newerThan);
  }

  let after = afters.length ? afters.sort().at(-1)! : null;
  let before = befores.length ? befores.sort()[0] : null;
  if (after && before && after >= before) {
    collector.warn("The after: date is not before the before: date, so both dates were ignored.");
    after = null; before = null;
  }
  const parsed = { groups, exclude, sources, excludeSources, sites, excludeSites, after, before, newerThan: newerThan as ParsedNewsQuery["newerThan"] };
  if (text && !hasSearchTerms(parsed)) collector.warn("Add a word, a \u201cphrase\u201d or source: to search.");
  return { ...parsed, normalized: normalizedQuery(parsed), warnings: collector.warnings, ...textQueriesOf(parsed), ...providerQueryOf(parsed) };
}

interface OperatorLists { sources: string[]; excludeSources: string[]; sites: string[]; excludeSites: string[]; afters: string[]; befores: string[] }

function applyOperator(token: Extract<RawToken, { type: "op" }>, lists: OperatorLists, collector: Collector,
  setNewerThan: (value: ParsedNewsQuery["newerThan"]) => void, newerThan: () => ParsedNewsQuery["newerThan"]) {
  const value = collapse(token.value);
  if (!value) return;
  if (token.key === "source") {
    const name = value.slice(0, NEWS_QUERY_LIMITS.termChars);
    pushUnique(token.negated ? lists.excludeSources : lists.sources, name, NEWS_QUERY_LIMITS.sources, collector, `Only the first ${NEWS_QUERY_LIMITS.sources} sources are used.`);
    return;
  }
  if (token.key === "site") {
    const domain = normalizeSiteDomain(value);
    if (!domain) { collector.warn(`\u201csite:${value.slice(0, 60)}\u201d isn\u2019t a valid domain, so it was ignored.`); return; }
    pushUnique(token.negated ? lists.excludeSites : lists.sites, domain, NEWS_QUERY_LIMITS.sites, collector, `Only the first ${NEWS_QUERY_LIMITS.sites} sites are used.`);
    return;
  }
  if (token.negated) { collector.warn(`-${token.key}: isn\u2019t supported, so it was ignored.`); return; }
  if (token.key === "newer_than") {
    const match = /^(\d{1,3})([dwm])$/i.exec(value);
    const unit = match?.[2].toLowerCase() as NewerThanUnit | undefined;
    const days = match && unit ? Number(match[1]) * { d: 1, w: 7, m: 30 }[unit] : 0;
    if (!match || !unit || days < 1 || days > NEWS_SEARCH_MAX_DAYS) {
      collector.warn("newer_than: works from 1 day to 12 months, for example newer_than:7d, newer_than:2w or newer_than:3m.");
      return;
    }
    const current = newerThan();
    if (!current || days < current.days) setNewerThan({ amount: Number(match[1]), unit, days });
    return;
  }
  const day = parseQueryDay(value);
  if (!day) { collector.warn(`\u201c${token.key}:${value.slice(0, 40)}\u201d isn\u2019t a valid date. Use YYYY-MM-DD.`); return; }
  (token.key === "after" ? lists.afters : lists.befores).push(day);
}

type Structure = Pick<ParsedNewsQuery, "groups" | "exclude" | "sources" | "excludeSources" | "sites" | "excludeSites" | "after" | "before" | "newerThan">;

export function hasSearchTerms(parsed: Pick<ParsedNewsQuery, "groups" | "sources" | "sites">): boolean {
  return parsed.groups.length > 0 || parsed.sources.length > 0 || parsed.sites.length > 0;
}

function normalizedQuery(parsed: Structure): string {
  return [
    ...parsed.groups.map(group => group.map(termString).join(" OR ")),
    ...parsed.exclude.map(term => `-${termString(term)}`),
    ...parsed.sources.map(source => `source:${quoteValue(source)}`),
    ...parsed.excludeSources.map(source => `-source:${quoteValue(source)}`),
    ...parsed.sites.map(site => `site:${site}`),
    ...parsed.excludeSites.map(site => `-site:${site}`),
    ...(parsed.after ? [`after:${parsed.after}`] : []),
    ...(parsed.before ? [`before:${parsed.before}`] : []),
    ...(parsed.newerThan ? [`newer_than:${parsed.newerThan.amount}${parsed.newerThan.unit}`] : []),
  ].join(" ");
}

/**
 * websearch_to_tsquery gives OR the lowest precedence ("a or b c" = a | (b & c)), so each required
 * group becomes its own query and the database combines them: group && group && !!exclusion.
 */
function textQueriesOf(parsed: Structure): Pick<ParsedNewsQuery, "textGroups" | "textExclusions"> {
  // A bare "or" or a leading "-" would be read as an operator.
  const text = (term: NewsTerm) => term.kind === "phrase" || /^or$/i.test(term.text) || term.text.startsWith("-") ? `"${term.text}"` : term.text;
  if (!parsed.groups.length) return { textGroups: [], textExclusions: [] };
  return { textGroups: parsed.groups.map(group => group.map(text).join(" or ")), textExclusions: parsed.exclude.map(text) };
}

function providerQueryOf(parsed: Structure): Pick<ParsedNewsQuery, "providerQuery" | "providerComplete"> {
  // Words that look like operators ("x:y") are quoted so providers read them as text.
  const text = (term: NewsTerm) => term.kind === "phrase" || /[:"]/.test(term.text) ? `"${term.text.replace(/"/g, "")}"` : term.text;
  const parts: string[] = [];
  let length = 0;
  let complete = true;
  const fits = (piece: string) => length + (parts.length ? 1 : 0) + piece.length <= NEWS_QUERY_LIMITS.providerChars;
  const add = (piece: string) => { length += (parts.length ? 1 : 0) + piece.length; parts.push(piece); };
  for (const group of parsed.groups) {
    // Parentheses keep "(amazon OR walmart) retail" grouped where the provider honours them.
    const piece = group.length > 1 ? `(${group.map(text).join(" OR ")})` : text(group[0]);
    if (!complete || !fits(piece)) { complete = false; continue; }
    add(piece);
  }
  if (parsed.sites.length === 1 && fits(`site:${parsed.sites[0]}`)) add(`site:${parsed.sites[0]}`);
  const positive = parts.length > 0;
  for (const piece of [...parsed.excludeSites.map(site => `-site:${site}`), ...parsed.exclude.map(term => `-${text(term)}`)]) if (positive && fits(piece)) add(piece);
  const grouped = parsed.groups.some(group => group.length > 1);
  return { providerQuery: positive ? parts.join(" ") : "", providerComplete: complete && !grouped };
}

/** The publication window. Without date operators, the last 30 days. */
export function newsQueryWindow(parsed: Pick<ParsedNewsQuery, "after" | "before" | "newerThan">, now: Date = new Date()): { from: Date | null; to: Date | null; explicit: boolean } {
  const explicit = Boolean(parsed.after || parsed.before || parsed.newerThan);
  let from = explicit ? null : now.getTime() - NEWS_SEARCH_DEFAULT_DAYS * DAY_MS;
  if (parsed.after) from = Date.parse(`${parsed.after}T00:00:00Z`);
  if (parsed.newerThan) from = Math.max(from ?? -Infinity, now.getTime() - parsed.newerThan.days * DAY_MS);
  return { from: from === null ? null : new Date(from), to: parsed.before ? new Date(`${parsed.before}T00:00:00Z`) : null, explicit };
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && /(ss|x|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}
const wordsOf = (value: string) => value.normalize("NFKC").toLocaleLowerCase().match(WORD) ?? [];

interface PreparedText { words: string[]; stems: string[]; flat: string }
function prepare(value: string): PreparedText {
  const words = wordsOf(value);
  return { words, stems: words.map(stem), flat: value.normalize("NFKC").toLocaleLowerCase() };
}

function termMatches(term: NewsTerm, text: PreparedText): boolean {
  const wanted = wordsOf(term.text);
  if (!wanted.length) return false;
  if (UNSPACED_SCRIPT.test(term.text)) return text.flat.includes(term.text.normalize("NFKC").toLocaleLowerCase());
  if (term.kind === "word" && wanted.length === 1) {
    const [word] = wanted;
    const wordStem = stem(word);
    return text.words.some((token, index) => text.stems[index] === wordStem || (word.length >= 4 && token.startsWith(word)));
  }
  // Phrases (and words such as "covid-19") need their words next to each other, in order.
  outer: for (let start = 0; start + wanted.length <= text.words.length; start++) {
    for (let offset = 0; offset < wanted.length; offset++) if (text.words[start + offset] !== wanted[offset]) continue outer;
    return true;
  }
  return false;
}

export interface NewsArticleLike { title: string; snippet?: string | null; source?: string | null; url: string; publishedAt?: string | Date | null }

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const onSite = (host: string, site: string) => host === site || host.endsWith(`.${site}`);
function fromSource(article: NewsArticleLike, wanted: string): boolean {
  const name = collapse(wanted).toLocaleLowerCase();
  const source = collapse(article.source ?? "").toLocaleLowerCase();
  return Boolean(name) && (source.includes(name) || hostOf(article.url).includes(name.replace(/\s+/g, "")));
}
const publishedTime = (value: NewsArticleLike["publishedAt"]) => {
  if (!value) return null;
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isFinite(time) ? time : null;
};

/** Words and phrases of the query found in the title or snippet, in query order. */
export function matchedNewsTerms(article: Pick<NewsArticleLike, "title" | "snippet">, parsed: Pick<ParsedNewsQuery, "groups">): string[] {
  const text = prepare(`${article.title}\n${article.snippet ?? ""}`);
  return parsed.groups.flat().filter(term => termMatches(term, text)).map(term => term.text);
}

/**
 * Applies the query to one article: sources, sites, dates and exclusions always; required terms
 * unless `requireTerms` is false (a provider that already matched the full article text).
 */
export function matchesNewsQuery(article: NewsArticleLike, parsed: Structure, options: { now?: Date; requireTerms?: boolean } = {}): boolean {
  const host = hostOf(article.url);
  if (!host) return false;
  if (parsed.sources.length && !parsed.sources.some(source => fromSource(article, source))) return false;
  if (parsed.excludeSources.some(source => fromSource(article, source))) return false;
  if (parsed.sites.length && !parsed.sites.some(site => onSite(host, site))) return false;
  if (parsed.excludeSites.some(site => onSite(host, site))) return false;
  const window = newsQueryWindow(parsed, options.now);
  const published = publishedTime(article.publishedAt);
  const outside = published === null
    ? window.explicit
    : (window.from !== null && published < window.from.getTime()) || (window.to !== null && published >= window.to.getTime());
  if (outside) return false;
  if (parsed.exclude.length) {
    const anywhere = prepare(`${article.title}\n${article.snippet ?? ""}\n${article.source ?? ""}`);
    if (parsed.exclude.some(term => termMatches(term, anywhere))) return false;
  }
  if (options.requireTerms === false) return true;
  const text = prepare(`${article.title}\n${article.snippet ?? ""}`);
  return parsed.groups.every(group => group.some(term => termMatches(term, text)));
}

export interface NewsQueryChip { kind: "any" | "exclude" | "source" | "site" | "date"; label: string }

/** Operator chips for the results header, in normalized order. */
export function newsQueryChips(parsed: Structure): NewsQueryChip[] {
  const days = parsed.newerThan?.days;
  return [
    ...parsed.groups.filter(group => group.length > 1).map(group => ({ kind: "any" as const, label: `Any of: ${group.map(termString).join(", ")}` })),
    ...parsed.exclude.map(term => ({ kind: "exclude" as const, label: `Without ${termString(term)}` })),
    ...parsed.sources.map(source => ({ kind: "source" as const, label: `Source: ${source}` })),
    ...parsed.excludeSources.map(source => ({ kind: "exclude" as const, label: `Not from ${source}` })),
    ...parsed.sites.map(site => ({ kind: "site" as const, label: `Site: ${site}` })),
    ...parsed.excludeSites.map(site => ({ kind: "exclude" as const, label: `Not on ${site}` })),
    ...(parsed.after ? [{ kind: "date" as const, label: `On or after ${parsed.after}` }] : []),
    ...(parsed.before ? [{ kind: "date" as const, label: `Before ${parsed.before}` }] : []),
    ...(days ? [{ kind: "date" as const, label: days === 1 ? "Last day" : `Last ${days} days` }] : []),
  ];
}

/** Same search, ignoring case and spacing: how followed searches are matched. */
export const newsQueryKey = (query: string) => parseNewsQuery(query).normalized.toLocaleLowerCase();
