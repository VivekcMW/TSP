import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailPreferenceDefaults } from "@shared/email-preferences";
import type { TenantScope } from "../storage";
import type { getEmailPreferences } from "../services/email/preferences";

const m = vi.hoisted(() => ({ scopes: vi.fn(), preferences: vi.fn(), watch: vi.fn() }));
vi.mock("../db", () => ({ db: new Proxy({}, { get() { throw new Error("No database in email planning tests"); } }) }));
vi.mock("../storage", () => ({ storage: { getSchedulerScopes: m.scopes } }));
vi.mock("../services/email", () => ({ deliverAppEmail: vi.fn(() => { throw new Error("Use injected delivery"); }) }));
vi.mock("../services/email/preferences", () => ({ getEmailPreferences: m.preferences }));
vi.mock("./email-watch-alerts", () => ({ sendWatchAlertsForScope: m.watch }));
import { pickTopStories, planWeek, runPlanningEmailCycle, sendMondayPlanForScope, sendTopPicksForScope, type TopPickCandidate } from "./email-planning";

const scope: TenantScope = { tenantId: "tenant", userId: "user" };
// Monday 16 November 2026, 09:30 in Kolkata.
const MONDAY_IST = new Date("2026-11-16T04:00:00Z");
const prefs = (overrides: Partial<typeof emailPreferenceDefaults> & { unsubscribedAt?: Date | null } = {}) =>
  ({ userId: "user", ...emailPreferenceDefaults, digestTimezone: "Asia/Kolkata", digestTime: "09:00", unsubscribedAt: null, ...overrides });
/** Stored rows also carry id and timestamps; the jobs only read the preference values. */
const returning = (value: ReturnType<typeof prefs>) => vi.fn(async () => value) as unknown as typeof getEmailPreferences;
const moment = (id: string, startsOn: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: `Moment ${id}`, startsOn, endsOn: null, region: "global", tags: ["retail"], leadDays: 14, url: null, description: null, ...extra });

