import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@shared/schema";
import { canChangeSchedule, defaultSchedulePlatforms, draftStatusGroup, fetchPublishingSchedules, publicationOutcome, publishingBlocker, selectionBlockers, type PublishingSchedule, type ReadinessData } from "./publishing";

const draft = { platform: "linkedin", content: "A post to review.", platformPublishRules: {} };
const ready = (): ReadinessData => ({
  profile: { enabledPlatforms: ["linkedin", "twitter", "bluesky"], defaultPlatform: "twitter" } as UserProfile,
  integrations: ["linkedin", "twitter", "bluesky"].map((key) => ({ key, enabled: true })), rules: [],
  connections: Object.fromEntries(["linkedin", "twitter", "bluesky"].map((key) => [key, { connected: true, assessment: { canPublish: true, status: "connected" } }])),
});
function schedule(states: string[], status = "scheduled"): PublishingSchedule {
  return { id: "s", draftId: "d", scheduledPublishAt: "2026-09-20T09:00:00Z", status, targets: states.map((state, index) => ({ id: `t${index}`, platform: "linkedin", status: state })) };
}
afterEach(() => vi.unstubAllGlobals());

describe("publishing outcome safety", () => {
  it.each(["partial", "unknown", "skipped", "failed", "unexpected", "", null])("retains %s in attention", (status) => expect(draftStatusGroup(status)).toBe("attention"));
  it("requires every persisted target and parent to confirm publication", () => {
    expect(publicationOutcome(schedule(["published", "queued"]))).toBe("pending");
    expect(publicationOutcome(schedule(["published", "failed"], "partial"))).toBe("attention");
    expect(publicationOutcome(schedule(["published", "unknown"], "unknown"))).toBe("unknown");
    expect(publicationOutcome(schedule(["skipped"], "completed"))).toBe("unknown");
    expect(publicationOutcome(schedule([], "published"))).toBe("unknown");
    expect(publicationOutcome(schedule(["published", "published"], "published"))).toBe("published");
  });
  it("does not replay delivered or in-flight targets when rescheduling", () => {
    expect(canChangeSchedule(schedule(["scheduled", "queued"]))).toBe(true);
    for (const state of ["unknown", "publishing", "published", "skipped"]) expect(canChangeSchedule(schedule(["scheduled", state]))).toBe(false);
  });
  it("loads beyond the first page to preserve older target recovery", async () => {
    const first = Array.from({ length: 200 }, () => schedule(["published"], "published"));
    const second = schedule(["unknown"], "unknown");
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: first, total: 201 }))).mockResolvedValueOnce(new Response(JSON.stringify({ items: [second], total: 201 })));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchPublishingSchedules()).items).toHaveLength(201);
    expect(fetch.mock.calls[1][0]).toContain("offset=200");
  });
});

describe("real publishing readiness", () => {
  it("does not hard-disable Bluesky and honors saved defaults", () => {
    expect(publishingBlocker("bluesky", draft, ready())).toBeNull();
    expect(defaultSchedulePlatforms(draft, ready())).toEqual(["twitter"]);
  });
  it("global availability wins over a connected account and saved default", () => {
    const data = ready(); data.integrations![1].enabled = false;
    expect(publishingBlocker("twitter", draft, data)).toContain("platform-wide");
    expect(defaultSchedulePlatforms(draft, data)).toEqual(["linkedin"]);
  });
  it("does not infer a live adapter from broad sandbox capabilities", () => {
    const data = ready(); data.integrations!.push({ key: "threads", enabled: true, capabilities: ["publish", "schedule"] });
    expect(publishingBlocker("threads", draft, data)).toContain("Manual copy");
  });
  it("fails closed on unavailable readiness, missing assessments, and expired accounts", () => {
    const data = ready(); data.connections.twitter = { connected: true };
    expect(publishingBlocker("twitter", draft, data)).toContain("reconnect");
    data.connections.twitter = { connected: true, assessment: { canPublish: false, status: "expired", reason: "Token expired" } };
    expect(publishingBlocker("twitter", draft, data)).toBe("Token expired");
    expect(publishingBlocker("linkedin", draft, { ...data, unavailable: true })).toContain("unavailable");
  });
  it("blocks disabled preferences, draft rules, character limits, and empty drafts", () => {
    const data = ready();
    expect(publishingBlocker("twitter", { ...draft, content: "x".repeat(281) }, data)).toContain("Too long");
    expect(publishingBlocker("twitter", { ...draft, platformPublishRules: { twitter: false } }, data)).toContain("rule");
    expect(publishingBlocker("twitter", { ...draft, content: " " }, data)).toContain("content");
    data.rules = [{ platform: "linkedin", enabled: true, minCharacters: 100 }];
    expect(publishingBlocker("linkedin", draft, data)).toContain("at least 100");
    data.profile!.enabledPlatforms = [];
    expect(publishingBlocker("linkedin", draft, data)).toContain("preferences");
  });
  it("enforces one to four target selections", () => {
    expect(selectionBlockers([], draft, ready())).toContain("Select at least one ready platform.");
    expect(selectionBlockers(["linkedin", "twitter", "bluesky", "mastodon", "devto"], draft, ready())).toContain("Select no more than 4 platforms.");
  });
});