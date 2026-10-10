import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draft, UserProfile } from "@shared/schema";
import { platformTextValidation } from "@shared/editorial";
import { usablePost } from "./editorial";
import { canChangeSchedule, defaultSchedulePlatforms, draftStatusGroup, fetchDraftDetails, fetchDraftPublishStatus, fetchPublishingSchedules, publicationOutcome, publishingBlocker, recheckPublishingRecovery, scheduleConfirmationKey, selectionBlockers, subscribePublishingRecovery, type PublishingSchedule, type ReadinessData } from "./publishing";
import { capturePublishingConsent, assertPublishingConsent, PublishingConsentError } from "@shared/publishing-consent";

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
  it("reads exact full details independently of list pagination and rejects wrong-ID or narrow editing snapshots", async () => {
    const id = "older/é + ?";
    const detail = { ...draft, id, tone: "professional", publishStatus: "legacy_unverified", updatedAt: null, media: [], publishedAt: null };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(detail)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...detail, id: "other" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id, content: draft.content, platform: "linkedin", tone: "professional", updatedAt: null })));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(await fetchDraftDetails(id, controller.signal)).toEqual(detail);
    expect(fetch.mock.calls[0][0]).toBe(`/api/drafts/${encodeURIComponent(id)}/details`);
    expect(fetch.mock.calls[0][1].cache).toBe("no-store");
    controller.abort(); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await expect(fetchDraftDetails(id)).rejects.toThrow("could not be verified");
    await expect(fetchDraftDetails(id)).rejects.toThrow("could not be verified");
  });
  it.each([404, 403, 503])("preserves detail-read HTTP %s instead of treating it as a list miss", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Unavailable" }), { status })));
    await expect(fetchDraftDetails("d")).rejects.toMatchObject({ status });
  });
  it.each(["partial", "unknown", "skipped", "failed", "unexpected", "", null])("retains %s in attention", (status) => expect(draftStatusGroup(status)).toBe("attention"));
  it("requires every persisted target and parent to confirm publication", () => {
    expect(publicationOutcome(schedule(["published", "queued"]))).toBe("pending");
    expect(publicationOutcome(schedule(["published", "failed"], "partial"))).toBe("attention");
    expect(publicationOutcome(schedule(["published", "unknown"], "unknown"))).toBe("attention");
    expect(publicationOutcome(schedule(["skipped"], "completed"))).toBe("unknown");
    expect(publicationOutcome(schedule([], "published"))).toBe("unknown");
    expect(publicationOutcome(schedule(["published", "published"], "published"))).toBe("published");
  });
  it("does not replay delivered or in-flight targets when rescheduling", () => {
    expect(canChangeSchedule(schedule(["scheduled", "queued"]))).toBe(true);
    for (const state of ["unknown", "publishing", "published", "skipped"]) expect(canChangeSchedule(schedule(["scheduled", state]))).toBe(false);
  });
  it.each([
    [["published", "published"], "scheduled"], [["published"], "failed"],
    [["failed", "cancelled"], "publishing"], [["failed"], "published"],
    [["published", "failed"], "cancelled"], [["cancelled"], "future-state"],
    [["cancelled"], "failed"], [["cancelled"], "partial"], [["failed"], "partial"],
  ])("keeps mixed-time %j / %s snapshots unconfirmed", (states, parent) => {
    expect(publicationOutcome(schedule(states as string[], parent as string))).toBe("unknown");
  });
  it.each([
    [["failed", "cancelled"], "failed"], [["published", "cancelled"], "partial"],
    [["cancelled"], "cancelled"],
  ])("still terminates reconciled recovery outcomes %j / %s", (states, parent) => {
    expect(publicationOutcome(schedule(states as string[], parent as string))).toBe("attention");
  });
  it("only notifies active recovery subscribers, not query invalidation consumers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePublishingRecovery(listener);
    recheckPublishingRecovery("d");
    expect(listener).toHaveBeenCalledExactlyOnceWith("d");
    unsubscribe();
    recheckPublishingRecovery("d");
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it("fetches one draft with cancellation and rejects mismatched/malformed snapshots", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ schedule: schedule(["published"], "published") })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schedule: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schedule: { ...schedule(["published"], "published"), draftId: "other" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({})));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect((await fetchDraftPublishStatus("d", controller.signal))?.status).toBe("published");
    expect(fetch.mock.calls[0][0]).toBe("/api/drafts/d/publish-status");
    controller.abort();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(await fetchDraftPublishStatus("d")).toBeUndefined();
    await expect(fetchDraftPublishStatus("d")).rejects.toThrow("unavailable");
    await expect(fetchDraftPublishStatus("d")).rejects.toThrow("unavailable");
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
  it.each([
    { name: "long URL", content: `Read https://news.test/${"x".repeat(700)}` },
    { name: "multiple URLs", content: "https://a.test/a https://b.test/b!" },
    { name: "Unicode at max", content: "😀".repeat(140) },
    { name: "Unicode over max", content: "😀".repeat(140) + "!" },
    { name: "blank", content: " \n\t" },
    { name: "raw cap", content: "https://a.test/" + "x".repeat(5000) },
  ])("agrees with Create and shared validation for $name", ({ content }) => {
    const validation = platformTextValidation(content, "twitter", 280);
    const blocked = publishingBlocker("twitter", { ...draft, content }, ready());
    expect(blocked === null).toBe(validation.error === null);
    expect(usablePost(content, 280, "twitter")).toBe(blocked === null);
  });
  it("uses weighted custom minimum/maximum values, not raw link length", () => {
    const data = ready();
    const linked = { ...draft, content: `https://a.test/${"x".repeat(700)} https://b.test/a` };
    data.rules = [{ platform: "twitter", enabled: true, minCharacters: 47, maxCharacters: 47 }];
    expect(publishingBlocker("twitter", linked, data)).toBeNull();
    data.rules[0].minCharacters = 48;
    expect(publishingBlocker("twitter", linked, data)).toContain("at least 48");
    data.rules[0] = { platform: "twitter", enabled: true, maxCharacters: 46 };
    expect(publishingBlocker("twitter", linked, data)).toContain("47/46");
    data.rules[0].maxCharacters = 5000;
    expect(publishingBlocker("twitter", { ...draft, content: "x".repeat(281) }, data)).toContain("281/280");
  });
  it("distinguishes simulation, unverified acceptance and manual claims", () => {
    expect(publicationOutcome(schedule(["simulated"], "simulated"))).toBe("simulated");
    for (const state of ["accepted_unverified", "manual_published"]) {
      expect(publicationOutcome(schedule([state], state))).toBe("attention");
      expect(draftStatusGroup(state)).not.toBe("published");
      expect(canChangeSchedule(schedule([state]))).toBe(false);
    }
  });
  it("requires explicit review when preferences require it", () => {
    const data = ready(); data.profile!.requirePublishReview = true;
    expect(publishingBlocker("linkedin", draft, data)).toContain("approve");
    expect(publishingBlocker("linkedin", { ...draft, publishApprovedAt: new Date() }, data)).toBeNull();
  });
  it("does not hard-disable Bluesky and prefers the draft destination over profile defaults", () => {
    expect(publishingBlocker("bluesky", draft, ready())).toBeNull();
    expect(defaultSchedulePlatforms(draft, ready())).toEqual(["linkedin"]);
    expect(defaultSchedulePlatforms({ ...draft, platform: "" }, ready())).toEqual(["twitter"]);
    expect(defaultSchedulePlatforms(undefined, ready())).toEqual([]);
  });
  it("never substitutes the default for a blocked or manual-only draft destination", () => {
    const data = ready(); data.connections.linkedin = { connected: false };
    expect(defaultSchedulePlatforms(draft, data)).toEqual([]);
    expect(defaultSchedulePlatforms({ ...draft, platform: "medium" }, ready())).toEqual([]);
    data.profile!.requirePublishReview = true;
    expect(defaultSchedulePlatforms(draft, data)).toEqual([]);
    data.connections = ready().connections;
    expect(defaultSchedulePlatforms({ ...draft, publishApprovedAt: new Date() }, data)).toEqual(["linkedin"]);
  });
  it("binds confirmation to exact text/revision, media, rules, destinations and wall time/zone", () => {
    const candidate = { ...draft, id: "d", updatedAt: new Date("2026-09-20T00:00:00Z"), media: [] } as unknown as Draft;
    const key = (value = candidate, platforms = ["linkedin"], date = "2026-09-21", time = "09:00", zone = "UTC") => scheduleConfirmationKey(value, platforms, date, time, zone);
    const original = key();
    expect(key({ ...candidate })).toBe(original);
    for (const changed of [
      key({ ...candidate, content: `${candidate.content} ` }), key({ ...candidate, updatedAt: new Date("2026-09-21T00:00:00Z") }),
      key({ ...candidate, platformPublishRules: { twitter: false } }), key({ ...candidate, media: [{ id: "m", type: "image", name: "Image", url: "/m" }] }),
      key(candidate, ["twitter"]), key(candidate, ["linkedin"], "2026-09-22"), key(candidate, ["linkedin"], "2026-09-21", "10:00"),
      key(candidate, ["linkedin"], "2026-09-21", "09:00", "Asia/Kolkata"),
    ]) expect(changed).not.toBe(original);
  });
  it("invalidates scheduling consent for a changed target generation/revision even if platform and draft text are unchanged", () => {
    const candidate = { ...draft, id: "d", updatedAt: null, media: [] } as unknown as Draft;
    const original = { ...schedule(["scheduled"]), updatedAt: null, targets: [{ id: "t", platform: "linkedin", status: "scheduled", revision: 0, updatedAt: null }] };
    const key = (value = original) => scheduleConfirmationKey(candidate, ["linkedin"], "2030-01-02", "09:00", "UTC", value);
    const consent = capturePublishingConsent(candidate, original)!;
    expect(consent.expectedUpdatedAt).toBeNull();
    for (const changed of [
      { ...original, targets: [{ ...original.targets[0], id: "replacement" }] },
      { ...original, targets: [{ ...original.targets[0], revision: 1 }] },
      { ...original, status: "cancelled" },
    ]) {
      expect(key(changed)).not.toBe(key());
      expect(() => assertPublishingConsent(consent, candidate, changed)).toThrow(PublishingConsentError);
    }
    expect(capturePublishingConsent({ content: "A" }, null)).toBeUndefined();
    expect(capturePublishingConsent(candidate, { ...original, targets: undefined })).toBeUndefined();
    expect(() => assertPublishingConsent(consent, candidate, { ...original, targets: [...original.targets].reverse() })).not.toThrow();
  });
  it("global availability wins over a connected account and saved default", () => {
    const data = ready(); data.integrations![1].enabled = false;
    expect(publishingBlocker("twitter", draft, data)).toContain("platform-wide");
    expect(defaultSchedulePlatforms(draft, data)).toEqual(["linkedin"]);
  });
  it("does not infer a live adapter from broad sandbox capabilities", () => {
    const data = ready(); data.integrations!.push({ key: "substack", enabled: true, capabilities: ["publish", "schedule"] });
    expect(publishingBlocker("substack", draft, data)).toContain("Manual copy");
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
    expect(selectionBlockers(["linkedin", "linkedin"], draft, ready())).toContain("Select distinct platforms.");
  });
});