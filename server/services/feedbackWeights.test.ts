import { describe, expect, it } from "vitest";
import {
  applyPreferenceChange, calibrationChange, dismissChange, EMPTY_FEED_PREFERENCES, FeedbackInputError, isMutedSource, LESS_ABOUT_STEP, MORE_ABOUT_STEP,
  mutedSourceKeys, removalRestore, resetRestore, restorePreferences, sanitizePreferences, type FeedbackItem, type FeedPreferences,
} from "./feedbackWeights";

const story = (id: string, source: string, matchedKeywords: string[] = []): FeedbackItem => ({ id, source, matchedKeywords });
const prefs = (mutedSources: string[] = [], keywordAdjustments: Record<string, number> = {}): FeedPreferences => ({ mutedSources, keywordAdjustments });
const none = { mute: [], keywordSteps: [] };
const kept = { keywords: [], sources: [] };
const less = (keyword: string) => ({ mute: [], keywordSteps: [{ keyword, step: LESS_ABOUT_STEP }] });

describe("sanitizePreferences", () => {
  it("keeps valid entries, clamps deltas and drops duplicates, zeros and junk", () => {
    expect(sanitizePreferences({
      mutedSources: ["Wire  Daily", "wire daily", "", 42, "x".repeat(201), "Ad Brief"],
      keywordAdjustments: { "Retail media": -0.9, "retail  MEDIA": 0.2, AI: 0.7, Zero: 0, Bad: "0.2", [" "]: 0.1 },
    })).toEqual({ mutedSources: ["Wire Daily", "Ad Brief"], keywordAdjustments: { "Retail media": -0.6, AI: 0.4 } });
  });

  it("returns empty preferences for missing or malformed rows", () => {
    expect(sanitizePreferences(undefined)).toEqual(EMPTY_FEED_PREFERENCES);
    expect(sanitizePreferences({ mutedSources: "Wire", keywordAdjustments: ["AI"] })).toEqual(EMPTY_FEED_PREFERENCES);
  });

  it("caps both lists at 100 entries", () => {
    const many = Array.from({ length: 120 }, (_, index) => `Item ${index}`);
    const clean = sanitizePreferences({ mutedSources: many, keywordAdjustments: Object.fromEntries(many.map(label => [label, -0.2])) });
    expect(clean.mutedSources).toHaveLength(100);
    expect(clean.mutedSources[0]).toBe("Item 20");
    expect(Object.keys(clean.keywordAdjustments)).toHaveLength(100);
  });
});

describe("applyPreferenceChange", () => {
  it("lowers keywords within the range, reporting only real changes with an exact undo", () => {
    const current = prefs([], { "Retail media": -0.5 });
    const { next, learned, undo } = applyPreferenceChange(current, { mute: [], keywordSteps: [
      { keyword: "retail media", step: LESS_ABOUT_STEP }, { keyword: "CTV", step: LESS_ABOUT_STEP },
    ] });
    expect(next.keywordAdjustments).toEqual({ "Retail media": -0.6, CTV: -0.2 });
    expect(learned).toEqual({ moreAbout: [], lessAbout: ["Retail media", "CTV"], muted: [] });
    expect(undo).toEqual({ keywords: { "Retail media": { before: -0.5, after: -0.6 }, CTV: { before: null, after: -0.2 } }, sources: {} });
    expect(restorePreferences(next, undo)).toEqual({ next: current, skipped: kept });

    const floor = applyPreferenceChange(next, { mute: [], keywordSteps: [{ keyword: "Retail media", step: LESS_ABOUT_STEP }] });
    expect(floor.learned.lessAbout).toEqual([]);
    expect(floor.undo).toEqual({ keywords: {}, sources: {} });
  });

  it("removes a keyword that returns to neutral and caps boosts at +0.4", () => {
    expect(applyPreferenceChange(prefs([], { AI: -0.1 }), { mute: [], keywordSteps: [{ keyword: "AI", step: MORE_ABOUT_STEP }] }).next).toEqual(prefs());
    const boosted = applyPreferenceChange(prefs([], { AI: 0.35 }), { mute: [], keywordSteps: [{ keyword: "AI", step: MORE_ABOUT_STEP }] });
    expect(boosted.next.keywordAdjustments).toEqual({ AI: 0.4 });
    expect(boosted.learned.moreAbout).toEqual(["AI"]);
  });

  it("mutes a source once, case-insensitively", () => {
    const first = applyPreferenceChange(prefs(["Ad Brief"]), { mute: ["Wire Daily", "wire  daily", "ad brief"], keywordSteps: [] });
    expect(first.next.mutedSources).toEqual(["Ad Brief", "Wire Daily"]);
    expect(first.learned.muted).toEqual(["Wire Daily"]);
    expect(first.undo).toEqual({ keywords: {}, sources: { "Wire Daily": { before: false, after: true } } });
    expect(restorePreferences(first.next, first.undo)).toEqual({ next: prefs(["Ad Brief"]), skipped: kept });
  });

  it("makes room at the caps and Undo brings back what was dropped", () => {
    const sources = Array.from({ length: 100 }, (_, index) => `Source ${index}`);
    const keywords = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`Topic ${index}`, index === 7 ? -0.1 : -0.3]));
    const current = prefs(sources, keywords);
    const { next, undo } = applyPreferenceChange(current, { mute: ["New source"], keywordSteps: [{ keyword: "New topic", step: LESS_ABOUT_STEP }] });
    expect(next.mutedSources).toHaveLength(100);
    expect(next.mutedSources).not.toContain("Source 0");
    expect(Object.keys(next.keywordAdjustments)).toHaveLength(100);
    expect(next.keywordAdjustments).not.toHaveProperty("Topic 7");
    expect(undo).toEqual({
      keywords: { "New topic": { before: null, after: -0.2 }, "Topic 7": { before: -0.1, after: null } },
      sources: { "Source 0": { before: true, after: false }, "New source": { before: false, after: true } },
    });
    const { next: restored, skipped } = restorePreferences(next, undo);
    expect(skipped).toEqual(kept);
    expect(new Set(restored.mutedSources)).toEqual(new Set(sources));
    expect(restored.keywordAdjustments).toEqual(keywords);
  });

  it("changes nothing for an empty change", () => {
    const current = prefs(["Wire"], { AI: 0.1 });
    expect(applyPreferenceChange(current, none)).toEqual({ next: current, learned: { moreAbout: [], lessAbout: [], muted: [] }, undo: { keywords: {}, sources: {} } });
  });
});

