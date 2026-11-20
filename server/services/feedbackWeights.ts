import { FEED_PREFERENCE_LIMITS as LIMITS, type DismissReason, type FeedbackLearned, type FeedPreferenceRestore, type FeedPreferenceSkipped, type InboxFeedbackKind } from "@shared/schema";

/** Pure rules for learning from "Not relevant" reasons and calibration votes. No I/O. */
export interface FeedPreferences { mutedSources: string[]; keywordAdjustments: Record<string, number> }
export interface FeedbackItem { id: string; source: string; matchedKeywords: string[] }
export interface PreferenceChange { mute: string[]; keywordSteps: Array<{ keyword: string; step: number }> }
export interface NewFeedback { inboxItemId: string; kind: InboxFeedbackKind; reason: DismissReason | null; source: string | null; keywords: string[] }
export type CalibrationVote = "relevant" | "not_relevant" | "skip";
export interface CalibrationApply { moreAbout: string[]; lessAbout: string[]; mute: string[] }

export const LESS_ABOUT_STEP = -0.2;
export const MORE_ABOUT_STEP = 0.1;
/** At most this many keywords are recorded or adjusted per story. */
export const KEYWORDS_PER_STORY = 10;
export const EMPTY_FEED_PREFERENCES: Readonly<FeedPreferences> = Object.freeze({ mutedSources: [], keywordAdjustments: {} });

export class FeedbackInputError extends Error {}

/** Display form: NFKC, single spaces, trimmed. */
export const cleanLabel = (label: string) => label.normalize("NFKC").replace(/\s+/gu, " ").trim();
/** Comparison form, matching the relevance scorer's normalization. */
export const preferenceKey = (label: string) => cleanLabel(label).toLowerCase();
const round = (value: number) => Math.round(value * 1000) / 1000;
const sameDelta = (a: number | null, b: number | null) => a === null || b === null ? a === b : round(a) === round(b);
const clampDelta = (value: number) => round(Math.min(LIMITS.maxDelta, Math.max(LIMITS.minDelta, value)));
const validLabel = (value: unknown, max: number): value is string => typeof value === "string" && cleanLabel(value).length > 0 && cleanLabel(value).length <= max;

function uniqueLabels(labels: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  return labels.filter(label => validLabel(label, max)).map(cleanLabel)
    .filter(label => !seen.has(preferenceKey(label)) && Boolean(seen.add(preferenceKey(label))));
}

/** Stored JSON is read defensively: invalid entries are dropped and caps applied. */
export function sanitizePreferences(raw: { mutedSources?: unknown; keywordAdjustments?: unknown } | null | undefined): FeedPreferences {
  const sources = Array.isArray(raw?.mutedSources) ? uniqueLabels(raw.mutedSources, LIMITS.source).slice(-LIMITS.mutedSources) : [];
  const adjustments: Record<string, number> = {};
  const seen = new Set<string>();
  const entries = raw?.keywordAdjustments && typeof raw.keywordAdjustments === "object" && !Array.isArray(raw.keywordAdjustments)
    ? Object.entries(raw.keywordAdjustments as Record<string, unknown>) : [];
  for (const [label, delta] of entries) {
    if (!validLabel(label, LIMITS.keyword) || typeof delta !== "number" || !Number.isFinite(delta)) continue;
    const key = preferenceKey(label);
    const value = clampDelta(delta);
    if (seen.has(key) || value === 0 || seen.size >= LIMITS.keywordAdjustments) continue;
    seen.add(key);
    adjustments[cleanLabel(label)] = value;
  }
  return { mutedSources: sources, keywordAdjustments: adjustments };
}

const findLabel = (labels: Iterable<string>, label: string) => {
  const key = preferenceKey(label);
  for (const existing of labels) if (preferenceKey(existing) === key) return existing;
  return undefined;
};

/** Smallest effect goes first when the keyword list is full (jsonb objects keep no insertion order). */
function weakestKeyword(adjustments: Record<string, number>): string | undefined {
  return Object.entries(adjustments).sort(([a, x], [b, y]) => Math.abs(x) - Math.abs(y) || a.localeCompare(b, "en"))[0]?.[0];
}

