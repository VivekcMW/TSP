/**
 * Discover library filtering, sorting and "New" semantics. Pure so the client
 * can apply them to the full paginated history and tests can pin the contract.
 */

/** Mounts within this window continue the same visit (reloads, other tabs, StrictMode). */
export const DISCOVER_VISIT_SESSION_MS = 30 * 60 * 1000;

export type DiscoverAddedWindow = "any" | "today" | "7d" | "30d";
export type DiscoverReading = "all" | "unread" | "read";
export type DiscoverSort = "added" | "relevance" | "published";

export interface DiscoverFilters {
  search: string;
  added: DiscoverAddedWindow;
  topic: string;
  source: string;
  reading: DiscoverReading;
}

export const DEFAULT_DISCOVER_FILTERS: DiscoverFilters = { search: "", added: "any", topic: "", source: "", reading: "all" };
export const DEFAULT_DISCOVER_SORT: DiscoverSort = "added";

type DateLike = Date | string | null | undefined;

export interface DiscoverRow {
  id: string;
  headline: string;
  source: string;
  matchedKeywords?: string[] | null;
  relevanceScore?: string | number | null;
  rankingScore?: string | number | null;
  publishedAt?: DateLike;
  discoveredAt?: DateLike;
  createdAt?: DateLike;
  readAt?: DateLike;
}

function time(value: DateLike): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** When the article entered Discover; legacy rows predate discoveredAt. */
export function addedAt(row: DiscoverRow): number | null {
  return time(row.discoveredAt) ?? time(row.createdAt);
}

export function isRead(row: DiscoverRow, locallyRead?: ReadonlySet<string>): boolean {
  return Boolean(row.readAt) || Boolean(locallyRead?.has(row.id));
}

/** New = added after the previous visit and not explicitly opened. First visit: nothing is New. */
export function isNew(row: DiscoverRow, previousVisitAt: DateLike, locallyRead?: ReadonlySet<string>): boolean {
  const previous = time(previousVisitAt);
  const added = addedAt(row);
  return previous !== null && added !== null && added > previous && !isRead(row, locallyRead);
}

function startOfLocalDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function addedFloor(window: DiscoverAddedWindow, now: number): number | null {
  if (window === "today") return startOfLocalDay(now);
  if (window === "7d") return now - 7 * 86_400_000;
  if (window === "30d") return now - 30 * 86_400_000;
  return null;
}

export function hasActiveDiscoverFilters(filters: DiscoverFilters): boolean {
  return filters.search.trim() !== "" || filters.added !== "any" || filters.topic !== ""
    || filters.source !== "" || filters.reading !== "all";
}

export function filterDiscoverRows<T extends DiscoverRow>(
  rows: readonly T[], filters: DiscoverFilters, options: { now?: number; locallyRead?: ReadonlySet<string> } = {},
): T[] {
  const needle = filters.search.trim().toLocaleLowerCase();
  const floor = addedFloor(filters.added, options.now ?? Date.now());
  return rows.filter(row => {
    const keywords = row.matchedKeywords ?? [];
    if (needle && ![row.headline, row.source, ...keywords].some(text => text?.toLocaleLowerCase().includes(needle))) return false;
    if (floor !== null) {
      const added = addedAt(row);
      if (added === null || added < floor) return false;
    }
    if (filters.topic && !keywords.includes(filters.topic)) return false;
    if (filters.source && row.source !== filters.source) return false;
    if (filters.reading !== "all" && isRead(row, options.locallyRead) !== (filters.reading === "read")) return false;
    return true;
  });
}

function score(row: DiscoverRow): number {
  const value = Number(row.rankingScore ?? row.relevanceScore ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** Stable: ties keep the server's relevance order. Missing dates sort last. */
export function sortDiscoverRows<T extends DiscoverRow>(rows: readonly T[], sort: DiscoverSort): T[] {
  const key = (row: DiscoverRow): number | null =>
    sort === "relevance" ? score(row) : sort === "published" ? time(row.publishedAt) : addedAt(row);
  return rows
    .map((row, index) => ({ row, index, value: key(row) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1;
      return b.value - a.value || a.index - b.index;
    })
    .map(entry => entry.row);
}

/** Sorted distinct option lists for the Topic and Source filters. */
export function discoverFacets(rows: readonly DiscoverRow[]): { topics: string[]; sources: string[] } {
  const topics = new Set<string>();
  const sources = new Set<string>();
  for (const row of rows) {
    for (const keyword of row.matchedKeywords ?? []) if (keyword) topics.add(keyword);
    if (row.source) sources.add(row.source);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  return { topics: Array.from(topics).sort(byName), sources: Array.from(sources).sort(byName) };
}

/** "Added 5m ago" style label, distinct from the publication date label. */
export function addedRelativeLabel(row: DiscoverRow, now: number = Date.now()): string | null {
  const added = addedAt(row);
  if (added === null) return null;
  const minutes = Math.max(0, Math.floor((now - added) / 60_000));
  if (minutes < 1) return "Added just now";
  if (minutes < 60) return `Added ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Added ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Added ${days}d ago`;
  return `Added ${new Date(added).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}
