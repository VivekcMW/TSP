import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { logAIInvalidOutputDiagnostic, logAIProviderFailure, type AIDiagnosticInput } from "./aiDiagnostics";

vi.mock("../lib/redis", () => ({ redis: undefined }));
const admission = vi.hoisted(() => ({ acquire: vi.fn<typeof import("./aiProviderLimiter").acquireAILease>() }));
vi.mock("./aiProviderLimiter", async importOriginal => ({
  ...await importOriginal<typeof import("./aiProviderLimiter")>(), acquireAILease: admission.acquire,
}));
const http = vi.fn();
let ai: typeof import("./openRouter");
let warn: MockInstance<typeof console.warn>;
const secret = "PRIVATE prompt/output/key/tenant https://secret.invalid/?key=hidden";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const anthropic = (overrides = {}) => json({
  id: "test", type: "message", role: "assistant", model: "claude-sonnet-5",
  stop_reason: "end_turn", content: [{ type: "text", text: secret }],
  usage: { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 3 }, ...overrides,
});
const record = () => {
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]).toHaveLength(2);
  expect(warn.mock.calls[0][0]).toBe("[ai-diagnostic]");
  const serialized = warn.mock.calls[0][1];
  for (const forbidden of [secret, "PRIVATE", "secret.invalid", "hidden", "unit-test-key", "private-tenant"]) expect(serialized).not.toContain(forbidden);
  return JSON.parse(serialized);
};

