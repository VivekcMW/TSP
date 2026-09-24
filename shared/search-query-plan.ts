import { normalizeKeywords, type KeywordInput, type WeightedKeyword } from "./profile-preferences";

export interface SearchQueryProfile {
  keywords?: readonly KeywordInput[] | null;
  companies?: readonly string[] | null;
  influencers?: readonly string[] | null;
}

/** Server-owned, versioned cursor state. Never accept this from a profile request. */
export interface SearchQueryState {
  version: 3;
  signature: string;
  /** Window starts; only the first served group's start advances per reservation. */
  cursors: [number, number, number];
  groupStart: number;
}

export interface SearchQueryPlan {
  queries: string[];
  state: SearchQueryState;
}

export const SEARCH_QUERY_LIMITS = { queries: 8, signalsPerType: 100, term: 100 } as const;
/**
 * Topics fill half of each refresh's searches: slots follow a repeating topic, company,
 * topic, people pattern (4/2/2 of eight when every group has terms). Topic searches find
 * the stories that match a topic; company and people searches mostly find mentions.
 */
const SLOT_PATTERN = [0, 1, 0, 2] as const;
/** Where the pattern starts for each leading group, so the FIRST slot still rotates evenly. */
const PATTERN_START = [0, 1, 3] as const;
const canonical = (label: string) => label.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;

function boundedLabel(value: unknown): string {
  if (typeof value !== "string" || value.length > SEARCH_QUERY_LIMITS.term) throw new Error("Invalid search term");
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizedGroup(values: unknown, keywords: boolean): WeightedKeyword[] {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > SEARCH_QUERY_LIMITS.signalsPerType) throw new Error("Invalid search signals");
  // Validate every entry before deduplication, including disabled and duplicate
  // terms. First-seen keyword metadata (including zero) matches relevance.
  return normalizeKeywords(values.map((value): KeywordInput => {
    if (typeof value === "string") return boundedLabel(value);
    if (!keywords || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid search signal");
    if (value.category !== undefined && (typeof value.category !== "string" || value.category.length > SEARCH_QUERY_LIMITS.term)) {
      throw new Error("Invalid search category");
    }
    return { keyword: boundedLabel(value.keyword), weight: value.weight, category: value.category };
  })).sort((a, b) => b.weight - a.weight || compare(canonical(a.keyword), canonical(b.keyword)));
}

function freshState(signature: string): SearchQueryState {
  return { version: 3, signature, cursors: [0, 0, 0], groupStart: 0 };
}

function restoredState(value: unknown, signature: string, groups: WeightedKeyword[][]): SearchQueryState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return freshState(signature);
  const state = value as Partial<SearchQueryState>;
  if (state.version !== 3 || state.signature !== signature
    || !Number.isInteger(state.groupStart) || state.groupStart! < 0 || state.groupStart! > 2
    || !Array.isArray(state.cursors) || state.cursors.length !== 3
    || !Array.from(state.cursors).every((cursor, i) => Number.isSafeInteger(cursor) && cursor >= 0 && cursor < Math.max(1, groups[i].length))) {
    return freshState(signature);
  }
  // Copy validated fields only: malformed/extra persisted fields never survive.
  return { version: 3, signature, cursors: [...state.cursors], groupStart: state.groupStart! };
}

/**
 * Pure, bounded deterministic planning. Weights prioritize order WITHIN a cycle,
 * not probability or long-run frequency. Slots follow SLOT_PATTERN (topics get half);
 * the leading slot rotates evenly across the three groups; empty/exhausted slots are
 * redistributed. Local cursors fill each window, but
 * ONLY the first served group's persisted start advances by one AFTER selection.
 * The next turn starts after that actual group, skipping empty groups on service.
 * For unchanged selections and G nonempty groups, every term in a group of n
 * terms leads dispatch within G*n <= 3*n refreshes from any valid state: that
 * group leads once per G runs, and its start advances only on those turns.
 * Advancing every group's start every run would phase-lock when n is divisible
 * by G. Equal-sized groups cover all terms in at most their total distinct count;
 * unequal groups have the bound G*max(group lengths), NOT the total count.
 * Failed fetches still consume a reservation; any nonempty dispatched prefix
 * inherits the first-slot bound, without success/completion acknowledgements.
 * No attempt is guaranteed if a run never starts work; success is not guaranteed.
 *
 * Identity matches relevance: NFKC/case/whitespace, first positive group wins
 * (keyword, company, influencer). A zero keyword does not suppress a company.
 * Distinct input reordering and categories do not reset cursors; substantive
 * normalized selection/weight changes do. Conflicting duplicate keyword metadata
 * remains first-seen, just as in relevance (reordering those IS a semantic edit).
 */
export function planSearchQueries(profile: SearchQueryProfile, previousState: unknown = {}): SearchQueryPlan {
  let normalized: WeightedKeyword[][];
  try {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("Invalid search profile");
    normalized = [normalizedGroup(profile.keywords, true), normalizedGroup(profile.companies, false), normalizedGroup(profile.influencers, false)];
  } catch {
    return { queries: [], state: freshState("") };
  }
  // A collision-free bounded signature, not a lossy hash. Excludes display case
  // and unused category metadata, includes zero and shadowed selections/weights.
  const signature = JSON.stringify(normalized.map(group => group.map(term => [canonical(term.keyword), term.weight])));
  const owned = new Set<string>();
  const groups = normalized.map(group => group.filter(term => {
    const key = canonical(term.keyword);
    if (term.weight === 0 || owned.has(key)) return false;
    owned.add(key);
    return true;
  }));
  const state = restoredState(previousState, signature, groups);
  const localCursors = [...state.cursors];
  const queries: string[] = [];
  const seen = new Set<string>();
  // The leader rotates in plain group order, skipping empty groups, exactly as before;
  // only the slots after it follow the topic-weighted pattern.
  let leader = state.groupStart;
  for (let i = 0; i < 3 && !groups[leader].length; i++) leader = (leader + 1) % 3;
  let slot = PATTERN_START[leader];
  let firstGroup = -1;
  let misses = 0;
  // A full pattern of misses means every group is empty or exhausted.
  while (queries.length < SEARCH_QUERY_LIMITS.queries && misses < SLOT_PATTERN.length) {
    const groupIndex = SLOT_PATTERN[slot];
    const group = groups[groupIndex];
    let next: WeightedKeyword | undefined;
    // Scan the FULL list for the next nonseen term, not just the allocated
    // slice. Advance for duplicates too, including when wrapping mid-reservation.
    for (let inspected = 0; inspected < group.length; inspected++) {
      const candidate = group[localCursors[groupIndex]];
      localCursors[groupIndex] = (localCursors[groupIndex] + 1) % group.length;
      if (!seen.has(canonical(candidate.keyword))) { next = candidate; break; }
    }
    if (next) {
      if (firstGroup < 0) firstGroup = groupIndex;
      queries.push(next.keyword);
      seen.add(canonical(next.keyword));
      misses = 0;
    } else misses++;
    slot = (slot + 1) % SLOT_PATTERN.length;
  }
  if (firstGroup >= 0) {
    state.cursors[firstGroup] = (state.cursors[firstGroup] + 1) % groups[firstGroup].length;
    state.groupStart = (firstGroup + 1) % 3;
  }
  return { queries, state };
}