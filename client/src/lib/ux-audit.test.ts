import { describe, expect, it } from "vitest";
import { buildPublishingActivity } from "./publishing-activity";
import { normalizeOnboardingChoices, visibleOnboardingChoices } from "./onboarding-choices";
import { isRefreshJobRunning, refreshJobMessage, type RefreshJobState } from "../hooks/use-inbox-refresh-job";

describe("UX audit data helpers", () => {
  it("keeps selected AI and custom values visible ahead of catalog choices", () => {
    expect(visibleOnboardingChoices(["Catalog", "AI source"], ["AI Source", "Custom"]))
      .toEqual(["AI Source", "Custom", "Catalog"]);
  });
  it("normalizes malformed suggestions and respects the server list cap", () => {
    expect(normalizeOnboardingChoices([null, "", "  ", "Custom", "custom", 1])).toEqual(["Custom"]);
    expect(normalizeOnboardingChoices("wrong shape")).toEqual([]);
    expect(normalizeOnboardingChoices(Array.from({ length: 30 }, (_, i) => `Choice ${i}`))).toHaveLength(20);
  });
  it("uses identical calendar boundaries for charts and counts, with ISO strings", () => {
    const now = new Date(2026, 8, 17, 12);
    const record = (date: Date | string | null, status = "published") => ({ platform: "twitter", publishStatus: status, publishedAt: date instanceof Date ? date.toISOString() : date });
    const result = buildPublishingActivity([
      record(new Date(2026, 8, 11, 0)), record(now), record(new Date(2026, 8, 10, 23, 59)),
      record(new Date(2026, 8, 17, 13)), record(null), record("invalid"), record(now, "draft"),
    ], 7, now);
    expect(result.published).toHaveLength(2);
    expect(result.activity).toHaveLength(7);
    expect(result.activity.reduce((sum, day) => sum + day.published, 0)).toBe(2);
    expect(result.platforms).toEqual([{ platform: "twitter", posts: 2 }]);
    expect(result.missingDates).toBe(2);
  });
  it("handles empty records as a genuine zero and crosses month boundaries", () => {
    const result = buildPublishingActivity([], 7, new Date(2026, 2, 3, 12));
    expect(result.published).toEqual([]);
    expect(result.start.getMonth()).toBe(1);
    expect(result.activity.every((day) => day.published === 0)).toBe(true);
  });
  it.each(["completed", "failed", "unavailable", "idle"] as const)("does not poll %s", (status) => {
    expect(isRefreshJobRunning({ status, progress: { articlesProcessed: 0, articlesMatched: 0, articlesCreated: 0 } })).toBe(false);
  });
  it("doesn't turn queued jobs or needs-setup completion into immediate success", () => {
    const state: RefreshJobState = { status: "queued", progress: { articlesProcessed: 0, articlesMatched: 0, articlesCreated: 0 } };
    expect(refreshJobMessage(state)).toContain("Waiting for a worker");
    expect(refreshJobMessage({ ...state, status: "completed", progress: { ...state.progress, needsSetup: true } })).toContain("Add a source or topic");
  });
});