beforeEach(async () => {
  vi.resetModules();
  http.mockReset();
  admission.acquire.mockReset().mockReturnValue(() => undefined);
  vi.stubGlobal("fetch", http);
  for (const key of ["AI_PROVIDER", "AI_FALLBACK_PROVIDER", "ANTHROPIC_MODEL", "OPENROUTER_MODEL", "GEMINI_MODEL", "AI_TENANT_REQUEST_BUDGET"]) vi.stubEnv(key, "");
  for (const key of ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"]) vi.stubEnv(key, "unit-test-key");
  vi.stubEnv("AI_PROVIDER", "anthropic");
  vi.stubEnv("OPENROUTER_BASE_URL", "https://provider.invalid/api/v1");
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  ai = await import("./openRouter");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("allowlisted diagnostic contract", () => {
  it.each(["thoughtLeader", "industryInsider", "provocateur", "dataDriven", "professional", "custom"])("retains only constrained writer tone %s and numeric attempts", tone => {
    logAIInvalidOutputDiagnostic({ stage: "writer_sentinel", tone, attempt: 1, validationReasons: ["insufficient_source"] });
    expect(record()).toMatchObject({ stage: "writer_sentinel", tone, attempt: 1, validationReasons: ["insufficient_source"] });
    warn.mockClear();
    logAIInvalidOutputDiagnostic({ stage: "writer_json", tone, attempt: 2 });
    expect(record()).toMatchObject({ tone, attempt: 2 });
  });

  it.each([secret, "1", 0, -1, 3, 1.5, NaN, Infinity, { toJSON: () => secret }])("rejects unsafe tone and invalid attempt metadata %#", attempt => {
    logAIInvalidOutputDiagnostic({ stage: "writer_validation", tone: secret, attempt });
    expect(record()).toMatchObject({ tone: "custom", attempt: null });
  });

  it("retains precise allowlisted reasons, deduplicating and discarding arbitrary strings", () => {
    const reasons = ["publication_missing", "source_url_missing", "unexpected_url", "placeholder_url", "multiple_urls", "hashtags", "quotation", "personal_experience"] as const;
    logAIInvalidOutputDiagnostic({ stage: "writer_validation", validationReasons: [...reasons, secret, ...reasons] } as unknown as AIDiagnosticInput);
    expect(record().validationReasons).toEqual(reasons);
  });

  it("discards extra fields, unsafe metadata, and nonnumeric counts", () => {
    logAIInvalidOutputDiagnostic({
      stage: "writer_validation", provider: secret, model: secret, finishReason: secret,
      maxTokens: "2048", inputTokens: -1, outputTokens: Infinity, visibleTextLength: NaN,
      validationReasons: ["schema", secret, "schema", "evidence"], prompt: secret, output: secret,
      error: { message: secret }, tenantId: secret, url: secret, apiKey: secret,
    } as unknown as AIDiagnosticInput);
    expect(record()).toEqual({ code: "ai_invalid_output", stage: "writer_validation", provider: null, model: null,
      finishReason: "other", maxTokens: null, inputTokens: null, outputTokens: null, visibleTextLength: null,
      validationReasons: ["schema", "evidence"] });
  });

  it.each(["https://secret.invalid", "sk-private-key", "model\n", "a".repeat(121), { toJSON: () => secret }])("rejects unsafe model metadata %#", model => {
    logAIInvalidOutputDiagnostic({ stage: "writer_json", model });
    expect(record().model).toBeNull();
  });

  it.each(["openai/gpt-4o-mini", "models/gemini-3.6-flash", "vendor/model:free", "a".repeat(120)])("retains bounded model IDs %#", model => {
    logAIInvalidOutputDiagnostic({ stage: "writer_schema", model, provider: "openrouter", inputTokens: 0, outputTokens: 8, visibleTextLength: 42, maxTokens: 2048 });
    expect(record()).toMatchObject({ model, provider: "openrouter", inputTokens: 0, outputTokens: 8, visibleTextLength: 42, maxTokens: 2048 });
  });

  it("does not emit an arbitrary stage or allow logging failure to escape", () => {
    logAIInvalidOutputDiagnostic({ stage: secret } as unknown as AIDiagnosticInput);
    expect(warn).not.toHaveBeenCalled();
    warn.mockImplementation(() => { throw new Error(secret); });
    expect(() => logAIInvalidOutputDiagnostic({ stage: "writer_json" })).not.toThrow();
  });
});

describe("provider invalid-output diagnostics", () => {
  it("pinpoints Anthropic truncation with effective budget, cache-inclusive usage and visible length only", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockResolvedValue(anthropic({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: secret }, { type: "text", text: secret }] }));
    const failure = await ai.generateText(secret, { systemPrompt: secret, maxTokens: 1234, scope: { tenantId: "private-tenant" } }).catch(ai.getAIErrorResponse);
    expect(failure).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_invalid_output")));
    expect(http).toHaveBeenCalledTimes(1);
    expect(JSON.parse(http.mock.calls[0][1].body).max_tokens).toBe(1234);
    expect(record()).toMatchObject({ provider: "anthropic", stage: "provider_finish_reason", model: "claude-sonnet-5", finishReason: "max_tokens", maxTokens: 1234, inputTokens: 13, outputTokens: 7, visibleTextLength: secret.length });
  });

  it("distinguishes malformed Anthropic blocks from empty visible text", async () => {
    http.mockResolvedValueOnce(anthropic({ content: [{ type: "text", text: { private: secret } }] }));
    await expect(ai.generateText(secret)).rejects.toMatchObject({ code: "ai_invalid_output" });
    expect(record()).toMatchObject({ stage: "provider_content_shape", visibleTextLength: 0 });
    warn.mockClear();
    http.mockResolvedValueOnce(anthropic({ content: [{ type: "thinking", thinking: secret }] }));
    await expect(ai.generateText(secret)).rejects.toMatchObject({ code: "ai_invalid_output" });
    expect(record()).toMatchObject({ stage: "provider_empty_text", finishReason: "end_turn", visibleTextLength: 0 });
  });

  it.each(["anthropic", "openrouter", "gemini"])("logs %s JSON decoding failure without SDK body or error", async provider => {
    vi.stubEnv("AI_PROVIDER", provider);
    http.mockResolvedValue(new Response(secret, { headers: { "content-type": "application/json" } }));
    await expect(ai.generateText(secret)).rejects.toMatchObject({ code: "ai_invalid_output" });
    expect(http).toHaveBeenCalledTimes(1);
    expect(record()).toMatchObject({ provider, stage: "provider_response_json", maxTokens: 2048, finishReason: "other", inputTokens: null, outputTokens: null, visibleTextLength: null });
  });

  it.each(["openrouter", "gemini"])("records %s truncation without including reasoning or extra body fields", async provider => {
    vi.stubEnv("AI_PROVIDER", provider);
    http.mockResolvedValue(provider === "openrouter" ? json({ model: "openai/gpt-4o-mini", usage: { prompt_tokens: 9, completion_tokens: 4 }, choices: [{ finish_reason: "length", message: { content: secret, reasoning: secret } }], secret }) :
      json({ modelVersion: "gemini-3.6-flash", usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 }, candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ thought: true, text: secret }, { text: secret }] } }], secret }));
    await expect(ai.generateText(secret)).rejects.toMatchObject({ code: "ai_invalid_output" });
    expect(record()).toMatchObject({ provider, stage: "provider_finish_reason", finishReason: provider === "openrouter" ? "length" : "MAX_TOKENS", inputTokens: 9, outputTokens: 4, visibleTextLength: secret.length });
  });

  it.each(["anthropic", "openrouter", "gemini"])("sanitizes malicious %s model and finish reason from HTTP", async provider => {
    vi.stubEnv("AI_PROVIDER", provider);
    http.mockResolvedValue(provider === "anthropic" ? anthropic({ model: secret, stop_reason: secret }) : provider === "openrouter" ?
      json({ model: secret, choices: [{ finish_reason: secret, message: { content: secret } }] }) :
      json({ modelVersion: secret, candidates: [{ finishReason: secret, content: { parts: [{ text: secret }] } }] }));
    await expect(ai.generateText(secret)).rejects.toMatchObject({ code: "ai_invalid_output" });
    expect(record()).toMatchObject({ provider, model: null, finishReason: "other" });
  });

  it.each(["openrouter", "gemini"])("records empty %s output with the original finish reason", async provider => {
    vi.stubEnv("AI_PROVIDER", provider);
    http.mockResolvedValue(provider === "openrouter" ? json({ choices: [{ finish_reason: "stop", message: { content: "" } }] }) : json({ candidates: [{ finishReason: "STOP", content: { parts: [] } }] }));
    await expect(ai.generateText(secret)).rejects.toMatchObject({ code: "ai_invalid_output" });
    expect(record()).toMatchObject({ stage: "provider_empty_text", visibleTextLength: 0, finishReason: provider === "openrouter" ? "stop" : "STOP" });
  });

  it("stays silent for success, refusal, context overflow and HTTP failures", async () => {
    http.mockResolvedValueOnce(anthropic()).mockResolvedValueOnce(anthropic({ stop_reason: "refusal" }))
      .mockResolvedValueOnce(anthropic({ stop_reason: "model_context_window_exceeded" })).mockResolvedValueOnce(json({ error: secret }, 429));
    await expect(ai.generateText(secret)).resolves.toBe(secret);
    for (const code of ["ai_refusal", "ai_invalid_input", "ai_rate_limit"]) await expect(ai.generateText(secret)).rejects.toMatchObject({ code });
    const lines = warn.mock.calls as unknown as Array<[string, string]>;
    expect(lines.filter(([tag]) => tag === "[ai-diagnostic]")).toEqual([]);
    // Failed provider calls get their own metadata-only line; never the prompt or provider body.
    expect(lines.map(([tag, body]) => [tag, JSON.parse(body).code])).toEqual([
      ["[ai-provider-failure]", "ai_refusal"], ["[ai-provider-failure]", "ai_invalid_input"], ["[ai-provider-failure]", "ai_rate_limit"],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  });

  it("does not log an invalid response arriving after cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    http.mockImplementation(async () => { controller.abort(); return anthropic({ stop_reason: "max_tokens" }); });
    await expect(ai.generateText(secret, { signal: controller.signal, scope: { tenantId: "private-tenant" } })).rejects.toMatchObject({ code: "ai_cancelled" });
    const cancellation = providerRecord();
    expect(cancellation).toEqual({ provider: "anthropic", model: "claude-sonnet-5", code: "ai_cancelled", status: null,
      retryAfterSeconds: null, operationId: expect.stringMatching(UUID), jobId: null, stage: "provider", elapsedMs: 0,
      budgetMs: 20_000, timeoutOrigin: "caller_cancel", attempt: 1 });
    await vi.advanceTimersByTimeAsync(0); // Let the late invalid adapter response finish.
    expect(providerRecord()).toEqual(cancellation);
    expect(http).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.filter(([tag]) => tag === "[ai-diagnostic]")).toEqual([]);
  });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operationId = "06576046-724f-47d4-9ef8-2d3166306fb7";
