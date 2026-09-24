import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { suggest, understand, pass } = vi.hoisted(() => ({ suggest: vi.fn(), understand: vi.fn(), pass: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: { tenantId: "tenant-a", userId: "user-a" } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => pass }));
vi.mock("../middlewares/rateLimit", () => ({ onboardingSuggestionRateLimit: pass }));
vi.mock("../services/onboardingSuggestions", async original => ({ ...await original<typeof import("../services/onboardingSuggestions")>(), suggestOnboardingItems: suggest }));
vi.mock("../services/onboardingUnderstanding", async original => ({ ...await original<typeof import("../services/onboardingUnderstanding")>(), understandFocus: understand }));
import { AIGenerationError } from "../services/openRouter";
import { registerOnboardingSuggestionRoutes } from "./onboarding-suggestions";

const app = express(); app.use(express.json()); registerOnboardingSuggestionRoutes(app);
const body = { step: "publications", focusDescription: "I lead marketing for programmatic DOOH in India.", searchEdition: "en-IN" };
beforeEach(() => { suggest.mockReset(); understand.mockReset(); });

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

describe("POST /api/onboarding/understand", () => {
  const focus = { focusDescription: "I lead marketing for programmatic DOOH in India." };
  it("rejects an invalid request without calling the model", async () => {
    const response = await request(app).post("/api/onboarding/understand").send({ focusDescription: "short" });
    expect(response.status).toBe(400);
    expect(understand).not.toHaveBeenCalled();
  });

  it("returns the understanding for the caller's tenant and never caches it in the browser", async () => {
    const understanding = { role: "Head of Marketing", industry: "OOH", focusAreas: ["DOOH"], region: "India", audience: null, question: null };
    understand.mockResolvedValue(understanding);
    const response = await request(app).post("/api/onboarding/understand").send({ ...focus, clarification: { question: "Region?", answer: "India" } });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual(understanding);
    expect(understand).toHaveBeenCalledWith(expect.objectContaining({ clarification: { question: "Region?", answer: "India" } }), { tenantId: "tenant-a" }, expect.any(AbortSignal));
  });

  it("maps AI failures to the standard error response", async () => {
    understand.mockRejectedValue(new AIGenerationError("ai_unavailable"));
    const response = await request(app).post("/api/onboarding/understand").send(focus);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("ai_unavailable");
  });
});
