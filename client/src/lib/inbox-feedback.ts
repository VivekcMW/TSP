import { useSyncExternalStore } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { storeUndoSeconds } from "@/lib/linkedin-compose";
import { INBOX_LIST_KEYS, inboxStatusKey, type InboxRow, type InboxStatus } from "@/lib/inbox-queries";
import type { DismissReason, FeedbackLearned, FeedbackResult, FeedPreferenceRestore, FeedPreferencesChange, FeedPreferenceSkipped, FeedPreferencesReset, FeedPreferencesView } from "@shared/schema";

export const FEED_PREFERENCES_KEY = ["/api/feed-preferences"] as const;

export const DISMISS_REASON_OPTIONS: ReadonlyArray<{ id: DismissReason; label: string; prefill: "topics" | "source" | null }> = [
  { id: "not_my_topic", label: "Not my topic", prefill: "topics" },
  { id: "wrong_audience", label: "Wrong audience or region", prefill: null },
  { id: "untrusted_source", label: "Don't trust this source", prefill: "source" },
  { id: "old_news", label: "Old news", prefill: null },
  { id: "already_covered", label: "Already covered it", prefill: null },
];

const remember = <T extends { preferences: FeedPreferencesView }>(result: T): T => {
  queryClient.setQueryData(FEED_PREFERENCES_KEY, result.preferences);
  return result;
};

export async function sendDismissFeedback(id: string, body: { reason: DismissReason; muteSource: boolean; lessAbout: string[] }): Promise<FeedbackResult> {
  return remember(await (await apiRequest("POST", `/api/inbox/${encodeURIComponent(id)}/feedback`, body)).json() as FeedbackResult);
}

export type CalibrationVote = "relevant" | "not_relevant" | "skip";
export interface CalibrationProposal { moreAbout: string[]; lessAbout: string[]; mute: string[] }

export async function sendCalibration(votes: Array<{ id: string; vote: CalibrationVote }>, apply: CalibrationProposal): Promise<FeedbackResult> {
  return remember(await (await apiRequest("POST", "/api/inbox/calibration", { votes, apply })).json() as FeedbackResult);
}

/** Undo (compare-and-set: keys changed again elsewhere are kept and reported as skipped), or removes one learned item. */
export async function changeFeedPreferences(body: { restore: FeedPreferenceRestore; feedbackId?: string } | { unmuteSource: string } | { resetKeyword: string }): Promise<FeedPreferencesChange> {
  return remember(await (await apiRequest("PATCH", "/api/feed-preferences", body)).json() as FeedPreferencesChange);
}

/** The response carries the exact state that was cleared and the server-built undo for it. */
export async function resetFeedPreferences(): Promise<FeedPreferencesReset> {
  return remember(await (await apiRequest("DELETE", "/api/feed-preferences")).json() as FeedPreferencesReset);
}

export const KEPT_ELSEWHERE = "Some changes were kept because they were updated elsewhere.";
/** Toast copy after an Undo, honest about keys that were left alone. */
export function undoneToast(skipped: FeedPreferenceSkipped, title = "Change undone"): { title: string; description?: string } {
  return skipped.keywords.length + skipped.sources.length ? { title, description: KEPT_ELSEWHERE } : { title };
}

const listOf = (labels: string[]) => labels.length > 2 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels.join(" and ");

/** Plain toast copy for what a change taught, or null when nothing changed. */
export function learnedSummary(learned: FeedbackLearned): string | null {
  const parts = [
    learned.moreAbout.length ? `more about ${listOf(learned.moreAbout)}` : "",
    learned.lessAbout.length ? `less about ${listOf(learned.lessAbout)}` : "",
    learned.muted.length ? `${listOf(learned.muted)} muted` : "",
  ].filter(Boolean);
  return parts.length ? `Got it: ${parts.join("; ")}` : null;
}

export const changedSomething = (undo: FeedPreferenceRestore) => Object.keys(undo.keywords).length + Object.keys(undo.sources).length > 0;

const sourceKey = (source: string) => source.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();

/** Stories still in For you from these sources (offered "Move them" after a mute). */
export function storiesFrom(sources: readonly string[]): InboxRow[] {
  if (!sources.length) return [];
  const keys = new Set(sources.map(sourceKey));
  return (queryClient.getQueryData<InboxRow[]>(inboxStatusKey("active")) ?? []).filter(row => row.status === "active" && keys.has(sourceKey(row.source)));
}