const jobId = "719ca12b-420a-4c50-a38c-8e6733ba04a0";
const tenantId = "a1bbfbeb-44e0-423d-9281-d01336fa2171";

function providerRecord() {
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]).toHaveLength(2);
  expect(warn.mock.calls[0][0]).toBe("[ai-provider-failure]");
  const serialized = String(warn.mock.calls[0][1]);
  for (const forbidden of [secret, "PRIVATE", "secret.invalid", "hidden", "unit-test-key", "private-tenant", tenantId]) {
    expect(serialized.includes(forbidden), "provider diagnostics must contain metadata only").toBe(false);
  }
  return JSON.parse(serialized);
}

describe("provider-failure metadata allowlist", () => {
  const safe = { provider: "gemini", model: "gemini-3.1-pro-preview", code: "ai_timeout", status: 504, retryAfterSeconds: 0,
    operationId, jobId, stage: "writer", elapsedMs: 35_001, budgetMs: 90_000, timeoutOrigin: "upstream_timeout", attempt: 1 };

  it("retains correlation and budget metadata but discards prompts, credentials, SDK errors, scope and extra serializers", () => {
    const toJSON = vi.fn(() => secret);
    const input = { ...safe, prompt: secret, systemPrompt: secret, output: secret, apiKey: secret, credentials: secret,
      headers: { Authorization: secret }, request: { body: secret }, response: { body: secret }, rawSDKError: new Error(secret),
      error: { message: secret, stack: secret, toJSON }, tenantId, scope: { tenantId }, url: secret, toJSON };
    logAIProviderFailure(input);
    expect(providerRecord()).toEqual(safe);
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("does not even read malicious getters on fields outside the allowlist", () => {
    const readExtra = vi.fn(() => { throw new Error(secret); });
    const input = { ...safe };
    for (const field of ["prompt", "credentials", "headers", "error", "tenantId", "scope", "toJSON"]) Object.defineProperty(input, field, { enumerable: true, get: readExtra });
    logAIProviderFailure(input);
    expect(providerRecord()).toEqual(safe);
    expect(readExtra).not.toHaveBeenCalled();
  });

  it("redacts arbitrary strings in every metadata field without copying extra data", () => {
    logAIProviderFailure({ provider: secret, model: secret, code: secret, status: secret, retryAfterSeconds: secret,
      operationId: secret, jobId: secret, stage: secret, elapsedMs: secret, budgetMs: secret, timeoutOrigin: secret, attempt: secret });
    expect(providerRecord()).toEqual({ provider: null, model: null, code: "other", status: null, retryAfterSeconds: null,
      operationId: null, jobId: null, stage: null, elapsedMs: null, budgetMs: null, timeoutOrigin: null, attempt: null });
  });

  it.each(["admission", "provider", "writer", "repair"])("retains allowlisted stage %s", stage => {
    logAIProviderFailure({ ...safe, stage });
    expect(providerRecord()).toEqual({ ...safe, stage });
  });

  it.each(["operation_deadline", "caller_deadline", "caller_cancel", "lease_lost", "upstream_timeout"])("retains distinct abort origin %s", timeoutOrigin => {
    logAIProviderFailure({ ...safe, timeoutOrigin });
    expect(providerRecord()).toEqual({ ...safe, timeoutOrigin });
  });

  it.each([1, 2, 3])("retains bounded provider attempt %s", attempt => {
    logAIProviderFailure({ ...safe, attempt });
    expect(providerRecord()).toEqual({ ...safe, attempt });
  });

  it.each([0, -1, 4, 1.5, "1", NaN, Infinity, { toJSON: () => secret }])("rejects unsafe attempt metadata %#", attempt => {
    logAIProviderFailure({ ...safe, attempt });
    expect(providerRecord()).toEqual({ ...safe, attempt: null });
  });

  it.each(["", "private-tenant", `https://secret.invalid/${jobId}`, `${jobId}\n`, `${jobId}suffix`, 1234, { toJSON: () => secret }])("rejects malformed operation/job correlation identifiers %#", value => {
    logAIProviderFailure({ ...safe, operationId: value, jobId: value });
    expect(providerRecord()).toEqual({ ...safe, operationId: null, jobId: null });
  });

  it.each(["sk-private-key", "AIza-private-key", "Bearer-private-key", "https://secret.invalid", "model\n", "model\u2028", "a".repeat(121), { toJSON: () => secret }])("rejects unsafe provider model metadata %#", model => {
    logAIProviderFailure({ ...safe, model });
    expect(providerRecord()).toEqual({ ...safe, model: null });
  });

  it.each([-1, 1.5, "90000", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, { toJSON: () => secret }])("rejects non-integer or unsafe elapsed/budget/retry counts %#", value => {
    logAIProviderFailure({ ...safe, elapsedMs: value, budgetMs: value, retryAfterSeconds: value });
    expect(providerRecord()).toEqual({ ...safe, elapsedMs: null, budgetMs: null, retryAfterSeconds: null });
  });

  it.each([99, 600, 504.5, "504", NaN, Infinity, { toJSON: () => secret }])("rejects invalid upstream status metadata %#", status => {
    logAIProviderFailure({ ...safe, status });
    expect(providerRecord()).toEqual({ ...safe, status: null });
  });

  it("never serializes object-valued allowlisted fields or lets diagnostic failures replace the original error", () => {
    const toJSON = vi.fn(() => { throw new Error(secret); });
    const payload = { toJSON, message: secret };
    logAIProviderFailure({ provider: payload, model: payload, code: payload, status: payload, retryAfterSeconds: payload,
      operationId: payload, jobId: payload, stage: payload, elapsedMs: payload, budgetMs: payload, timeoutOrigin: payload, attempt: payload });
    expect(providerRecord()).toEqual({ provider: null, model: null, code: "other", status: null, retryAfterSeconds: null,
      operationId: null, jobId: null, stage: null, elapsedMs: null, budgetMs: null, timeoutOrigin: null, attempt: null });
    expect(toJSON).not.toHaveBeenCalled();
    warn.mockImplementation(() => { throw new Error(secret); });
    expect(() => logAIProviderFailure(safe)).not.toThrow();
    expect(() => logAIProviderFailure({ get provider() { throw new Error(secret); } })).not.toThrow();
  });
});