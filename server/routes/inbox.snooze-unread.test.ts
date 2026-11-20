import type { Express, Request, RequestHandler, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storage, pass, scope, permissions, Unavailable, SnoozeError } = vi.hoisted(() => ({
  storage: { getInboxItems: vi.fn(), markInboxItemUnread: vi.fn(), snoozeInboxItem: vi.fn() },
  pass: (_req: unknown, _res: unknown, next: () => void) => next(),
  scope: { tenantId: "snooze-tenant", userId: "snooze-user" },
  permissions: [] as string[],
  Unavailable: class DiscoverStateUnavailableError extends Error {},
  SnoozeError: class InboxSnoozeError extends Error {
    readonly status = 409;
    constructor() { super("Only stories in For you can be snoozed."); }
  },
}));

vi.mock("../storage", () => ({
  storage, InboxCapacityError: class extends Error {}, InboxOperationConflictError: class extends Error {},
  DiscoverStateUnavailableError: Unavailable, InboxSnoozeError: SnoozeError,
}));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: scope, dbUser: { id: scope.userId } }) }));
vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: (permission: string) => { permissions.push(permission); return pass; },
}));
vi.mock("../middlewares/rateLimit", () => ({ inboxRefreshRateLimit: pass }));
vi.mock("../jobs/queue", () => ({ enqueueInboxRefresh: vi.fn(), getJobStatus: vi.fn(), InboxRefreshAdmissionError: class extends Error {} }));
vi.mock("../services/engines/index.js", () => ({ engineRegistry: { getEngine: vi.fn() } }));
vi.mock("../services/metaEngine", () => ({ normalizeIndustryToSlug: (industry: string) => industry }));
vi.mock("../services/urlValidator", () => ({ validateUrl: vi.fn(), validateUrlSync: vi.fn() }));
vi.mock("../db", () => { throw new Error("Database must not load in inbox route tests"); });

import { registerInboxRoutes } from "./inbox";

const routes = new Map<string, { handlers: RequestHandler[]; permission: string }>();
const registrar = Object.fromEntries(["get", "post", "patch", "delete"].map(method => [method,
  (url: string, ...handlers: RequestHandler[]) => routes.set(`${method} ${url}`, { handlers, permission: permissions.at(-1)! }),
]));
registerInboxRoutes(registrar as unknown as Express);

const NOW = new Date("2026-11-16T12:00:00.000Z");
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

async function call(key: string, { params = {}, body, query = {} }: { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown> } = {}) {
  const req = { body: body ?? { tenantId: "forged", userId: "forged" }, query, params } as unknown as Request;
  const res = { statusCode: 200, status: vi.fn(), json: vi.fn() };
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe("inbox unread and snooze route registration", () => {
  it("uses owner write permission and registers unread before the generic item PATCH", () => {
    const keys = [...routes.keys()];
    for (const key of ["delete /api/inbox/:id/read", "post /api/inbox/:id/snooze", "delete /api/inbox/:id/snooze"]) {
      expect(routes.get(key)?.permission).toBe("inbox:write:own");
    }
    expect(routes.get("get /api/inbox")!.permission).toBe("inbox:read:own");
    expect(keys.indexOf("delete /api/inbox/:id/read")).toBeGreaterThan(keys.indexOf("post /api/inbox/:id/read"));
    expect(keys.indexOf("delete /api/inbox/:id/read")).toBeLessThan(keys.indexOf("patch /api/inbox/:id"));
  });
});

describe("DELETE /api/inbox/:id/read", () => {
  it("marks the caller's item unread in the authenticated scope", async () => {
    storage.markInboxItemUnread.mockResolvedValue(true);
    expect(await call("delete /api/inbox/:id/read", { params: { id: "item-1" } })).toEqual({ status: 200, body: { id: "item-1", readAt: null } });
    expect(storage.markInboxItemUnread).toHaveBeenCalledExactlyOnceWith(scope, "item-1");
  });

  it("returns 404 for missing or out-of-scope items", async () => {
    storage.markInboxItemUnread.mockResolvedValue(false);
    expect((await call("delete /api/inbox/:id/read", { params: { id: "other" } })).status).toBe(404);
  });

  it("returns 503 before the reading-state migration and 500 on other failures", async () => {
    storage.markInboxItemUnread.mockRejectedValueOnce(new Unavailable("missing"));
    expect((await call("delete /api/inbox/:id/read", { params: { id: "item-1" } })).status).toBe(503);
    storage.markInboxItemUnread.mockRejectedValueOnce(new Error("boom"));
    expect((await call("delete /api/inbox/:id/read", { params: { id: "item-1" } })).status).toBe(500);
  });
});

describe("POST /api/inbox/:id/snooze", () => {
  const snooze = (until: unknown, id = "item-1") => call("post /api/inbox/:id/snooze", { params: { id }, body: { until, tenantId: "forged", userId: "forged" } });

  it("snoozes in scope, honouring the supplied UTC offset", async () => {
    const item = { id: "item-1", status: "active", snoozedUntil: new Date("2026-11-17T12:00:00Z") };
    storage.snoozeInboxItem.mockResolvedValue(item);
    expect(await snooze("2026-11-17T17:30:00+05:30")).toEqual({ status: 200, body: item });
    expect(storage.snoozeInboxItem).toHaveBeenCalledExactlyOnceWith(scope, "item-1", new Date("2026-11-17T12:00:00Z"));
  });

  it.each([
    ["just over one minute", MINUTE + 1000],
    ["exactly 90 days", 90 * DAY],
  ])("accepts %s ahead", async (_label, offset) => {
    storage.snoozeInboxItem.mockResolvedValue({ id: "item-1" });
    expect((await snooze(new Date(NOW.getTime() + offset).toISOString())).status).toBe(200);
    expect(storage.snoozeInboxItem).toHaveBeenCalledExactlyOnceWith(scope, "item-1", new Date(NOW.getTime() + offset));
  });

  it.each([
    ["in the past", -DAY],
    ["now", 0],
    ["exactly one minute ahead", MINUTE],
    ["beyond 90 days", 90 * DAY + 1000],
  ])("rejects a time %s with 400 before storage", async (_label, offset) => {
    expect((await snooze(new Date(NOW.getTime() + offset).toISOString())).status).toBe(400);
    expect(storage.snoozeInboxItem).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined], ["null", null], ["a number", NOW.getTime() + DAY], ["free text", "tomorrow"],
    ["a date without time", "2026-11-18"], ["a datetime without offset", "2026-11-18T12:00:00"], ["an empty string", ""],
  ])("rejects %s with 400 before storage", async (_label, until) => {
    expect((await snooze(until)).status).toBe(400);
    expect(storage.snoozeInboxItem).not.toHaveBeenCalled();
  });

  it("rejects a non-object body", async () => {
    expect((await call("post /api/inbox/:id/snooze", { params: { id: "item-1" }, body: "2026-11-18T12:00:00Z" })).status).toBe(400);
    expect(storage.snoozeInboxItem).not.toHaveBeenCalled();
  });

  it("returns 404 for missing items and 409 with the storage message for stories not in For you", async () => {
    const until = new Date(NOW.getTime() + DAY).toISOString();
    storage.snoozeInboxItem.mockResolvedValueOnce(undefined);
    expect((await snooze(until, "missing")).status).toBe(404);
    storage.snoozeInboxItem.mockRejectedValueOnce(new SnoozeError());
    expect(await snooze(until)).toEqual({ status: 409, body: { message: "Only stories in For you can be snoozed." } });
    storage.snoozeInboxItem.mockRejectedValueOnce(new Error("boom"));
    expect((await snooze(until)).status).toBe(500);
  });
});