/** Moves stories one at a time; keeps what moved when a later move fails. */
export async function moveStories(ids: readonly string[], to: InboxStatus): Promise<{ moved: string[]; error: string | null }> {
  const moved: string[] = [];
  let error: string | null = null;
  for (const id of ids) {
    try { await apiRequest("PATCH", `/api/inbox/${encodeURIComponent(id)}`, { status: to }); moved.push(id); }
    catch (cause) { error = cause instanceof Error ? cause.message : "The story could not be moved."; break; }
  }
  if (moved.length) {
    const gone = new Set(moved);
    for (const key of INBOX_LIST_KEYS) queryClient.setQueryData<InboxRow[]>(key, current => current?.filter(row => !gone.has(row.id)));
    void queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
  }
  return { moved, error };
}

/** Rated stories → proposed changes: a topic leans one way to be proposed; a source is proposed for muting only if never marked relevant. */
export function proposeCalibration(stories: ReadonlyArray<Pick<InboxRow, "id" | "source" | "matchedKeywords">>, votes: Readonly<Record<string, CalibrationVote>>): CalibrationProposal {
  const topics = new Map<string, { label: string; net: number }>();
  const sources = new Map<string, { label: string; up: number; down: number }>();
  for (const story of stories) {
    const vote = votes[story.id];
    if (vote !== "relevant" && vote !== "not_relevant") continue;
    const sign = vote === "relevant" ? 1 : -1;
    const seen = new Set<string>();
    for (const label of (story.matchedKeywords ?? []).slice(0, 10)) {
      const key = sourceKey(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = topics.get(key) ?? { label: label.trim(), net: 0 };
      entry.net += sign;
      topics.set(key, entry);
    }
    const key = sourceKey(story.source ?? "");
    if (!key) continue;
    const entry = sources.get(key) ?? { label: story.source.trim(), up: 0, down: 0 };
    if (sign > 0) entry.up++; else entry.down++;
    sources.set(key, entry);
  }
  const ranked = (sign: number) => [...topics.values()].filter(topic => topic.net * sign > 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.label.localeCompare(b.label)).slice(0, 3).map(topic => topic.label);
  return {
    moreAbout: ranked(1), lessAbout: ranked(-1),
    mute: [...sources.values()].filter(source => source.down > 0 && source.up === 0).sort((a, b) => b.down - a.down || a.label.localeCompare(b.label)).slice(0, 3).map(source => source.label),
  };
}

// Local display preferences, shared between Quick settings and the Inbox list.
export type InboxDensity = "comfortable" | "compact";
export type ReadingPane = "right" | "off";
const LAYOUT_EVENT = "tsp:inbox-layout";
const DENSITY_KEY = "tsp:inbox-density";
const PANE_KEY = "tsp:inbox-reading-pane";
const CALIBRATION_KEY = "tsp:feed-calibration";

function readChoice<T extends string>(key: string, options: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return options.includes(value as T) ? value as T : fallback;
  } catch { return fallback; }
}
function writeChoice(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Preference only. */ }
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}
const subscribe = (notify: () => void) => {
  window.addEventListener(LAYOUT_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(LAYOUT_EVENT, notify); window.removeEventListener("storage", notify); };
};

export const readDensity = () => readChoice<InboxDensity>(DENSITY_KEY, ["comfortable", "compact"], "comfortable");
export const readReadingPane = () => readChoice<ReadingPane>(PANE_KEY, ["right", "off"], "right");
export const storeDensity = (density: InboxDensity) => writeChoice(DENSITY_KEY, density);
export const storeReadingPane = (pane: ReadingPane) => writeChoice(PANE_KEY, pane);
export const useDensity = () => useSyncExternalStore(subscribe, readDensity);
export const useReadingPane = () => useSyncExternalStore(subscribe, readReadingPane);

/** "done" after Apply, "dismissed" when the banner was closed; either hides the prompt. */
export const readCalibration = () => readChoice<"done" | "dismissed" | "none">(CALIBRATION_KEY, ["done", "dismissed"], "none");
export const storeCalibration = (value: "done" | "dismissed") => writeChoice(CALIBRATION_KEY, value);
export const useCalibration = () => useSyncExternalStore(subscribe, readCalibration);

/** The composer listens for this so a new undo window applies to the next post. */
export const UNDO_SECONDS_EVENT = "tsp:post-undo-seconds";
export function setPostUndoSeconds(seconds: number) {
  storeUndoSeconds(seconds);
  window.dispatchEvent(new Event(UNDO_SECONDS_EVENT));
}