describe("restorePreferences (compare-and-set undo)", () => {
  it("keeps a newer value for the same keyword from another tab and reports it", () => {
    const tab1 = applyPreferenceChange(prefs(), less("AI"));
    const tab2 = applyPreferenceChange(tab1.next, less("ai"));
    expect(tab2.next.keywordAdjustments).toEqual({ AI: -0.4 });
    expect(restorePreferences(tab2.next, tab1.undo)).toEqual({ next: prefs([], { AI: -0.4 }), skipped: { keywords: ["AI"], sources: [] } });
  });

  it("reverts untouched keys while keeping changed ones, and reports a source changed elsewhere", () => {
    const tab1 = applyPreferenceChange(prefs(), { mute: ["Wire Daily"], keywordSteps: [{ keyword: "AI", step: LESS_ABOUT_STEP }, { keyword: "CTV", step: LESS_ABOUT_STEP }] });
    const elsewhere = restorePreferences(applyPreferenceChange(tab1.next, less("CTV")).next, removalRestore(tab1.next, { source: "wire daily" })).next;
    expect(elsewhere).toEqual(prefs([], { AI: -0.2, CTV: -0.4 }));
    expect(restorePreferences(elsewhere, tab1.undo)).toEqual({ next: prefs([], { CTV: -0.4 }), skipped: { keywords: ["CTV"], sources: ["Wire Daily"] } });
  });

  it("removes one source or keyword from the current state, matching case-insensitively", () => {
    const current = prefs(["Wire Daily", "Ad Brief"], { "Retail media": -0.2, AI: 0.1 });
    expect(restorePreferences(current, removalRestore(current, { source: "wire daily" }))).toEqual({ next: prefs(["Ad Brief"], current.keywordAdjustments), skipped: kept });
    expect(restorePreferences(current, removalRestore(current, { keyword: "retail MEDIA" }))).toEqual({ next: prefs(current.mutedSources, { AI: 0.1 }), skipped: kept });
    expect(removalRestore(current, { keyword: "Unknown" })).toEqual({ keywords: {}, sources: {} });
  });

  it("undoes a reset without wiping what was learned after it", () => {
    const previous = prefs(["Wire Daily", "Ad Brief"], { Crypto: -0.2, AI: 0.1 });
    const learnedSince = prefs(["Ad Brief"], { Crypto: -0.4 });
    expect(restorePreferences(learnedSince, resetRestore(previous))).toEqual({
      next: prefs(["Ad Brief", "Wire Daily"], { Crypto: -0.4, AI: 0.1 }), skipped: { keywords: ["Crypto"], sources: ["Ad Brief"] },
    });
    expect(restorePreferences(prefs(), resetRestore(previous))).toEqual({ next: prefs(["Wire Daily", "Ad Brief"], { Crypto: -0.2, AI: 0.1 }), skipped: kept });
  });
});