/** Applies a change, returning the next preferences, what actually changed and a compare-and-set undo. */
export function applyPreferenceChange(current: FeedPreferences, change: PreferenceChange): { next: FeedPreferences; learned: FeedbackLearned; undo: FeedPreferenceRestore } {
  const sources = [...current.mutedSources];
  const keywords: Record<string, number> = { ...current.keywordAdjustments };
  const learned: FeedbackLearned = { moreAbout: [], lessAbout: [], muted: [] };
  // Values before the change of every key it touched (including ones evicted to make room).
  const sourcesBefore = new Map<string, boolean>();
  const keywordsBefore = new Map<string, number | null>();
  const touchSource = (label: string) => { if (!sourcesBefore.has(label)) sourcesBefore.set(label, Boolean(findLabel(sources, label))); };
  const touchKeyword = (label: string) => { if (!keywordsBefore.has(label)) keywordsBefore.set(label, keywords[label] ?? null); };
  for (const source of uniqueLabels(change.mute, LIMITS.source)) {
    if (findLabel(sources, source)) continue;
    if (sources.length >= LIMITS.mutedSources) {
      touchSource(sources[0]);
      sources.shift();
    }
    touchSource(source);
    sources.push(source);
    learned.muted.push(source);
  }
  for (const { keyword, step } of change.keywordSteps) {
    if (!validLabel(keyword, LIMITS.keyword) || !Number.isFinite(step) || step === 0) continue;
    const label = findLabel(Object.keys(keywords), keyword) ?? cleanLabel(keyword);
    const before = keywords[label] ?? 0;
    const after = clampDelta(before + step);
    if (after === before) continue;
    touchKeyword(label);
    if (after === 0) delete keywords[label];
    else {
      if (!(label in keywords) && Object.keys(keywords).length >= LIMITS.keywordAdjustments) {
        const dropped = weakestKeyword(keywords)!;
        touchKeyword(dropped);
        delete keywords[dropped];
      }
      keywords[label] = after;
    }
    (step > 0 ? learned.moreAbout : learned.lessAbout).push(label);
  }
  const undo: FeedPreferenceRestore = { keywords: {}, sources: {} };
  for (const [label, before] of sourcesBefore) {
    const after = Boolean(findLabel(sources, label));
    if (after !== before) undo.sources[label] = { before, after };
  }
  for (const [label, before] of keywordsBefore) {
    const after = keywords[label] ?? null;
    if (!sameDelta(after, before)) undo.keywords[label] = { before, after };
  }
  return { next: { mutedSources: sources, keywordAdjustments: keywords }, learned, undo };
}

/**
 * Compare-and-set undo, run under the preferences row lock: a key goes back to `before` only while it still
 * holds `after`. A key changed again elsewhere (another tab, a later reason) keeps its newer value and is reported.
 */
export function restorePreferences(current: FeedPreferences, restore: FeedPreferenceRestore): { next: FeedPreferences; skipped: FeedPreferenceSkipped } {
  let sources = [...current.mutedSources];
  const keywords: Record<string, number> = { ...current.keywordAdjustments };
  const skipped: FeedPreferenceSkipped = { keywords: [], sources: [] };
  for (const [source, { before, after }] of Object.entries(restore.sources)) {
    if (!validLabel(source, LIMITS.source)) continue;
    const existing = findLabel(sources, source);
    if (Boolean(existing) !== after) { skipped.sources.push(cleanLabel(source)); continue; }
    if (!before && existing) sources = sources.filter(item => item !== existing);
    if (before && !existing) sources.push(cleanLabel(source));
  }
  for (const [keyword, { before, after }] of Object.entries(restore.keywords)) {
    if (!validLabel(keyword, LIMITS.keyword)) continue;
    const existing = findLabel(Object.keys(keywords), keyword);
    if (!sameDelta(existing ? keywords[existing] : null, after)) { skipped.keywords.push(existing ?? cleanLabel(keyword)); continue; }
    if (existing) delete keywords[existing];
    if (before !== null && Number.isFinite(before) && clampDelta(before) !== 0) keywords[existing ?? cleanLabel(keyword)] = clampDelta(before);
  }
  return { next: sanitizePreferences({ mutedSources: sources.slice(-LIMITS.mutedSources), keywordAdjustments: keywords }), skipped };
}

/** Removing one learned item, as a restore built from the locked current state (so it always applies). */
export function removalRestore(current: FeedPreferences, target: { source: string } | { keyword: string }): FeedPreferenceRestore {
  if ("source" in target) {
    const existing = findLabel(current.mutedSources, target.source);
    return { keywords: {}, sources: existing ? { [existing]: { before: false, after: true } } : {} };
  }
  const existing = findLabel(Object.keys(current.keywordAdjustments), target.keyword);
  return { sources: {}, keywords: existing ? { [existing]: { before: null, after: current.keywordAdjustments[existing] } } : {} };
}

