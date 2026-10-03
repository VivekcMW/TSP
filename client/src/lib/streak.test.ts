import { describe, expect, it } from "vitest";
import { computeStreak } from "./streak";

describe("computeStreak", () => {
  it("returns all zeros for no published history", () => {
    expect(computeStreak([], "UTC", new Date("2026-10-01T12:00:00Z"))).toEqual({ current: 0, longest: 0, postedToday: false });
  });

  it("counts a streak that includes today", () => {
    const now = new Date("2026-10-01T18:00:00Z");
    const published = ["2026-09-29T09:00:00Z", "2026-09-30T09:00:00Z", "2026-10-01T09:00:00Z"];
    expect(computeStreak(published, "UTC", now)).toEqual({ current: 3, longest: 3, postedToday: true });
  });

  it("keeps a streak alive through today if yesterday was posted but today has not happened yet", () => {
    const now = new Date("2026-10-01T06:00:00Z");
    const published = ["2026-09-28T09:00:00Z", "2026-09-29T09:00:00Z", "2026-09-30T09:00:00Z"];
    expect(computeStreak(published, "UTC", now)).toEqual({ current: 3, longest: 3, postedToday: false });
  });

  it("breaks the streak after a full missed day", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const published = ["2026-09-28T09:00:00Z", "2026-09-29T09:00:00Z", "2026-09-30T09:00:00Z"];
    expect(computeStreak(published, "UTC", now)).toEqual({ current: 0, longest: 3, postedToday: false });
  });

  it("tracks the longest streak separately from the current one", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const published = ["2026-09-01T09:00:00Z", "2026-09-02T09:00:00Z", "2026-09-03T09:00:00Z", "2026-09-04T09:00:00Z", "2026-09-05T09:00:00Z", "2026-10-10T09:00:00Z"];
    expect(computeStreak(published, "UTC", now)).toEqual({ current: 1, longest: 5, postedToday: true });
  });

  it("dedupes multiple posts on the same day into a single streak day", () => {
    const now = new Date("2026-10-01T18:00:00Z");
    const published = ["2026-10-01T09:00:00Z", "2026-10-01T15:00:00Z", "2026-09-30T09:00:00Z"];
    expect(computeStreak(published, "UTC", now)).toEqual({ current: 2, longest: 2, postedToday: true });
  });

  it("ignores null/undefined entries", () => {
    const now = new Date("2026-10-01T18:00:00Z");
    expect(computeStreak([null, undefined, "2026-10-01T09:00:00Z"], "UTC", now)).toEqual({ current: 1, longest: 1, postedToday: true });
  });

  it("respects a non-UTC time zone for day boundaries", () => {
    // 2026-10-01T23:30 UTC is already 2026-10-02 05:00 in Asia/Kolkata (+5:30).
    const now = new Date("2026-10-02T04:00:00Z");
    const published = ["2026-10-01T23:30:00Z"];
    expect(computeStreak(published, "Asia/Kolkata", now)).toEqual({ current: 1, longest: 1, postedToday: true });
  });
});
