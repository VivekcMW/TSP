import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { suggest, understand, agent, pass } = vi.hoisted(() => ({ suggest: vi.fn(), understand: vi.fn(), agent: vi.fn(), pass: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: { tenantId: "tenant-a", userId: "user-a" } }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => pass }));
vi.mock("../middlewares/rateLimit", () => ({ onboardingSuggestionRateLimit: pass }));
vi.mock("../services/onboardingSuggestions", async original => ({ ...await original<typeof import("../services/onboardingSuggestions")>(), suggestOnboardingItems: suggest }));
vi.mock("../services/onboardingUnderstanding", async original => ({ ...await original<typeof import("../services/onboardingUnderstanding")>(), understandFocus: understand }));
vi.mock("../services/onboardingAgent", async original => ({ ...await original<typeof import("../services/onboardingAgent")>(), runOnboardingAgent: agent }));
import { AIGenerationError } from "../services/openRouter";
import { registerOnboardingSuggestionRoutes } from "./onboarding-suggestions";

const app = express(); app.use(express.json()); registerOnboardingSuggestionRoutes(app);
const body = { step: "publications", focusDescription: "I lead marketing for programmatic DOOH in India.", searchEdition: "en-IN" };
beforeEach(() => { suggest.mockReset(); understand.mockReset(); agent.mockReset(); });

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

describe("POST /api/onboarding/agent", () => {
  const run = { focusDescription: "I lead marketing for programmatic DOOH in India.", steps: ["publications", "topics"] };
  const stream = (req: request.Test) => req.buffer(true).parse((res, done) => { let text = ""; res.setEncoding("utf8"); res.on("data", chunk => { text += chunk; }); res.on("end", () => done(null, text)); });
  const events = (text: string) => text.split("\n\n").filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, "")));

  it("rejects steps out of order without starting the agent", async () => {
    const response = await request(app).post("/api/onboarding/agent").send({ ...run, steps: ["topics", "publications"] });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_request");
    expect(agent).not.toHaveBeenCalled();
  });

  it("streams the agent's events as they happen, never cached", async () => {
    agent.mockImplementation(async (_input: unknown, _scope: unknown, _signal: unknown, emit: (event: object) => void) => {
      emit({ type: "progress", step: "publications", message: "Searching Google News" });
      emit({ type: "result", step: "publications", grounded: true, items: [], picks: [], note: "" });
      emit({ type: "done" });
    });
    const response = await stream(request(app).post("/api/onboarding/agent").send(run));
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(events(response.body as string)).toEqual([
      { type: "progress", step: "publications", message: "Searching Google News" },
      { type: "result", step: "publications", grounded: true, items: [], picks: [], note: "" },
      { type: "done" },
    ]);
    expect(agent).toHaveBeenCalledWith(expect.objectContaining({ steps: ["publications", "topics"] }), { tenantId: "tenant-a" }, expect.any(AbortSignal), expect.any(Function));
  });

  it("ends the stream with an error event when the run fails", async () => {
    agent.mockRejectedValue(new AIGenerationError("ai_unavailable"));
    const response = await stream(request(app).post("/api/onboarding/agent").send(run));
    expect(events(response.body as string)).toEqual([{ type: "error", step: null, code: "ai_unavailable" }]);
  });
});
