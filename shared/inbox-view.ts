import { addedAt, sortDiscoverRows, type DiscoverRow } from "./discover";

/** Gmail-style Inbox navigation for the LinkedIn workspace. Pure so URLs and ranking stay testable. */
export const INBOX_FOLDERS = ["inbox", "shortlist", "dismissed"] as const;
export type InboxFolder = typeof INBOX_FOLDERS[number];
export const INBOX_TABS = ["top", "stories", "signals"] as const;
export type InboxTab = typeof INBOX_TABS[number];
export const TOP_PICKS_LIMIT = 5;
export const MAX_TOPIC_LABELS = 5;

/** Server inbox status behind each folder. */
export const FOLDER_STATUS: Record<InboxFolder, "active" | "saved" | "dismissed"> = {
  inbox: "active", shortlist: "saved", dismissed: "dismissed",
};

export interface InboxLocation { folder: InboxFolder; tab: InboxTab; label: string | null }

const oneOf = <T extends string>(values: readonly T[], value: string | null): value is T => value !== null && (values as readonly string[]).includes(value);

export function parseInboxLocation(search: string): InboxLocation {
  const params = new URLSearchParams(search);
  const folder = params.get("folder");
  const tab = params.get("tab");
  const label = params.get("label")?.trim().slice(0, 100) || null;
  const resolved: InboxFolder = oneOf(INBOX_FOLDERS, folder) ? folder : "inbox";
  // Tabs only exist in For you; other folders are a single list.
  return { folder: resolved, tab: resolved === "inbox" && oneOf(INBOX_TABS, tab) ? tab : resolved === "inbox" ? "top" : "stories", label };
}

export function inboxHref({ folder = "inbox", tab = "top", label = null }: Partial<InboxLocation> = {}): string {
  const params = new URLSearchParams();
  if (folder !== "inbox") params.set("folder", folder);
  if (folder === "inbox" && tab !== "top") params.set("tab", tab);
  if (label) params.set("label", label);
  const query = params.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}

type KeywordInput = string | { keyword: string; weight?: number | null };

/** Strongest positively weighted profile keywords become labels (Gmail labels → content pillars). */
export function topicLabels(keywords: readonly KeywordInput[] | null | undefined, limit = MAX_TOPIC_LABELS): string[] {
  const seen = new Set<string>();
  return (keywords ?? [])
    .map((entry, index) => typeof entry === "string" ? { keyword: entry, weight: 0.7, index } : { keyword: entry.keyword, weight: entry.weight ?? 0.7, index })
    .filter(entry => entry.keyword?.trim() && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map(entry => entry.keyword.trim())
    .filter(keyword => !seen.has(keyword.toLocaleLowerCase()) && Boolean(seen.add(keyword.toLocaleLowerCase())))
    .slice(0, limit);
}

export function matchesLabel(row: Pick<DiscoverRow, "matchedKeywords">, label: string | null): boolean {
  if (!label) return true;
  const wanted = label.toLocaleLowerCase();
  return (row.matchedKeywords ?? []).some(keyword => keyword.toLocaleLowerCase() === wanted);
}

/** Highest ranked first, at most one story per source, then fill from the rest. Never padded beyond real rows. */
export function topPicks<T extends DiscoverRow>(rows: readonly T[], limit = TOP_PICKS_LIMIT): T[] {
  const ranked = sortDiscoverRows(rows, "relevance");
  const picked: T[] = [];
  const sources = new Set<string>();
  for (const row of ranked) {
    const source = row.source.trim().toLocaleLowerCase();
    if (sources.has(source)) continue;
    sources.add(source);
    picked.push(row);
    if (picked.length === limit) return picked;
  }
  for (const row of ranked) {
    if (picked.length === limit) break;
    if (!picked.includes(row)) picked.push(row);
  }
  return picked;
}

/** Gmail list time: today shows the time, this year the date, older the full date. */
export function inboxTimeLabel(row: DiscoverRow, now: Date = new Date(), locale?: string): string {
  const added = addedAt(row);
  if (added === null) return "";
  const date = new Date(added);
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return date.toLocaleDateString(locale, { year: "2-digit", month: "numeric", day: "numeric" });
}

/** After triage removes rows, keep reading in place: the next row, else the previous one. */
export function selectionAfterRemoval(orderedIds: readonly string[], removed: ReadonlySet<string>, currentId: string | null): string | null {
  if (!currentId || !removed.has(currentId)) return currentId;
  const index = orderedIds.indexOf(currentId);
  const after = orderedIds.slice(index + 1).find(id => !removed.has(id));
  if (after) return after;
  return [...orderedIds.slice(0, Math.max(0, index))].reverse().find(id => !removed.has(id)) ?? null;
}
