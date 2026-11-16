import type { Express, Request, RequestHandler, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackItem, FeedPreferences } from "../services/feedbackWeights";
import type { FeedbackPlan } from "../repositories/inboxFeedback";

const { repository, state, pass, scope, permissions } = vi.hoisted(() => {
  const state = {
    items: [] as FeedbackItem[], prefs: { mutedSources: [], keywordAdjustments: {} } as FeedPreferences,
    feedback: [] as unknown[], deleted: [] as string[], revision: 0, plannedIds: [] as string[],
  };
  const view = () => ({ ...structuredClone(state.prefs), revision: state.revision, updatedAt: null });
  const repository = {
    preferences: vi.fn(async () => view()),
    reset: vi.fn(async () => {
      const previous = structuredClone(state.prefs);
      state.prefs = { mutedSources: [], keywordAdjustments: {} }; state.feedback = []; state.revision++;
      return { preferences: view(), previous };
    }),
    // Same contract as the real repository: the plan sees only the caller's stories and may throw.
    update: vi.fn(async (_scope: unknown, ids: readonly string[], plan: (items: FeedbackItem[], current: FeedPreferences) => FeedbackPlan<unknown>) => {
      state.plannedIds = [...ids];
      const decided = plan(state.items.filter(item => ids.includes(item.id)), structuredClone(state.prefs));
      state.prefs = decided.next; state.revision++;
      state.feedback.push(...decided.feedback);
      state.deleted.push(...(decided.deleteFeedbackIds ?? []));
      return { result: decided.result, feedbackIds: decided.feedback.map((_, index) => `fb-${index}`), preferences: view() };
    }),
  };
  return {
    repository, state, pass: (_req: unknown, _res: unknown, next: () => void) => next(),
    scope: { tenantId: "feedback-tenant", userId: "feedback-user" }, permissions: [] as string[],
  };
});

vi.mock("../repositories/inboxFeedback", () => ({ inboxFeedbackRepository: repository }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: scope, dbUser: { id: scope.userId } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: (permission: string) => { permissions.push(permission); return pass; } }));
vi.mock("../db", () => { throw new Error("Database must not load in feedback route tests"); });
vi.mock("../storage", () => { throw new Error("Storage must not load in feedback route tests"); });

import { registerInboxFeedbackRoutes } from "./inbox-feedback";

const routes = new Map<string, { handlers: RequestHandler[]; permission: string }>();
const registrar = Object.fromEntries(["get", "post", "patch", "delete"].map(method => [method,
  (url: string, ...handlers: RequestHandler[]) => routes.set(`${method} ${url}`, { handlers, permission: permissions.at(-1)! }),
]));
registerInboxFeedbackRoutes(registrar as unknown as Express);

async function call(key: string, { params = {}, body = {} }: { params?: Record<string, string>; body?: unknown } = {}) {
  const req = { body, query: {}, params } as unknown as Request;
  const res = { statusCode: 200, status: vi.fn(), json: vi.fn(), set: vi.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  const route = routes.get(key);
  expect(route).toBeDefined();
  for (const handler of route!.handlers) {
    const next = vi.fn();
    await handler(req, res as unknown as Response, next);
    if (!next.mock.calls.length) break;
  }
  return { status: res.statusCode, body: res.json.mock.calls[0]?.[0] };
}
const feedback = (body: unknown, id = "s1") => call("post /api/inbox/:id/feedback", { params: { id }, body });
const calibrate = (body: unknown) => call("post /api/inbox/calibration", { body });
const patch = (body: unknown) => call("patch /api/feed-preferences", { body });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  Object.assign(state, {
    items: [
      { id: "s1", source: "Wire Daily", matchedKeywords: ["Retail media", "CTV"] },
      { id: "s2", source: "Ad Brief", matchedKeywords: ["Crypto"] },
      { id: "s3", source: "Data Desk", matchedKeywords: ["AI"] },
    ],
    prefs: { mutedSources: [], keywordAdjustments: { CTV: -0.1 } }, feedback: [], deleted: [], revision: 0, plannedIds: [],
  });
});

describe("feedback route permissions", () => {
  it("reads with inbox:read:own and writes with inbox:write:own", () => {
    expect(routes.get("get /api/feed-preferences")!.permission).toBe("inbox:read:own");
    for (const key of ["post /api/inbox/:id/feedback", "post /api/inbox/calibration", "patch /api/feed-preferences", "delete /api/feed-preferences"]) {
      expect(routes.get(key)!.permission).toBe("inbox:write:own");
    }
  });
});

