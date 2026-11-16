import { describe, expect, it } from "vitest";
import { inboxHref, inboxTimeLabel, matchesLabel, parseInboxLocation, selectionAfterRemoval, snoozeLabel, snoozePresets, topicLabels, topPicks } from "./inbox-view";

const row = (id: string, source: string, score: number) => ({ id, headline: id, source, relevanceScore: String(score) });

describe("Inbox locations", () => {
  it("round-trips folders, tabs and labels and rejects unknown values", () => {
    expect(parseInboxLocation("")).toEqual({ folder: "inbox", tab: "top", label: null });
    expect(parseInboxLocation("?tab=signals&label=Retail%20media")).toEqual({ folder: "inbox", tab: "signals", label: "Retail media" });
    expect(parseInboxLocation("?folder=shortlist&tab=signals")).toEqual({ folder: "shortlist", tab: "stories", label: null });
    expect(parseInboxLocation("?folder=spam&tab=promotions")).toEqual({ folder: "inbox", tab: "top", label: null });
    expect(inboxHref({ folder: "inbox", tab: "signals", label: "AI" })).toBe("/dashboard?tab=signals&label=AI");
    expect(inboxHref({ folder: "dismissed" })).toBe("/dashboard?folder=dismissed");
    expect(inboxHref()).toBe("/dashboard");
  });

  it("parses post folders and never applies topic labels to your own posts", () => {
    expect(parseInboxLocation("?folder=drafts&label=AI")).toEqual({ folder: "drafts", tab: "stories", label: null });
    expect(parseInboxLocation("?folder=snoozed&label=AI")).toEqual({ folder: "snoozed", tab: "stories", label: "AI" });
    expect(inboxHref({ folder: "posted" })).toBe("/dashboard?folder=posted");
  });
});

describe("Snooze", () => {
  // 2026-11-16 is a Monday.
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 30);
  const presets = (now: Date) => snoozePresets(now).map(preset => [preset.id, preset.until.toString()]);

  it("offers Gmail's presets in local time and drops ones that would repeat or have passed", () => {
    expect(presets(at(16, 9))).toEqual([
      ["later", new Date(2026, 10, 16, 18).toString()], ["tomorrow", new Date(2026, 10, 17, 8).toString()],
      ["weekend", new Date(2026, 10, 21, 8).toString()], ["next-week", new Date(2026, 10, 23, 8).toString()],
    ]);
    expect(presets(at(20, 17)).map(([id]) => id)).toEqual(["tomorrow", "next-week"]);
    expect(presets(at(22, 10))).toEqual([["later", new Date(2026, 10, 22, 18).toString()], ["tomorrow", new Date(2026, 10, 23, 8).toString()]]);
    expect(presets(at(21, 10)).map(([id, until]) => [id, until])).toContainEqual(["next-week", new Date(2026, 10, 23, 8).toString()]);
  });

  it("labels return times relative to today", () => {
    const now = at(16, 9);
    expect(snoozeLabel(new Date(2026, 10, 16, 18), now, "en-US")).toBe("Today, 6:00 PM");
    expect(snoozeLabel(new Date(2026, 10, 17, 8), now, "en-US")).toBe("Tomorrow, 8:00 AM");
    expect(snoozeLabel(new Date(2026, 10, 21, 8), now, "en-US")).toBe("Sat, 8:00 AM");
    expect(snoozeLabel(new Date(2026, 11, 1, 8), now, "en-US")).toBe("Dec 1, 8:00 AM");
    expect(snoozeLabel(new Date(2027, 0, 4, 8), now, "en-US")).toBe("Jan 4, 2027, 8:00 AM");
  });
});

describe("Topic labels", () => {
  it("keeps the strongest positive keywords, case-insensitively unique, in a stable order", () => {
    expect(topicLabels([{ keyword: "Retail media", weight: 0.4 }, "Measurement", { keyword: "Ignored", weight: 0 }, { keyword: "measurement", weight: 1 }, { keyword: "D2C", weight: 0.9 }]))
      .toEqual(["measurement", "D2C", "Retail media"]);
    expect(topicLabels(Array.from({ length: 9 }, (_, index) => `Topic ${index}`))).toHaveLength(5);
    expect(topicLabels(null)).toEqual([]);
  });

  it("filters rows by an exact matched keyword", () => {
    expect(matchesLabel({ matchedKeywords: ["Retail Media"] }, "retail media")).toBe(true);
    expect(matchesLabel({ matchedKeywords: ["Retail Media Weekly"] }, "retail media")).toBe(false);
    expect(matchesLabel({ matchedKeywords: null }, null)).toBe(true);
  });
});

describe("Top picks", () => {
  it("diversifies sources before filling from the remaining ranked rows", () => {
    const rows = [row("a1", "A", 0.9), row("a2", "A", 0.8), row("b1", "B", 0.7), row("c1", "C", 0.1)];
    expect(topPicks(rows, 3).map(item => item.id)).toEqual(["a1", "b1", "c1"]);
    expect(topPicks(rows, 4).map(item => item.id)).toEqual(["a1", "b1", "c1", "a2"]);
    expect(topPicks([], 5)).toEqual([]);
  });
});

describe("List time and selection", () => {
  it("shows time today, month and day this year, and a short date for older rows", () => {
    const now = new Date(2026, 10, 16, 15, 0);
    expect(inboxTimeLabel({ id: "x", headline: "", source: "", createdAt: new Date(2026, 10, 16, 9, 5).toISOString() }, now, "en-US")).toBe("9:05 AM");
    expect(inboxTimeLabel({ id: "x", headline: "", source: "", createdAt: new Date(2026, 10, 2).toISOString() }, now, "en-US")).toBe("Nov 2");
    expect(inboxTimeLabel({ id: "x", headline: "", source: "", createdAt: new Date(2025, 0, 9).toISOString() }, now, "en-US")).toBe("1/9/25");
    expect(inboxTimeLabel({ id: "x", headline: "", source: "" }, now)).toBe("");
  });

  it("advances to the next remaining row, then the previous, after triage", () => {
    const ids = ["a", "b", "c", "d"];
    expect(selectionAfterRemoval(ids, new Set(["b"]), "b")).toBe("c");
    expect(selectionAfterRemoval(ids, new Set(["c", "d"]), "d")).toBe("b");
    expect(selectionAfterRemoval(ids, new Set(["a"]), "c")).toBe("c");
    expect(selectionAfterRemoval(["a"], new Set(["a"]), "a")).toBeNull();
  });
});
