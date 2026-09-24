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
import { selectIndustryEngine } from "../services/metaEngine";

const app = express();
app.use(express.json());
registerAiRoutes(app);
const network = vi.fn();
const body = { selectedIndustry: "Technology & SaaS", focusDescription: "I build SaaS products and lead technical teams.", tenantId: "forged", scope: { tenantId: "forged" } };
const result = { recommendedIndustry: "technology_saas", confidence: 0.9, reasoning: "Software focus", matchedSignals: ["SaaS"], dropdownAligned: true };

const providerResponse = (text: string) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: text } }] }), { status: 200 });
const invalidInputs = [
  {}, [], { ...body, focusDescription: undefined },
  ...[null, {}, { length: 20 }, 12345678901, true, [], ["long enough description"], "", " ".repeat(20), "\t\n ", "short", " 123456789 ", "x".repeat(501)]
    .map(focusDescription => ({ ...body, focusDescription })),
  ...[null, {}, { length: 20 }, 42, false, [], "", " \t\n ", "x".repeat(101)]
    .map(selectedIndustry => ({ ...body, selectedIndustry })),
];

const engineFields = ["recommendedIndustry", "confidence", "reasoning", "matchedSignals", "dropdownAligned"] as const;
function without(field: string) {
  return Object.fromEntries(Object.entries(result).filter(([key]) => key !== field));
}
const invalidEngineOutputs = [
  ...engineFields.map(field => ({ label: `missing ${field}`, output: without(field) })),
  ...[{}, null, 42, "", "unknown_vertical"].map(recommendedIndustry => ({ label: "invalid industry", output: { ...result, recommendedIndustry } })),
  ...[null, "0.9", -0.1, 1.1].map(confidence => ({ label: "invalid confidence", output: { ...result, confidence } })),
  ...[{}, null, 42, " "].map(reasoning => ({ label: "invalid reasoning", output: { ...result, reasoning } })),
  ...[{}, null, "SaaS", [42], [" "]].map(matchedSignals => ({ label: "invalid signals", output: { ...result, matchedSignals } })),
  ...[null, "false", 0].map(dropdownAligned => ({ label: "invalid alignment", output: { ...result, dropdownAligned } })),
];

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
  network.mockReset().mockImplementation(async () => providerResponse(JSON.stringify(result)));
  vi.stubGlobal("fetch", network);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("select-engine onboarding validation", () => {
  const endpoint = "select-engine";
  it.each(invalidInputs)("rejects invalid input with zero provider calls (%#)", async invalid => {
    const response = await request(app).post(`/api/ai/${endpoint}`).send(invalid);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("ai_invalid_input");
    expect(network).not.toHaveBeenCalled();
  });

  it("does not consume tenant budget for an invalid description", async () => {
    const rejected = await request(app).post(`/api/ai/${endpoint}`).send({ ...body, focusDescription: {} });
    expect(rejected.status).toBe(400);
    expect(network).not.toHaveBeenCalled();
    expect((await request(app).post("/api/ai/select-engine").send(body)).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([10, 500])("trims strings and accepts description boundary %i", async length => {
    const focus = "x".repeat(length);
    const response = await request(app).post(`/api/ai/${endpoint}`).send({ focusDescription: `  ${focus}  `, selectedIndustry: "  Technology & SaaS  " });
    expect(response.status).toBe(200);
    expect(network).toHaveBeenCalledTimes(1);
    for (const [, options] of network.mock.calls) {
      const prompt = JSON.parse(options.body).messages[0].content;
      expect(prompt).toContain(`"${focus}"`);
      expect(prompt).not.toContain('"  Technology & SaaS  "');
    }
  });

  it("defaults an omitted industry to Other", async () => {
    const response = await request(app).post(`/api/ai/${endpoint}`).send({ focusDescription: body.focusDescription });
    expect(response.status).toBe(200);
    expect(network.mock.calls.some(([, options]) => JSON.parse(options.body).messages[0].content.includes('DROPDOWN SELECTION: "Other"'))).toBe(true);
  });

  it.each([1, 100])("accepts trimmed industry boundary %i", async length => {
    const industry = "x".repeat(length);
    const response = await request(app).post(`/api/ai/${endpoint}`).send({ ...body, selectedIndustry: ` ${industry} ` });
    expect(response.status).toBe(200);
    expect(network.mock.calls.some(([, options]) => JSON.parse(options.body).messages[0].content.includes(`DROPDOWN SELECTION: "${industry}"`))).toBe(true);
  });

  it("rejects an absent request body before generation", async () => {
    const response = await request(app).post(`/api/ai/${endpoint}`);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("ai_invalid_input");
    expect(network).not.toHaveBeenCalled();
  });

  it.each(["not JSON", "{broken}", "null", "[]", "{}", JSON.stringify([result]), `prefix ${JSON.stringify(result)}`])("rejects unusable output %s without repair calls", async text => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "gemini");
    network.mockImplementation(async () => providerResponse(text));
    const response = await request(app).post(`/api/ai/${endpoint}`).send(body);
    expect(response.status).toBe(502);
    expect(response.body.code).toBe("ai_invalid_output");
    expect(response.body).not.toHaveProperty("recommendedEngine");
    expect(response.body).not.toHaveProperty("recommendedIndustry");
    expect(network).toHaveBeenCalledTimes(1);
  });

  // A transient 5xx gets exactly one retry of the same provider; nothing else is retried.
  it.each([[500, 503, "ai_unavailable", 2], [504, 504, "ai_timeout", 1], [400, 400, "ai_invalid_input", 1]] as const)("does not disguise provider HTTP %i as success", async (providerStatus, status, code, calls) => {
    network.mockImplementation(async () => new Response("private provider detail", { status: providerStatus }));
    const response = await request(app).post(`/api/ai/${endpoint}`).send(body);
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain("private provider detail");
    expect(response.body).not.toHaveProperty("recommendedIndustry");
    expect(response.body).not.toHaveProperty("recommendedEngine");
    expect(network).toHaveBeenCalledTimes(calls);
  });
});

describe("engine selection output contracts", () => {
  it.each(invalidEngineOutputs)("rejects engine $label (%#)", async ({ output }) => {
    network.mockResolvedValueOnce(providerResponse(JSON.stringify(output)));
    const response = await request(app).post("/api/ai/select-engine").send(body);
    expect(response.status).toBe(502);
    expect(response.body.code).toBe("ai_invalid_output");
    expect(response.body).not.toHaveProperty("recommendedIndustry");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("retains supported engine display-name normalization", async () => {
    network.mockResolvedValueOnce(providerResponse(JSON.stringify({ ...result, recommendedIndustry: "Technology & SaaS" })));
    const response = await request(app).post("/api/ai/select-engine").send(body);
    expect(response.status).toBe(200);
    expect(response.body.recommendedIndustry).toBe("technology_saas");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("preserves valid zero confidence and false alignment", async () => {
    network.mockImplementation(async () => providerResponse(JSON.stringify({ ...result, confidence: 0, dropdownAligned: false })));
    const engine = await request(app).post("/api/ai/select-engine").send(body);
    expect(engine.status).toBe(200);
    expect(engine.body).toMatchObject({ confidence: 0, dropdownAligned: false });
  });
});

describe("engine service boundary", () => {
  const call = (focus: string, industry: string | undefined) => selectIndustryEngine(industry!, focus, { tenantId: context.tenantId });

  it.each(invalidInputs.filter(input => !Array.isArray(input)))("rejects invalid runtime input before generation (%#)", async input => {
    const fields = input as { focusDescription: string; selectedIndustry?: string };
    await expect(call(fields.focusDescription, fields.selectedIndustry)).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(network).not.toHaveBeenCalled();
  });
});

describe("authenticated engine tenant budget plumbing", () => {
  it("charges calls to the trusted tenant and isolates another tenant for the same user", async () => {
    expect((await request(app).post("/api/ai/select-engine").send(body)).status).toBe(200);
    expect((await request(app).post("/api/ai/select-engine").send(body)).status).toBe(200);
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

  it("never starts an unauthenticated provider call", async () => {
    context.authenticated = false;
    expect((await request(app).post("/api/ai/select-engine").send(body)).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });

  it("no longer serves the retired analyze-identity endpoint", async () => {
    expect((await request(app).post("/api/ai/analyze-identity").send(body)).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });
});