describe("POST /api/inbox/:id/feedback", () => {
  it.each([
    ["no reason", {}], ["an unknown reason", { reason: "boring" }], ["a non-boolean mute", { reason: "old_news", muteSource: "yes" }],
    ["too many topics", { reason: "not_my_topic", lessAbout: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ["an empty topic", { reason: "not_my_topic", lessAbout: [" "] }], ["forged owner fields", { reason: "old_news", tenantId: "other" }],
  ])("rejects %s with 400 before storage", async (_label, body) => {
    expect((await feedback(body)).status).toBe(400);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("learns less about the story's topics for Not my topic, with an exact Undo", async () => {
    const { status, body } = await feedback({ reason: "not_my_topic" });
    expect(status).toBe(200);
    expect(state.plannedIds).toEqual(["s1"]);
    expect(body).toMatchObject({
      feedbackIds: ["fb-0"], learned: { moreAbout: [], lessAbout: ["Retail media", "CTV"], muted: [] },
      undo: { keywords: { "Retail media": { before: null, after: -0.2 }, CTV: { before: -0.1, after: -0.3 } }, sources: {} },
      preferences: { mutedSources: [], keywordAdjustments: { "Retail media": -0.2, CTV: -0.3 } },
    });
    expect(state.feedback).toEqual([{ inboxItemId: "s1", kind: "dismiss", reason: "not_my_topic", source: "Wire Daily", keywords: ["Retail media", "CTV"] }]);

    const undone = await patch({ restore: body.undo, feedbackId: body.feedbackIds[0] });
    expect(undone.status).toBe(200);
    expect(undone.body).toMatchObject({ preferences: { mutedSources: [], keywordAdjustments: { CTV: -0.1 } }, skipped: { keywords: [], sources: [] } });
    expect(state.deleted).toEqual(["fb-0"]);
  });

  it("mutes the source for Don't trust this source and Undo unmutes it", async () => {
    const { body } = await feedback({ reason: "untrusted_source" });
    expect(body.learned).toEqual({ moreAbout: [], lessAbout: [], muted: ["Wire Daily"] });
    expect(state.prefs.mutedSources).toEqual(["Wire Daily"]);
    await patch({ restore: body.undo });
    expect(state.prefs.mutedSources).toEqual([]);
  });

  it.each(["wrong_audience", "old_news", "already_covered"])("records %s without changing preferences", async reason => {
    const { status, body } = await feedback({ reason });
    expect(status).toBe(200);
    expect(body.learned).toEqual({ moreAbout: [], lessAbout: [], muted: [] });
    expect(state.prefs).toEqual({ mutedSources: [], keywordAdjustments: { CTV: -0.1 } });
    expect(state.feedback).toMatchObject([{ reason, kind: "dismiss" }]);
  });

  it("uses the ticked boxes, and only the story's own topics", async () => {
    const { body } = await feedback({ reason: "old_news", muteSource: true, lessAbout: ["retail media"] });
    expect(body.learned).toEqual({ moreAbout: [], lessAbout: ["Retail media"], muted: ["Wire Daily"] });
    const rejected = await feedback({ reason: "not_my_topic", lessAbout: ["Crypto"] });
    expect(rejected).toEqual({ status: 400, body: { message: "Choose topics from this story." } });
  });

  it("returns 404 for a missing or another user's story", async () => {
    expect(await feedback({ reason: "old_news" }, "someone-elses")).toEqual({ status: 404, body: { message: "Story not found" } });
    expect(state.feedback).toEqual([]);
  });

  it("returns 503 before the migration and 500 on other failures", async () => {
    repository.update.mockRejectedValueOnce(Object.assign(new Error("query failed"), { cause: { code: "42P01" } }));
    expect((await feedback({ reason: "old_news" })).status).toBe(503);
    repository.update.mockRejectedValueOnce(new Error("boom"));
    expect((await feedback({ reason: "old_news" })).status).toBe(500);
  });
});

describe("POST /api/inbox/calibration", () => {
  const votes = [{ id: "s1", vote: "relevant" }, { id: "s2", vote: "not_relevant" }, { id: "s3", vote: "skip" }];

  it.each([
    ["no votes", { votes: [] }], ["eleven votes", { votes: Array.from({ length: 11 }, (_, i) => ({ id: `x${i}`, vote: "skip" })) }],
    ["a duplicate story", { votes: [{ id: "s1", vote: "relevant" }, { id: "s1", vote: "skip" }] }],
    ["an unknown vote", { votes: [{ id: "s1", vote: "love" }] }], ["unknown apply fields", { votes, apply: { boost: ["AI"] } }],
  ])("rejects %s with 400", async (_label, body) => {
    expect((await calibrate(body)).status).toBe(400);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("records votes and applies only the chosen, vote-backed changes", async () => {
    const { status, body } = await calibrate({ votes, apply: { moreAbout: ["Retail media"], lessAbout: ["Crypto"], mute: ["Ad Brief"] } });
    expect(status).toBe(200);
    expect(state.plannedIds).toEqual(["s1", "s2"]);
    expect(body.learned).toEqual({ moreAbout: ["Retail media"], lessAbout: ["Crypto"], muted: ["Ad Brief"] });
    expect(state.prefs).toEqual({ mutedSources: ["Ad Brief"], keywordAdjustments: { CTV: -0.1, "Retail media": 0.1, Crypto: -0.2 } });
    expect(state.feedback).toMatchObject([{ inboxItemId: "s1", kind: "calibration_up" }, { inboxItemId: "s2", kind: "calibration_down" }]);
    await patch({ restore: body.undo });
    expect(state.prefs).toEqual({ mutedSources: [], keywordAdjustments: { CTV: -0.1 } });
  });

  it("changes nothing when nothing is applied", async () => {
    const { body } = await calibrate({ votes });
    expect(body.learned).toEqual({ moreAbout: [], lessAbout: [], muted: [] });
    expect(state.prefs).toEqual({ mutedSources: [], keywordAdjustments: { CTV: -0.1 } });
  });

  it("rejects changes no vote supports", async () => {
    expect(await calibrate({ votes, apply: { mute: ["Wire Daily"] } })).toEqual({ status: 400, body: { message: "Mute only sources you marked not relevant." } });
    expect((await calibrate({ votes, apply: { moreAbout: ["AI"] } })).status).toBe(400);
  });
});

describe("/api/feed-preferences", () => {
  it("returns what was learned", async () => {
    expect(await call("get /api/feed-preferences")).toEqual({ status: 200, body: { mutedSources: [], keywordAdjustments: { CTV: -0.1 }, revision: 0, updatedAt: null } });
    expect(repository.preferences).toHaveBeenCalledExactlyOnceWith(scope);
  });

  it("removes one muted source or one keyword", async () => {
    state.prefs = { mutedSources: ["Wire Daily", "Ad Brief"], keywordAdjustments: { CTV: -0.1, AI: 0.2 } };
    expect((await patch({ unmuteSource: "wire daily" })).body.preferences.mutedSources).toEqual(["Ad Brief"]);
    expect((await patch({ resetKeyword: "ctv" })).body).toMatchObject({ preferences: { keywordAdjustments: { AI: 0.2 } }, skipped: { keywords: [], sources: [] } });
  });

  it("Undo keeps a newer value set elsewhere for the same keyword and reports it", async () => {
    const tab1 = (await feedback({ reason: "not_my_topic", lessAbout: ["CTV"] })).body;
    await feedback({ reason: "not_my_topic", lessAbout: ["CTV"] });
    expect(state.prefs.keywordAdjustments).toEqual({ CTV: -0.5 });
    const undone = await patch({ restore: tab1.undo, feedbackId: tab1.feedbackIds[0] });
    expect(undone.body).toMatchObject({ preferences: { keywordAdjustments: { CTV: -0.5 } }, skipped: { keywords: ["CTV"], sources: [] } });
    expect(state.prefs.keywordAdjustments).toEqual({ CTV: -0.5 });
  });

  it.each([
    ["an empty body", {}], ["two changes at once", { unmuteSource: "A", resetKeyword: "B" }],
    ["an out-of-range delta", { restore: { keywords: { AI: { before: 0.5, after: null } } } }], ["a non-boolean source", { restore: { sources: { A: { before: "muted", after: false } } } }],
    ["a blind value without before/after", { restore: { keywords: { AI: null } } }],
    ["too many keywords", { restore: { keywords: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, { before: 0.1, after: null }])) } }],
  ])("rejects %s with 400", async (_label, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("resets everything, returning the exact previous state from the server and its compare-and-set undo", async () => {
    state.prefs = { mutedSources: ["Wire Daily"], keywordAdjustments: { CTV: -0.1, AI: 0.2 } };
    const { body } = await call("delete /api/feed-preferences");
    expect(repository.reset).toHaveBeenCalledExactlyOnceWith(scope);
    expect(body).toEqual({
      preferences: { mutedSources: [], keywordAdjustments: {}, revision: 1, updatedAt: null },
      previous: { mutedSources: ["Wire Daily"], keywordAdjustments: { CTV: -0.1, AI: 0.2 } },
      undo: { keywords: { CTV: { before: -0.1, after: null }, AI: { before: 0.2, after: null } }, sources: { "Wire Daily": { before: true, after: false } } },
    });
    // Learned after the reset (e.g. in another tab): Undo must not wipe it.
    state.prefs = { mutedSources: [], keywordAdjustments: { CTV: -0.3 } };
    const undone = await patch({ restore: body.undo });
    expect(undone.body.skipped).toEqual({ keywords: ["CTV"], sources: [] });
    expect(state.prefs).toEqual({ mutedSources: ["Wire Daily"], keywordAdjustments: { CTV: -0.3, AI: 0.2 } });
  });
});
