import type { Express, Request, RequestHandler, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, pass, scope, permissions, Unavailable } = vi.hoisted(() => ({
  storage: { recordDiscoverVisit: vi.fn(), markInboxItemRead: vi.fn() },
  pass: (_req: unknown, _res: unknown, next: () => void) => next(),
  scope: { tenantId: "discover-tenant", userId: "discover-user" },
  permissions: [] as string[],
  Unavailable: class DiscoverStateUnavailableError extends Error {},
}));

vi.mock("../storage", () => ({
  storage, InboxCapacityError: class extends Error {}, InboxOperationConflictError: class extends Error {},
  DiscoverStateUnavailableError: Unavailable,
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
vi.mock("../db", () => { throw new Error("Database must not load in Discover route tests"); });

import { registerInboxRoutes } from "./inbox";

const routes = new Map<string, { handlers: RequestHandler[]; permission: string }>();
const registrar = Object.fromEntries(["get", "post", "patch"].map(method => [method,
  (url: string, ...handlers: RequestHandler[]) => routes.set(`${method} ${url}`, { handlers, permission: permissions.at(-1)! }),
]));
registerInboxRoutes(registrar as unknown as Express);

async function call(key: string, params: Record<string, string> = {}) {
  const req = { body: { tenantId: "forged", userId: "forged" }, query: {}, params } as unknown as Request;
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

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("Discover reading-state routes", () => {
  it("registers visit and read before the generic item PATCH with owner write permission", () => {
    const keys = [...routes.keys()];
    expect(keys.indexOf("post /api/inbox/visit")).toBeGreaterThanOrEqual(0);
    expect(keys.indexOf("post /api/inbox/:id/read")).toBeLessThan(keys.indexOf("patch /api/inbox/:id"));
    expect(routes.get("post /api/inbox/visit")!.permission).toBe("inbox:write:own");
    expect(routes.get("post /api/inbox/:id/read")!.permission).toBe("inbox:write:own");
  });

  it("records a visit for the authenticated tenant scope, ignoring body identifiers", async () => {
    const marker = { previousVisitAt: new Date("2026-01-01T00:00:00Z"), currentVisitAt: new Date("2026-01-02T00:00:00Z") };
    storage.recordDiscoverVisit.mockResolvedValue(marker);
    expect(await call("post /api/inbox/visit")).toEqual({ status: 200, body: marker });
    expect(storage.recordDiscoverVisit).toHaveBeenCalledExactlyOnceWith(scope);
  });

  it("returns 500 when recording a visit fails", async () => {
    storage.recordDiscoverVisit.mockRejectedValue(new Error("boom"));
    expect((await call("post /api/inbox/visit")).status).toBe(500);
  });

  it("marks an item read in scope and returns its read time", async () => {
    const readAt = new Date("2026-01-03T00:00:00Z");
    storage.markInboxItemRead.mockResolvedValue(readAt);
    expect(await call("post /api/inbox/:id/read", { id: "item-1" })).toEqual({ status: 200, body: { id: "item-1", readAt } });
    expect(storage.markInboxItemRead).toHaveBeenCalledExactlyOnceWith(scope, "item-1");
  });

  it("returns 404 for items outside the caller's scope", async () => {
    storage.markInboxItemRead.mockResolvedValue(null);
    expect((await call("post /api/inbox/:id/read", { id: "other" })).status).toBe(404);
  });

  it("returns 503 before the reading-state migration is applied", async () => {
    storage.markInboxItemRead.mockRejectedValue(new Unavailable("missing"));
    expect((await call("post /api/inbox/:id/read", { id: "item-1" })).status).toBe(503);
  });
});