describe("DELETE /api/inbox/:id/snooze", () => {
  it("clears the snooze in scope", async () => {
    const item = { id: "item-1", status: "active", snoozedUntil: null };
    storage.snoozeInboxItem.mockResolvedValue(item);
    expect(await call("delete /api/inbox/:id/snooze", { params: { id: "item-1" } })).toEqual({ status: 200, body: item });
    expect(storage.snoozeInboxItem).toHaveBeenCalledExactlyOnceWith(scope, "item-1", null);
  });

  it("returns 404 for missing items and 409 for stories not in For you", async () => {
    storage.snoozeInboxItem.mockResolvedValueOnce(undefined);
    expect((await call("delete /api/inbox/:id/snooze", { params: { id: "missing" } })).status).toBe(404);
    storage.snoozeInboxItem.mockRejectedValueOnce(new SnoozeError());
    expect(await call("delete /api/inbox/:id/snooze", { params: { id: "item-1" } }))
      .toEqual({ status: 409, body: { message: "Only stories in For you can be snoozed." } });
  });
});

describe("GET /api/inbox snooze filter", () => {
  const list = (query: Record<string, unknown>) => call("get /api/inbox", { query });

  it.each([
    [{ status: "active" }, { status: "active", snoozed: "exclude" }],
    [{ status: "active", snoozed: "exclude" }, { status: "active", snoozed: "exclude" }],
    [{ status: "active", snoozed: "only" }, { status: "active", snoozed: "only" }],
    [{ status: "active", snoozed: "include" }, { status: "active" }],
    [{ status: "saved" }, { status: "saved" }],
    [{ status: "dismissed" }, { status: "dismissed" }],
    [{}, {}],
    [{ snoozed: "only" }, { snoozed: "only" }],
    [{ status: "saved", snoozed: "exclude" }, { status: "saved", snoozed: "exclude" }],
  ])("maps query %j to storage page %j", async (query, page) => {
    storage.getInboxItems.mockResolvedValue([]);
    expect((await list(query)).status).toBe(200);
    expect(storage.getInboxItems).toHaveBeenCalledExactlyOnceWith(scope, { order: "relevance", limit: undefined, offset: undefined, ...page });
  });

  it.each([["unknown"], ["EXCLUDE"], [""], [["only", "exclude"]]])("rejects snoozed=%j before storage", async snoozed => {
    expect((await list({ status: "active", snoozed })).status).toBe(400);
    expect(storage.getInboxItems).not.toHaveBeenCalled();
  });
});