describe("dismissChange", () => {
  const item = story("s1", " Wire Daily ", ["Retail media", "CTV", "retail media"]);

  it("lowers the story's keywords for Not my topic", () => {
    const { change, feedback } = dismissChange("not_my_topic", item);
    expect(change).toEqual({ mute: [], keywordSteps: [{ keyword: "Retail media", step: LESS_ABOUT_STEP }, { keyword: "CTV", step: LESS_ABOUT_STEP }] });
    expect(feedback).toEqual({ inboxItemId: "s1", kind: "dismiss", reason: "not_my_topic", source: "Wire Daily", keywords: ["Retail media", "CTV"] });
  });

  it("mutes the source for Don't trust this source", () => {
    expect(dismissChange("untrusted_source", item).change).toEqual({ mute: ["Wire Daily"], keywordSteps: [] });
  });

  it.each(["wrong_audience", "old_news", "already_covered"] as const)("records %s only", reason => {
    const { change, feedback } = dismissChange(reason, item);
    expect(change).toEqual(none);
    expect(feedback).toMatchObject({ reason, keywords: ["Retail media", "CTV"] });
  });

  it("follows the ticked boxes over the reason's defaults", () => {
    expect(dismissChange("not_my_topic", item, { lessAbout: ["ctv"], muteSource: true }).change)
      .toEqual({ mute: ["Wire Daily"], keywordSteps: [{ keyword: "CTV", step: LESS_ABOUT_STEP }] });
    expect(dismissChange("untrusted_source", item, { muteSource: false, lessAbout: [] }).change).toEqual(none);
  });

  it("rejects topics that are not on the story", () => {
    expect(() => dismissChange("not_my_topic", item, { lessAbout: ["Crypto"] })).toThrow(FeedbackInputError);
  });
});

describe("calibrationChange", () => {
  const items = [story("a", "Wire Daily", ["Retail media", "CTV"]), story("b", "Ad Brief", ["Crypto"]), story("c", "Ad Brief", ["Crypto", "CTV"]), story("d", "Data Desk", ["AI"])];
  const votes = [{ id: "a", vote: "relevant" }, { id: "b", vote: "not_relevant" }, { id: "c", vote: "not_relevant" }, { id: "d", vote: "skip" }] as const;

  it("applies only changes backed by votes and records one row per non-skip vote", () => {
    const { change, feedback } = calibrationChange(votes, items, { moreAbout: ["retail media"], lessAbout: ["Crypto"], mute: ["ad brief"] });
    expect(change).toEqual({ mute: ["Ad Brief"], keywordSteps: [{ keyword: "Retail media", step: MORE_ABOUT_STEP }, { keyword: "Crypto", step: LESS_ABOUT_STEP }] });
    expect(feedback.map(entry => [entry.inboxItemId, entry.kind])).toEqual([["a", "calibration_up"], ["b", "calibration_down"], ["c", "calibration_down"]]);
    expect(calibrationChange(votes, items, { moreAbout: [], lessAbout: [], mute: [] }).change).toEqual(none);
  });

  it.each([
    ["a topic from a skipped story", { moreAbout: ["AI"], lessAbout: [], mute: [] }],
    ["a topic both more and less", { moreAbout: ["CTV"], lessAbout: ["CTV"], mute: [] }],
    ["a source marked relevant", { moreAbout: [], lessAbout: [], mute: ["Wire Daily"] }],
    ["an unknown source", { moreAbout: [], lessAbout: [], mute: ["Elsewhere"] }],
  ])("rejects %s", (_label, apply) => {
    expect(() => calibrationChange(votes, items, apply)).toThrow(FeedbackInputError);
  });

  it("ignores votes for stories that no longer exist", () => {
    expect(calibrationChange([{ id: "gone", vote: "relevant" }], items, { moreAbout: [], lessAbout: [], mute: [] }).feedback).toEqual([]);
  });
});

describe("muted sources", () => {
  it("matches names after normalization only when something is muted", () => {
    const muted = mutedSourceKeys(prefs(["Wire Daily"]));
    expect(isMutedSource("  wire   DAILY ", muted)).toBe(true);
    expect(isMutedSource("Wire Daily Extra", muted)).toBe(false);
    expect(isMutedSource(undefined, muted)).toBe(false);
    expect(isMutedSource("Wire Daily", new Set())).toBe(false);
  });
});