/** Undo for "Reset all": brings back what the reset cleared, without wiping anything learned since. */
export function resetRestore(previous: FeedPreferences): FeedPreferenceRestore {
  return {
    keywords: Object.fromEntries(Object.entries(previous.keywordAdjustments).map(([label, delta]) => [label, { before: delta, after: null }])),
    sources: Object.fromEntries(previous.mutedSources.map(source => [source, { before: true, after: false }])),
  };
}

function storyKeywords(item: FeedbackItem): string[] {
  return uniqueLabels(item.matchedKeywords ?? [], LIMITS.keyword).slice(0, KEYWORDS_PER_STORY);
}

/** Only the story's own labels can be adjusted; anything else is rejected. */
function pick(available: readonly string[], wanted: readonly string[]): string[] {
  return uniqueLabels(wanted, LIMITS.keyword).map(label => {
    const match = findLabel(available, label);
    if (!match) throw new FeedbackInputError("Choose topics from this story.");
    return match;
  });
}

/**
 * "Not my topic" lowers the story's matched keywords; "Don't trust this source" mutes it.
 * Other reasons are recorded only, unless the person ticked a box. Ticked boxes always win.
 */
export function dismissChange(reason: DismissReason, item: FeedbackItem, choice: { muteSource?: boolean; lessAbout?: readonly string[] } = {}): { change: PreferenceChange; feedback: NewFeedback } {
  const available = storyKeywords(item);
  const lessAbout = choice.lessAbout === undefined ? (reason === "not_my_topic" ? available : []) : pick(available, choice.lessAbout);
  const source = validLabel(item.source, LIMITS.source) ? cleanLabel(item.source) : null;
  const mute = (choice.muteSource ?? reason === "untrusted_source") && source ? [source] : [];
  return {
    change: { mute, keywordSteps: lessAbout.map(keyword => ({ keyword, step: LESS_ABOUT_STEP })) },
    feedback: { inboxItemId: item.id, kind: "dismiss", reason, source, keywords: lessAbout.length ? lessAbout : available },
  };
}

/** Proposed by the client from the votes; every change must be backed by a matching vote. */
export function calibrationChange(votes: ReadonlyArray<{ id: string; vote: CalibrationVote }>, items: readonly FeedbackItem[], apply: CalibrationApply): { change: PreferenceChange; feedback: NewFeedback[] } {
  const byId = new Map(items.map(item => [item.id, item]));
  const voted = votes.filter(vote => vote.vote !== "skip" && byId.has(vote.id)).map(vote => ({ vote: vote.vote, item: byId.get(vote.id)! }));
  const of = (kind: CalibrationVote) => voted.filter(entry => entry.vote === kind).map(entry => entry.item);
  const up = of("relevant"), down = of("not_relevant");
  const moreAbout = pick(up.flatMap(storyKeywords), apply.moreAbout);
  const lessAbout = pick(down.flatMap(storyKeywords), apply.lessAbout);
  if (moreAbout.some(label => findLabel(lessAbout, label))) throw new FeedbackInputError("A topic cannot be both more and less.");
  const mute = uniqueLabels(apply.mute, LIMITS.source).map(source => {
    const match = findLabel(down.map(item => cleanLabel(item.source)), source);
    if (!match || findLabel(up.map(item => cleanLabel(item.source)), source)) throw new FeedbackInputError("Mute only sources you marked not relevant.");
    return match;
  });
  return {
    change: { mute, keywordSteps: [...moreAbout.map(keyword => ({ keyword, step: MORE_ABOUT_STEP })), ...lessAbout.map(keyword => ({ keyword, step: LESS_ABOUT_STEP }))] },
    feedback: voted.map(({ vote, item }) => ({ inboxItemId: item.id, kind: vote === "relevant" ? "calibration_up" : "calibration_down", reason: null,
      source: validLabel(item.source, LIMITS.source) ? cleanLabel(item.source) : null, keywords: storyKeywords(item) })),
  };
}

export const mutedSourceKeys = (preferences: FeedPreferences): ReadonlySet<string> => new Set(preferences.mutedSources.map(preferenceKey));
export const isMutedSource = (source: string | null | undefined, muted: ReadonlySet<string>) => muted.size > 0 && typeof source === "string" && muted.has(preferenceKey(source));
