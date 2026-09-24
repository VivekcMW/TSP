import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { suggest, pass } = vi.hoisted(() => ({ suggest: vi.fn(), pass: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: { tenantId: "tenant-a", userId: "user-a" } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => pass }));
vi.mock("../middlewares/rateLimit", () => ({ onboardingSuggestionRateLimit: pass }));
vi.mock("../services/onboardingSuggestions", async original => ({ ...await original<typeof import("../services/onboardingSuggestions")>(), suggestOnboardingItems: suggest }));
import { AIGenerationError } from "../services/openRouter";
import { registerOnboardingSuggestionRoutes } from "./onboarding-suggestions";

const app = express(); app.use(express.json()); registerOnboardingSuggestionRoutes(app);
const body = { step: "publications", focusDescription: "I lead marketing for programmatic DOOH in India.", searchEdition: "en-IN" };
beforeEach(() => { suggest.mockReset(); });

describe("POST /api/onboarding/suggestions", () => {
  it("rejects an invalid request without doing any work", async () => {
    const response = await request(app).post("/api/onboarding/suggestions").send({ step: "publications", focusDescription: "short" });
    expect(response.status).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("returns suggestions for the caller's tenant and never caches them in the browser", async () => {
    suggest.mockResolvedValue({ step: "publications", grounded: true, items: [{ name: "ExchangeWire", url: "https://www.exchangewire.com/", reason: "Programmatic trade news" }] });
    const response = await request(app).post("/api/onboarding/suggestions").send(body);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.items[0].name).toBe("ExchangeWire");
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ step: "publications", searchEdition: "en-IN", publications: [], topics: [], exclude: [] }), { tenantId: "tenant-a" }, expect.any(AbortSignal));
  });

  it("maps AI failures to the standard error response with Retry-After", async () => {
    suggest.mockRejectedValue(new AIGenerationError("ai_quota", 60));
    const response = await request(app).post("/api/onboarding/suggestions").send(body);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("ai_quota");
    expect(response.headers["retry-after"]).toBe("60");
  });
});
