import type { Express, Request, RequestHandler, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isFeatureEnabled, scope } = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  scope: { tenantId: "feature-tenant", userId: "feature-user" },
}));
vi.mock("../services/featureFlags", () => ({ isFeatureEnabled }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (_req: unknown, _res: unknown, next: () => void) => next(),
  authedOf: () => ({ tenant: scope, dbUser: { id: scope.userId } }),
}));
vi.mock("../db", () => { throw new Error("Database must not load in feature route tests"); });

import { registerFeatureRoutes } from "./features";

const routes = new Map<string, RequestHandler[]>();
registerFeatureRoutes({ get: (url: string, ...handlers: RequestHandler[]) => routes.set(url, handlers) } as unknown as Express);

async function getFeatures() {
  const res = { set: vi.fn(), json: vi.fn() };
  res.set.mockReturnValue(res);
  for (const handler of routes.get("/api/features")!) {
    const next = vi.fn();
    await handler({ query: { tenantId: "forged" } } as unknown as Request, res as unknown as Response, next);
    if (!next.mock.calls.length) break;
  }
  return { body: res.json.mock.calls[0]?.[0], headers: res.set.mock.calls };
}

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("GET /api/features", () => {
  it("evaluates opt-in flags for the session tenant, never a supplied tenant", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    const { body, headers } = await getFeatures();
    expect(body).toEqual({ linkedinInbox: true, allIntegrations: true });
    expect(isFeatureEnabled).toHaveBeenCalledWith("linkedin_inbox_ui", false, "feature-tenant");
    expect(isFeatureEnabled).toHaveBeenCalledWith("all_integrations_ui", false, "feature-tenant");
    expect(headers).toContainEqual(["Cache-Control", "no-store"]);
  });

  it("keeps the existing experience when a flag cannot be evaluated", async () => {
    isFeatureEnabled.mockRejectedValue(new Error("database unavailable"));
    expect((await getFeatures()).body).toEqual({ linkedinInbox: false, allIntegrations: false });
  });
});
