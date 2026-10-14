import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOverviewMetrics } from "./overview-metrics";
import { fetchAllPages } from "./queryClient";
import type { PublishingSchedule } from "./publishing";

const now = new Date("2026-10-14T12:00:00Z");
function draft(id: string, publishStatus = "draft", publishedAt: string | null = null, createdAt = "2026-10-12T09:00:00Z") {
  return { id, publishStatus, platform: "linkedin", publishedAt: publishedAt ? new Date(publishedAt) : null, createdAt: new Date(createdAt) };
}
function schedule(draftId: string, status: string, states: string[]): PublishingSchedule {
  return { id: `schedule-${draftId}`, draftId, status, scheduledPublishAt: "2026-10-15T09:00:00Z",
    targets: states.map((state, index) => ({ id: `${draftId}-${index}`, platform: "linkedin", status: state })) };
}
afterEach(() => vi.unstubAllGlobals());

describe("dashboard metric mappings", () => {
  it("uses Monday calendar weeks in the publishing timezone, not rolling seven days", () => {
    const result = buildOverviewMetrics([
      draft("before-monday", "published", "2026-10-11T18:29:59Z", "2026-10-10T09:00:00Z"),
      draft("monday", "published", "2026-10-11T18:30:00Z", "2026-10-10T09:00:00Z"),
      draft("today", "published", "2026-10-14T09:00:00Z"),
      draft("prior-monday", "published", "2026-10-04T18:30:00Z", "2026-10-01T09:00:00Z"),
      draft("older", "published", "2026-10-04T18:29:59Z", "2026-10-01T09:00:00Z"),
    ], [], "Asia/Kolkata", now);
    expect(result.publishedThisWeek).toBe(2);
    expect(result.weekDelta).toBe(0);
  });

  it("deduplicates attention by draft and includes partial, unverified, unknown and failed targets", () => {
    const result = buildOverviewMetrics([
      draft("ready"), draft("queued", "queued"), draft("publishing", "publishing"),
      draft("failed", "failed"), draft("partial", "partial"), draft("unknown", "unknown"),
      draft("unverified", "legacy_unverified"), draft("mixed", "scheduled"),
    ], [
      schedule("queued", "scheduled", ["queued"]),
      schedule("publishing", "publishing", ["publishing"]),
      schedule("failed", "failed", ["failed", "failed"]),
      schedule("mixed", "scheduled", ["queued", "failed"]),
      schedule("demo", "simulated", ["simulated"]),
      schedule("cancelled", "cancelled", ["cancelled"]),
    ], "UTC", now);
    expect(result.readyDrafts.map(item => item.id)).toEqual(["ready"]);
    expect(result.scheduledCount).toBe(2);
    expect(result.attentionCount).toBe(5);
  });

  it("uses valid confirmed publication dates for history, streak and nonnegative durations", () => {
    const result = buildOverviewMetrics([
      draft("today", "published", "2026-10-14T09:00:00Z", "2026-10-14T07:00:00Z"),
      draft("yesterday", "published", "2026-10-13T09:00:00Z", "2026-10-13T05:00:00Z"),
      draft("missing", "published"), draft("invalid", "published", "invalid"),
      draft("future", "published", "2026-10-15T09:00:00Z"),
      draft("negative-duration", "published", "2026-10-12T09:00:00Z", "2026-10-13T09:00:00Z"),
      draft("simulated", "simulated", "2026-10-14T09:00:00Z"),
      draft("manual", "manual_published", "2026-10-14T09:00:00Z"),
    ], [], "UTC", now);
    expect(result.published30).toBe(3);
    expect(result.avgPublishHours).toBe(3);
    expect(result.streak).toEqual({ current: 3, longest: 3, postedToday: true });
    expect(result.platforms).toEqual([{ platform: "linkedin", posts: 3 }]);
  });

  it("uses the exact 30-local-day boundary and keeps all-time streak history", () => {
    const result = buildOverviewMetrics([
      draft("outside", "published", "2026-09-14T18:29:59Z", "2026-09-01T00:00:00Z"),
      draft("inside", "published", "2026-09-14T18:30:00Z", "2026-09-01T00:00:00Z"),
      ...["01", "02", "03", "04"].map(day => draft(`old-${day}`, "published", `2026-08-${day}T09:00:00Z`, "2026-08-01T00:00:00Z")),
    ], [], "Asia/Kolkata", now);
    expect(result.published30).toBe(1);
    expect(result.streak.longest).toBe(4);
  });

  it("preserves truthful empty counts and no average without valid samples", () => {
    expect(buildOverviewMetrics([], [], "UTC", now)).toMatchObject({
      publishedThisWeek: 0, published30: 0, attentionCount: 0, scheduledCount: 0,
      avgPublishHours: null, streak: { current: 0, longest: 0, postedToday: false },
    });
  });
});

describe("complete dashboard lists", () => {
  it.each(["/api/drafts", "/api/inbox"])("fetches every page of %s, including records after 200", async url => {
    const first = Array.from({ length: 200 }, (_, index) => ({ id: String(index) }));
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(first)))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "older" }])));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchAllPages(url)).toHaveLength(201);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([`${url}?limit=200&offset=0`, `${url}?limit=200&offset=200`]);
  });

  it("fails instead of returning incomplete totals if a later page is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array(200).fill({ id: "draft" }))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Unavailable" }), { status: 503 })));
    await expect(fetchAllPages("/api/drafts")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects malformed list responses rather than reporting zero", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }))));
    await expect(fetchAllPages("/api/drafts")).rejects.toThrow("complete list");
  });
});
