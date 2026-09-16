import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ tenantId: "", authenticated: true }));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../services/engines/index.js", () => ({ engineRegistry: {
  getEngine: () => ({ config: { displayName: "Technology & SaaS" } }),
  hasSpecializedEngine: () => true,
} }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (_req: unknown, res: express.Response, next: () => void) => context.authenticated ? next() : res.sendStatus(401),
  // Trusted middleware resolution; deliberately independent of request body/headers.
  authedOf: () => ({ tenant: { tenantId: context.tenantId, userId: "same-user" } }),
}));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../middlewares/rateLimit", () => ({ aiGenerationRateLimit: (_req: unknown, _res: unknown, next: () => void) => next() }));
import { registerAiRoutes } from "./ai";

const app = express();
app.use(express.json());
registerAiRoutes(app);
const network = vi.fn();
const body = { selectedIndustry: "Technology & SaaS", focusDescription: "I build SaaS products and lead technical teams.", tenantId: "forged", scope: { tenantId: "forged" } };
const result = {
  primaryIndustry: "Technology & SaaS", confidence: 0.9, subDomains: [], keywords: ["SaaS"],
  publications: [], topics: [], personalities: [], companies: [],
  recommendedIndustry: "technology_saas", reasoning: "Software focus", matchedSignals: ["SaaS"], dropdownAligned: true,
};

beforeEach(() => {
  context.tenantId = randomUUID();
  context.authenticated = true;
  vi.stubEnv("AI_PROVIDER", "openrouter");
  vi.stubEnv("AI_FALLBACK_PROVIDER", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-only-not-a-credential");
  vi.stubEnv("OPENROUTER_BASE_URL", "https://provider.invalid");
  vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "2");
  vi.stubEnv("AI_TENANT_BUDGET_WINDOW_SECONDS", "3600");
  vi.stubEnv("AI_SHARED_MAX_CONCURRENT_REQUESTS", "4");
  network.mockReset().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] }), { status: 200 }));
  vi.stubGlobal("fetch", network);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("authenticated identity tenant budget plumbing", () => {
  it("charges both identity calls to the trusted tenant and isolates another tenant for the same user", async () => {
    const identity = await request(app).post("/api/ai/analyze-identity").send(body);
    expect(identity.status).toBe(200);
    expect(identity.body.recommendedEngine.industry).toBe("technology_saas");
    expect(network).toHaveBeenCalledTimes(2);

    const denied = await request(app).post("/api/ai/select-engine").send({ ...body, scope: { tenantId: "another-forgery" } });
    expect(denied.status).toBe(429);
    expect(denied.body.code).toBe("ai_budget");
    expect(Number(denied.headers["retry-after"])).toBeGreaterThan(0);
    expect(network).toHaveBeenCalledTimes(2);

    context.tenantId = randomUUID();
    expect((await request(app).post("/api/ai/select-engine").send(body)).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(3);
  });

  it("does not mask identity budget exhaustion as fallback success", async () => {
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "1");
    const denied = await request(app).post("/api/ai/analyze-identity").send(body);
    expect(denied.status).toBe(429);
    expect(denied.body.code).toBe("ai_budget");
    expect(denied.headers["retry-after"]).toBeDefined();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each(["analyze-identity", "select-engine"])("never starts an unauthenticated %s provider call", async endpoint => {
    context.authenticated = false;
    expect((await request(app).post(`/api/ai/${endpoint}`).send(body)).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
});