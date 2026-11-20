import { addedAt, sortDiscoverRows, type DiscoverRow } from "./discover";

/** Gmail-style Inbox navigation for the LinkedIn workspace. Pure so URLs and ranking stay testable. */
export const STORY_FOLDERS = ["inbox", "shortlist", "snoozed", "dismissed"] as const;
export type StoryFolder = typeof STORY_FOLDERS[number];
/** Your own LinkedIn posts, like Gmail's Drafts / Scheduled / Sent / Outbox. */
export const POST_FOLDERS = ["drafts", "scheduled", "posted", "outbox"] as const;
export type PostFolder = typeof POST_FOLDERS[number];
/** Workspace views that are neither stories nor posts (topic ideas, plan and strategy). */
export const WORKSPACE_FOLDERS = ["ideas"] as const;
export type WorkspaceFolder = typeof WORKSPACE_FOLDERS[number];
export const INBOX_FOLDERS = [...STORY_FOLDERS, ...WORKSPACE_FOLDERS, ...POST_FOLDERS] as const;
export type InboxFolder = typeof INBOX_FOLDERS[number];
export const INBOX_TABS = ["top", "stories", "signals"] as const;
export type InboxTab = typeof INBOX_TABS[number];
export const TOP_PICKS_LIMIT = 5;
export const MAX_TOPIC_LABELS = 5;

/** Server inbox status behind each story folder. Snoozed stories stay active but are hidden from For you. */
export const FOLDER_STATUS: Record<StoryFolder, "active" | "saved" | "dismissed"> = {
  inbox: "active", shortlist: "saved", snoozed: "active", dismissed: "dismissed",
};

/** `news` is a keyword news search (Phase 3A); `saved` the followed search it came from. Both null otherwise. */
export interface InboxLocation { folder: InboxFolder; tab: InboxTab; label: string | null; news: string | null; saved: string | null }
export const NEWS_QUERY_MAX = 300;

const oneOf = <T extends string>(values: readonly T[], value: string | null): value is T => value !== null && (values as readonly string[]).includes(value);
export const isPostFolder = (folder: InboxFolder): folder is PostFolder => oneOf(POST_FOLDERS, folder);
export const isStoryFolder = (folder: InboxFolder): folder is StoryFolder => oneOf(STORY_FOLDERS, folder);

export function parseInboxLocation(search: string): InboxLocation {
  const params = new URLSearchParams(search);
  const folder = params.get("folder");
  const tab = params.get("tab");
  const resolved: InboxFolder = oneOf(INBOX_FOLDERS, folder) ? folder : "inbox";
  // Topic labels filter stories, never your own posts.
  const label = isPostFolder(resolved) ? null : params.get("label")?.trim().slice(0, 100) || null;
  const news = params.get("news")?.trim().slice(0, NEWS_QUERY_MAX) || null;
  const saved = news ? params.get("saved")?.trim().slice(0, 100) || null : null;
  // Tabs only exist in For you; other folders are a single list.
  return { folder: resolved, tab: resolved === "inbox" && oneOf(INBOX_TABS, tab) ? tab : resolved === "inbox" ? "top" : "stories", label, news, saved };
}

export function inboxHref({ folder = "inbox", tab = "top", label = null, news = null, saved = null }: Partial<InboxLocation> = {}): string {
  const params = new URLSearchParams();
  if (news?.trim()) {
    params.set("news", news.trim().slice(0, NEWS_QUERY_MAX));
    if (saved) params.set("saved", saved);
    return `/dashboard?${params}`;
  }
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

export interface SnoozePreset { id: "later" | "tomorrow" | "weekend" | "next-week"; label: string; until: Date }

/** Gmail's snooze menu in local time: later today 6 PM, tomorrow 8 AM, Saturday 8 AM, next Monday 8 AM. */
export function snoozePresets(now: Date = new Date()): SnoozePreset[] {
  const at = (days: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date;
  };
  const day = now.getDay();
  const presets: SnoozePreset[] = [];
  if (now.getHours() < 17) presets.push({ id: "later", label: "Later today", until: at(0, 18) });
  presets.push({ id: "tomorrow", label: "Tomorrow", until: at(1, 8) });
  // Monday–Thursday only; on Friday Saturday is already "Tomorrow".
  if (day >= 1 && day <= 4) presets.push({ id: "weekend", label: "This weekend", until: at(6 - day, 8) });
  // On Sunday, next Monday is already "Tomorrow".
  if (day !== 0) presets.push({ id: "next-week", label: "Next week", until: at(8 - day, 8) });
  return presets;
}

/** "Today, 6:00 PM", "Tomorrow, 8:00 AM", "Sat, 8:00 AM" within a week, else the date. */
export function snoozeLabel(until: Date, now: Date = new Date(), locale?: string): string {
  const time = until.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(until) - startOf(now)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days > 1 && days < 7) return `${until.toLocaleDateString(locale, { weekday: "short" })}, ${time}`;
  return `${until.toLocaleDateString(locale, { month: "short", day: "numeric", ...(until.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) })}, ${time}`;
}