function planDeps(overrides: Record<string, unknown> = {}) {
  return {
    getEmailPreferences: returning(prefs()),
    loadRecipient: vi.fn(async () => ({ email: "reader@example.invalid", name: "Asha" })),
    loadPlanData: vi.fn(async () => ({ profile: { keywords: [{ keyword: "Retail media", weight: 0.9 }], searchEdition: "en-IN" },
      posts: [{ content: "Why retail media budgets moved this quarter", at: new Date("2026-11-17T05:00:00Z") }], draftsWaiting: 2 })),
    findMomentsBetween: vi.fn(async () => [
      moment("enters", "2026-11-30"),
      moment("starts", "2026-11-19", { leadDays: 60 }),
      moment("later", "2026-12-25"),
      moment("other-topic", "2026-11-30", { tags: ["healthcare"] }),
      moment("other-region", "2026-11-30", { region: "US" }),
    ]),
    deliverAppEmail: vi.fn(async () => ({ messageId: "sent" })),
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("planWeek", () => {
  it("is Monday in the digest zone from the digest time onwards", () => {
    expect(planWeek(MONDAY_IST, "Asia/Kolkata", "09:00")).toEqual({ slot: "2026-11-16", weekStart: "2026-11-16", weekEnd: "2026-11-22", nextMonday: "2026-11-23" });
    expect(planWeek(MONDAY_IST, "Asia/Kolkata", "10:00")).toBeUndefined();
    expect(planWeek(new Date("2026-11-17T04:00:00Z"), "Asia/Kolkata", "09:00")).toBeUndefined();
    // Sunday evening in UTC is already Monday morning in Auckland.
    expect(planWeek(new Date("2026-11-15T20:30:00Z"), "Pacific/Auckland", "09:00")?.slot).toBe("2026-11-16");
    expect(planWeek(new Date("2026-11-15T20:30:00Z"), "UTC", "09:00")).toBeUndefined();
  });
});

describe("Monday plan", () => {
  it("sends this week's posts, moments entering their lead window and drafts waiting, once per local Monday", async () => {
    const deps = planDeps();
    await sendMondayPlanForScope(scope, MONDAY_IST, deps);
    await sendMondayPlanForScope(scope, new Date("2026-11-16T12:00:00Z"), deps);
    expect(deps.loadPlanData).toHaveBeenCalledWith(scope, expect.objectContaining({ weekStart: "2026-11-16", weekEnd: "2026-11-22" }), "Asia/Kolkata");
    expect(deps.findMomentsBetween).toHaveBeenCalledWith("2026-11-16", "2027-02-20");
    const [first, second] = deps.deliverAppEmail.mock.calls.map(call => (call as unknown[])[0] as Record<string, string>);
    expect(first).toMatchObject({ type: "monday_plan", userId: "user", recipient: "reader@example.invalid", recipientName: "Asha",
      dedupeKey: '["monday-plan-v1","tenant","user","2026-11-16"]', subject: "Your week on LinkedIn" });
    expect(second.dedupeKey).toBe(first.dedupeKey);
    expect(first.text).toContain("Tue 17 Nov, 10:30: Why retail media budgets moved this quarter");
    expect(first.text).toContain("Moment enters");
    expect(first.text).toContain("Moment starts");
    expect(first.text).not.toMatch(/Moment (later|other-topic|other-region)/);
    expect(first.text).toContain("You have 2 drafts waiting. Nothing posts until you choose to.");
    expect(first.html).toContain("Idea: What Moment enters means for your clients");
    expect(first.primaryCta).toEqual({ label: "Open Inbox", url: expect.stringMatching(/\/dashboard$/) });
  });

  it("skips when there is nothing useful to say", async () => {
    const deps = planDeps({ loadPlanData: vi.fn(async () => ({ profile: null, posts: [], draftsWaiting: 0 })), findMomentsBetween: vi.fn(async () => []) });
    await sendMondayPlanForScope(scope, MONDAY_IST, deps);
    expect(deps.loadRecipient).not.toHaveBeenCalled();
    expect(deps.deliverAppEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["the preference is off", prefs({ mondayPlan: false }), MONDAY_IST],
    ["they unsubscribed from everything", prefs({ unsubscribedAt: new Date() }), MONDAY_IST],
    ["it is not Monday locally", prefs(), new Date("2026-11-17T04:00:00Z")],
    ["the digest time has not come", prefs({ digestTime: "11:00" }), MONDAY_IST],
  ])("does not load or send when %s", async (_label, preference, now) => {
    const deps = planDeps({ getEmailPreferences: returning(preference) });
    await sendMondayPlanForScope(scope, now, deps);
    expect(deps.loadPlanData).not.toHaveBeenCalled();
    expect(deps.deliverAppEmail).not.toHaveBeenCalled();
  });

  it("does not send to members without a verified address in an active workspace", async () => {
    const deps = planDeps({ loadRecipient: vi.fn(async () => null) });
    await sendMondayPlanForScope(scope, MONDAY_IST, deps);
    expect(deps.deliverAppEmail).not.toHaveBeenCalled();
  });
});

const story = (id: string, source: string, score: number, extra: Partial<TopPickCandidate> = {}): TopPickCandidate => ({
  id, source, headline: `${id} headline`, url: `https://news.test/${id}`, matchedKeywords: ["Retail media"], relevanceScore: String(score),
  rankingScore: String(score), relevanceReason: null, evidence: null, publishedAt: null, discoveredAt: null, ...extra,
});

describe("weekly top picks", () => {
  it("picks five stories, one per source first, with a plain why line and no unsafe links", () => {
    const picks = pickTopStories([
      story("a1", "Wire", 0.9, { evidence: [{ type: "company", label: "Acme" }] }), story("a2", "Wire", 0.85), story("b1", "Brief", 0.8),
      story("c1", "Report", 0.7), story("d1", "Desk", 0.6), story("x1", "Unsafe", 0.95, { url: "javascript:alert(1)" }), story("e1", "Extra", 0.5),
    ]);
    expect(picks.map(pick => pick.headline)).toEqual(["a1 headline", "b1 headline", "c1 headline", "d1 headline", "e1 headline"]);
    expect(picks[0].why).toBe("Mentions Acme, a company you follow.");
    expect(picks[1].why).toBe("Matches Retail media.");
  });

  function topDeps(candidates: TopPickCandidate[], preference = prefs({ topPicksWeekly: true })) {
    return { getEmailPreferences: returning(preference), loadRecipient: vi.fn(async () => ({ email: "reader@example.invalid", name: null })),
      loadTopPickCandidates: vi.fn(async () => candidates), deliverAppEmail: vi.fn(async () => ({ messageId: "sent" })) };
  }

  it("sends the weekly variant on Monday with a per-week identity", async () => {
    const deps = topDeps([story("a1", "Wire", 0.9)]);
    await sendTopPicksForScope(scope, MONDAY_IST, deps);
    expect(deps.deliverAppEmail).toHaveBeenCalledWith(expect.objectContaining({ type: "top_picks_weekly", subject: "Your top picks this week",
      dedupeKey: '["top-picks-weekly-v1","tenant","user","2026-11-16"]' }));
  });

  it("is off by default, and skips weeks without stories", async () => {
    const off = topDeps([story("a1", "Wire", 0.9)], prefs());
    await sendTopPicksForScope(scope, MONDAY_IST, off);
    expect(off.loadTopPickCandidates).not.toHaveBeenCalled();
    const empty = topDeps([story("x", "Unsafe", 0.9, { url: "ftp://files.test/x" })]);
    await sendTopPicksForScope(scope, MONDAY_IST, empty);
    expect(empty.deliverAppEmail).not.toHaveBeenCalled();
  });
});

describe("planning cycle", () => {
  it("reads preferences once per member, isolates failures and honours the enable flags", async () => {
    m.scopes.mockResolvedValue([scope, { tenantId: "tenant", userId: "user-2" }]);
    m.preferences.mockResolvedValue(prefs({ mondayPlan: false, topPicksWeekly: false }));
    m.watch.mockRejectedValueOnce(new Error("provider down")).mockResolvedValue(undefined);
    await runPlanningEmailCycle(async () => undefined, { plan: true, watch: true });
    expect(m.preferences).toHaveBeenCalledTimes(2);
    expect(m.watch).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("[email:watch-alerts] Scoped delivery failed; retry or reconciliation pending");
    const injected = m.watch.mock.calls[1][2].getEmailPreferences;
    await expect(injected("ignored")).resolves.toMatchObject({ mondayPlan: false });
    vi.clearAllMocks();
    await runPlanningEmailCycle(async () => undefined, { plan: false, watch: false });
    expect(m.scopes).not.toHaveBeenCalled();
  });
});
