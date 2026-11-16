import type { Express, Request, RequestHandler, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ideaId, type ContentStrategy } from "@shared/topic-ideas";

const { storage, repository, pass, scope, permissions, ConflictError, LimitError, CheckinError } = vi.hoisted(() => {
  class ConflictError extends Error { constructor(readonly current: unknown) { super("Your strategy was changed in another tab or device. Load the latest version, then save again."); } }
  class LimitError extends Error { constructor() { super("You can keep up to 20 saved ideas. Unsave one first."); } }
  class CheckinError extends Error { constructor(readonly current: unknown) { super("You already checked in this week, maybe in another tab. Here are your answers."); } }
  return {
    storage: { getUserProfile: vi.fn(), getInboxDiscoveryWindow: vi.fn(), getInboxItems: vi.fn() },
    repository: {
      getStrategy: vi.fn(), saveStrategy: vi.fn(), getCheckin: vi.fn(), recentCheckins: vi.fn(), saveCheckin: vi.fn(),
      loadIdeaStates: vi.fn(), setIdeaState: vi.fn(), publishedPosts: vi.fn(), scheduledPosts: vi.fn(),
    },
    pass: (_req: unknown, _res: unknown, next: () => void) => next(),
    scope: { tenantId: "strategy-tenant", userId: "strategy-user" },
    permissions: [] as string[],
    ConflictError, LimitError, CheckinError,
  };
});

vi.mock("../storage", () => ({ storage }));
vi.mock("../repositories/strategy", () => ({ strategyRepository: repository, StrategyConflictError: ConflictError, SavedIdeaLimitError: LimitError, CheckinConflictError: CheckinError }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: scope, dbUser: { id: scope.userId } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: (permission: string) => { permissions.push(permission); return pass; } }));
vi.mock("../db", () => { throw new Error("Database must not load in strategy route tests"); });

import { registerStrategyRoutes } from "./strategy";

const routes = new Map<string, { handlers: RequestHandler[]; permission: string }>();
const registrar = Object.fromEntries(["get", "put", "patch"].map(method => [method,
  (url: string, ...handlers: RequestHandler[]) => routes.set(`${method} ${url}`, { handlers, permission: permissions.at(-1)! }),
]));
registerStrategyRoutes(registrar as unknown as Express);

