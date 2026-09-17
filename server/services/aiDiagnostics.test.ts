import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logAIInvalidOutputDiagnostic, type AIDiagnosticInput } from "./aiDiagnostics";

vi.mock("../lib/redis", () => ({ redis: undefined }));
const http = vi.fn();
let ai: typeof import("./openRouter");
let warn: ReturnType<typeof vi.spyOn>;
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
  vi.stubGlobal("fetch", http);
  for (const key of ["AI_PROVIDER", "AI_FALLBACK_PROVIDER", "ANTHROPIC_MODEL", "OPENROUTER_MODEL", "GEMINI_MODEL", "AI_TENANT_REQUEST_BUDGET"]) vi.stubEnv(key, "");
  for (const key of ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"]) vi.stubEnv(key, "unit-test-key");
  vi.stubEnv("AI_PROVIDER", "anthropic");
  vi.stubEnv("OPENROUTER_BASE_URL", "https://provider.invalid/api/v1");
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  ai = await import("./openRouter");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

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
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not log an invalid response arriving after cancellation", async () => {
    const controller = new AbortController();
    http.mockImplementation(async () => { controller.abort(); return anthropic({ stop_reason: "max_tokens" }); });
    await expect(ai.generateText(secret, { signal: controller.signal })).rejects.toMatchObject({ code: "ai_cancelled" });
    expect(warn).not.toHaveBeenCalled();
  });
});