async function call(key: string, { params = {}, body = {}, query = {} }: { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown> } = {}) {
  const req = { body, query, params } as unknown as Request;
  const res = { statusCode: 200, status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  const route = routes.get(key);
  expect(route, key).toBeDefined();
  for (const handler of route!.handlers) {
    const next = vi.fn();
    await handler(req, res as unknown as Response, next);
    if (!next.mock.calls.length) break;
  }
  return { status: res.statusCode, body: res.json.mock.calls[0]?.[0] };
}

const NOW = new Date("2026-11-16T04:00:00Z"); // Monday 09:30 in Kolkata
const profile = { timezone: "Asia/Kolkata", preferredPublishTime: "08:30", keywords: [{ keyword: "Retail media", weight: 0.9 }, { keyword: "Pricing", weight: 0.5 }] };
const strategy: ContentStrategy = {
  audience: "D2C founders", goal: "attract_clients", goalNote: "",
  pillars: [{ name: "Retail media", expertise: 3, proof: "" }, { name: "Pricing", expertise: 2, proof: "" }],
  cadence: { postsPerWeek: 2, slots: [{ weekday: 2, time: "09:00" }, { weekday: 4, time: "09:00" }] },
};
const saved = { strategy, revision: 3, updatedAt: new Date("2026-11-10T00:00:00Z") };
const story = { id: "s1", headline: "Retail media networks pass $60B", source: "Ad Brief", articleUrl: "https://news.test/s1", relevanceScore: "0.9", matchedKeywords: ["Retail media"] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  storage.getUserProfile.mockResolvedValue(profile);
  storage.getInboxDiscoveryWindow.mockResolvedValue([]);
  storage.getInboxItems.mockResolvedValue([story]);
  repository.getStrategy.mockResolvedValue(saved);
  repository.recentCheckins.mockResolvedValue([]);
  repository.publishedPosts.mockResolvedValue([]);
  repository.scheduledPosts.mockResolvedValue([]);
  repository.loadIdeaStates.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

describe("strategy route permissions", () => {
  it("reads with profile:read:own and writes with profile:write:own", () => {
    for (const key of ["get /api/strategy", "get /api/checkins/current", "get /api/ideas", "get /api/plan"]) expect(routes.get(key)!.permission, key).toBe("profile:read:own");
    for (const key of ["put /api/strategy", "put /api/checkins/current", "patch /api/ideas/:id"]) expect(routes.get(key)!.permission, key).toBe("profile:write:own");
  });
});

describe("GET/PUT /api/strategy", () => {
  it("returns profile-based suggestions without saving when nothing is saved", async () => {
    repository.getStrategy.mockResolvedValue(null);
    const { status, body } = await call("get /api/strategy");
    expect(status).toBe(200);
    expect(body).toMatchObject({ saved: false, revision: 0, strategy: null, updatedAt: null, timezone: "Asia/Kolkata" });
    expect(body.suggested.pillars.map((pillar: { name: string }) => pillar.name)).toEqual(["Retail media", "Pricing"]);
    expect(body.suggested.cadence.slots[0]).toEqual({ weekday: 1, time: "08:30" });
    expect(repository.saveStrategy).not.toHaveBeenCalled();
    expect(repository.getStrategy).toHaveBeenCalledExactlyOnceWith(scope);
  });

  it("saves with the expected revision in the session scope", async () => {
    repository.saveStrategy.mockResolvedValue({ ...saved, revision: 4 });
    const { status, body } = await call("put /api/strategy", { body: { revision: 3, strategy: { ...strategy, audience: "  D2C founders " } } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ saved: true, revision: 4, strategy });
    expect(repository.saveStrategy).toHaveBeenCalledExactlyOnceWith(scope, strategy, 3);
  });

  it.each<[string, unknown]>([
    ["missing revision", { strategy }], ["negative revision", { revision: -1, strategy }], ["extra fields", { revision: 0, strategy, tenantId: "forged" }],
    ["six pillars", { revision: 0, strategy: { ...strategy, pillars: ["a", "b", "c", "d", "e", "f"].map(name => ({ name, expertise: 2, proof: "" })) } }],
    ["long audience", { revision: 0, strategy: { ...strategy, audience: "x".repeat(201) } }],
    ["15 slots", { revision: 0, strategy: { ...strategy, cadence: { postsPerWeek: 3, slots: Array.from({ length: 15 }, (_, i) => ({ weekday: i % 7, time: `1${Math.floor(i / 7)}:00` })) } } }],
    ["8 posts a week", { revision: 0, strategy: { ...strategy, cadence: { postsPerWeek: 8, slots: [] } } }],
    ["bad goal", { revision: 0, strategy: { ...strategy, goal: "go_viral" } }],
  ])("rejects %s with 400 before storage", async (_label, body) => {
    const result = await call("put /api/strategy", { body });
    expect(result.status).toBe(400);
    expect(typeof result.body.message).toBe("string");
    expect(repository.saveStrategy).not.toHaveBeenCalled();
  });

  it("returns 409 with the latest strategy when the revision is stale", async () => {
    repository.saveStrategy.mockRejectedValue(new ConflictError(saved));
    const { status, body } = await call("put /api/strategy", { body: { revision: 2, strategy } });
    expect(status).toBe(409);
    expect(body.message).toMatch(/changed in another tab/);
    expect(body.current).toMatchObject({ saved: true, revision: 3, strategy });
  });

  it("returns 500 on other failures", async () => {
    repository.saveStrategy.mockRejectedValue(new Error("boom"));
    expect((await call("put /api/strategy", { body: { revision: 0, strategy } })).status).toBe(500);
  });
});

describe("weekly check-in", () => {
  it("uses the Monday of the current week in the profile time zone", async () => {
    vi.setSystemTime(new Date("2026-11-15T20:00:00Z")); // Sunday in UTC, Monday in Kolkata
    repository.getCheckin.mockResolvedValue(null);
    expect(await call("get /api/checkins/current")).toEqual({ status: 200, body: { weekStart: "2026-11-16", checkin: null } });
    expect(repository.getCheckin).toHaveBeenCalledExactlyOnceWith(scope, "2026-11-16");
  });

  it("saves trimmed answers for the current week, never replacing unless asked, and accepts an empty skip", async () => {
    repository.saveCheckin.mockImplementation(async (_scope, weekStart, answers) => ({ weekStart, answers, updatedAt: NOW.toISOString() }));
    const { status, body } = await call("put /api/checkins/current", { body: { weekStart: "2026-11-16", answers: { win: " Won a client ", lesson: "", question: "" } } });
    expect(status).toBe(200);
    expect(body.checkin.answers).toEqual({ win: "Won a client", lesson: "", question: "" });
    expect(repository.saveCheckin).toHaveBeenCalledWith(scope, "2026-11-16", { win: "Won a client", lesson: "", question: "" }, false);
    expect((await call("put /api/checkins/current", { body: { weekStart: "2026-11-16", answers: {}, replace: true } })).status).toBe(200);
    expect(repository.saveCheckin).toHaveBeenLastCalledWith(scope, "2026-11-16", { win: "", lesson: "", question: "" }, true);
  });

  it("returns 409 with this week's check-in when a stale tab sends last week", async () => {
    const saved = { weekStart: "2026-11-16", answers: { win: "Saved elsewhere", lesson: "", question: "" }, updatedAt: NOW.toISOString() };
    repository.getCheckin.mockResolvedValue(saved);
    const { status, body } = await call("put /api/checkins/current", { body: { weekStart: "2026-11-09", answers: {} } });
    expect(status).toBe(409);
    expect(body).toMatchObject({ message: expect.stringMatching(/new week/), current: { weekStart: "2026-11-16", checkin: saved } });
    expect(repository.saveCheckin).not.toHaveBeenCalled();
  });

  it("returns 409 with the saved answers when the week was already answered elsewhere", async () => {
    const saved = { weekStart: "2026-11-16", answers: { win: "Saved elsewhere", lesson: "", question: "" }, updatedAt: NOW.toISOString() };
    repository.saveCheckin.mockRejectedValue(new CheckinError(saved));
    repository.getCheckin.mockResolvedValue(saved);
    const { status, body } = await call("put /api/checkins/current", { body: { weekStart: "2026-11-16", answers: {} } });
    expect(status).toBe(409);
    expect(body).toMatchObject({ message: expect.stringMatching(/already checked in/), current: { weekStart: "2026-11-16", checkin: saved } });
  });

  it.each<[string, unknown]>([
    ["a long answer", { weekStart: "2026-11-16", answers: { win: "x".repeat(501) } }], ["a missing week", { answers: {} }], ["a malformed week", { weekStart: "2026-1-5", answers: {} }],
    ["a non-boolean replace", { weekStart: "2026-11-16", answers: {}, replace: "yes" }], ["no answers", { weekStart: "2026-11-16" }],
  ])(
    "rejects %s with 400", async (_label, body) => {
      expect((await call("put /api/checkins/current", { body })).status).toBe(400);
      expect(repository.saveCheckin).not.toHaveBeenCalled();
    });
});

describe("GET /api/ideas", () => {
  it("ranks ideas from the strategy and stories, without dismissed ones", async () => {
    const dismissed = ideaId("pillar", "Retail media", "myth");
    repository.loadIdeaStates.mockResolvedValue([{ ideaId: dismissed, state: "dismissed", idea: null }]);
    storage.getInboxDiscoveryWindow.mockRejectedValue(new Error("trends down"));
    const { status, body } = await call("get /api/ideas");
    expect(status).toBe(200);
    expect(body.hasStrategy).toBe(true);
    expect(body.ideas.length).toBeGreaterThan(5);
    expect(body.ideas.length).toBeLessThanOrEqual(30);
    expect(body.ideas.some((idea: { id: string }) => idea.id === dismissed)).toBe(false);
    expect(body.ideas.find((idea: { kind: string }) => idea.kind === "story").sourceStory).toEqual({ inboxItemId: "s1", headline: story.headline, source: "Ad Brief", url: story.articleUrl });
    expect(body.states).toEqual({});
    expect(storage.getInboxItems).toHaveBeenCalledWith(scope, expect.objectContaining({ status: "active", snoozed: "exclude" }));
    expect(repository.publishedPosts).toHaveBeenCalledWith(scope, new Date(NOW.getTime() - 60 * 86_400_000));
  });

  it("returns the exact states of requested extra ids (client-merged moments)", async () => {
    const moment = ideaId("moment", "m1", "lead");
    const other = ideaId("moment", "m2", "lead");
    repository.loadIdeaStates.mockResolvedValue([{ ideaId: moment, state: "dismissed", idea: null }]);
    const { status, body } = await call("get /api/ideas", { query: { extra: `${moment},${other}` } });
    expect(status).toBe(200);
    expect(body.states).toEqual({ [moment]: "dismissed" });
    expect(repository.loadIdeaStates.mock.calls[0][1]).toEqual(expect.arrayContaining([moment, other, ideaId("pillar", "Pricing", "checklist")]));
  });

  it.each([["not-an-id"], [Array.from({ length: 51 }, (_, i) => ideaId("moment", `m${i}`, "lead")).join(",")], [["a", "b"]]])("rejects extra=%s with 400", async extra => {
    expect((await call("get /api/ideas", { query: { extra } })).status).toBe(400);
    expect(repository.loadIdeaStates).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/ideas/:id", () => {
  const id = ideaId("pillar", "Pricing", "checklist");
  const idea = { id, title: "A Pricing checklist", angle: "Share a checklist.", pillar: "Pricing", kind: "pillar", why: "Useful.", score: 0.7 };

  it("stores the state with the snapshot in the session scope", async () => {
    repository.setIdeaState.mockResolvedValue({ ideaId: id, state: "saved", idea });
    expect(await call("patch /api/ideas/:id", { params: { id }, body: { state: "saved", idea } })).toEqual({ status: 200, body: { id, state: "saved" } });
    expect(repository.setIdeaState).toHaveBeenCalledExactlyOnceWith(scope, id, "saved", idea);
    expect((await call("patch /api/ideas/:id", { params: { id }, body: { state: null } })).status).toBe(200);
    expect(repository.setIdeaState).toHaveBeenLastCalledWith(scope, id, null, undefined);
  });

  it.each<[string, string, unknown]>([
    ["a malformed id", "not-an-id", { state: "saved" }], ["an unknown state", id, { state: "archived" }], ["a missing state", id, {}],
    ["a mismatched snapshot", id, { state: "saved", idea: { ...idea, id: "0".repeat(16) } }], ["an oversized snapshot", id, { state: "saved", idea: { ...idea, title: "x".repeat(201) } }],
  ])("rejects %s with 400", async (_label, ideaParam, body) => {
    expect((await call("patch /api/ideas/:id", { params: { id: ideaParam }, body })).status).toBe(400);
    expect(repository.setIdeaState).not.toHaveBeenCalled();
  });

  it("maps the saved-idea limit to 409", async () => {
    repository.setIdeaState.mockRejectedValue(new LimitError());
    expect(await call("patch /api/ideas/:id", { params: { id }, body: { state: "saved" } }))
      .toEqual({ status: 409, body: { message: "You can keep up to 20 saved ideas. Unsave one first." } });
  });
});

describe("GET /api/plan", () => {
  it.each([["0"], ["61"], ["abc"], [["7", "8"]]])("rejects days=%s with 400", async days => {
    expect((await call("get /api/plan", { query: { days } })).status).toBe(400);
  });

  it("defaults to 30 days and shows scheduled posts without changing them", async () => {
    repository.scheduledPosts.mockResolvedValue([{ draftId: "d1", at: "2026-11-17T03:30:00.000Z", excerpt: "My scheduled post", status: "scheduled" }]);
    const { status, body } = await call("get /api/plan");
    expect(status).toBe(200);
    expect(body).toMatchObject({ days: 30, from: "2026-11-16", to: "2026-12-16", timezone: "Asia/Kolkata", postsPerWeek: 2, hasStrategy: true });
    expect(body.entries[0]).toMatchObject({ kind: "scheduled", date: "2026-11-17", time: "09:00", post: { draftId: "d1" } });
    expect(body.entries.filter((entry: { kind: string }) => entry.kind === "suggestion").length).toBeGreaterThan(5);
    const [, from, to] = repository.scheduledPosts.mock.calls[0];
    expect(from).toEqual(NOW);
    expect(to.getTime() - NOW.getTime()).toBe(32 * 86_400_000);
  });

  it("accepts up to 60 days and returns states for extra ids", async () => {
    const moment = ideaId("moment", "m1", "lead");
    repository.loadIdeaStates.mockResolvedValue([{ ideaId: moment, state: "used", idea: null }]);
    const { body } = await call("get /api/plan", { query: { days: "60", extra: moment } });
    expect(body).toMatchObject({ days: 60, states: { [moment]: "used" } });
  });
});
