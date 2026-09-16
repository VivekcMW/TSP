import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real SDK serialization/errors/retry settings with mock HTTP only.
vi.mock("../lib/redis", () => ({ redis: undefined }));
let ai: typeof import("./openRouter");
const http = vi.fn();
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const message = (overrides = {}) => json({
  id: "test-message", type: "message", role: "assistant", model: "claude-sonnet-5",
  content: [{ type: "text", text: "Grounded post" }], stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 6 }, ...overrides,
});
const legacy = () => json({ model: "legacy-model", usage: { prompt_tokens: 20, completion_tokens: 8 }, choices: [{ finish_reason: "stop", message: { content: "Fallback post" } }] });
const errorResponse = (status: number, details?: object, headers = {}) => json({ type: "error", error: { type: "api_error", message: "private-provider-details", details } }, status, headers);

beforeEach(async () => {
  vi.resetModules();
  http.mockReset();
  vi.stubGlobal("fetch", http);
  for (const key of ["AI_PROVIDER", "AI_FALLBACK_PROVIDER", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "AI_TENANT_REQUEST_BUDGET", "AI_TENANT_BUDGET_WINDOW_SECONDS", "AI_SHARED_MAX_CONCURRENT_REQUESTS", "AI_INTEGRATIONS_GEMINI_API_KEY", "AI_INTEGRATIONS_GEMINI_BASE_URL", "OPENROUTER_MODEL", "GEMINI_MODEL"]) vi.stubEnv(key, "");
  vi.stubEnv("CLAUDE_API_KEY", "claude-unit-test-only");
  vi.stubEnv("OPENROUTER_API_KEY", "router-unit-test-only");
  vi.stubEnv("OPENROUTER_BASE_URL", "https://provider.invalid/api/v1");
  vi.stubEnv("GEMINI_API_KEY", "gemini-unit-test-only");
  ai = await import("./openRouter");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Claude-primary provider contract", () => {
  it.each(["", "anthropic", "claude", "CLAUDE"])("selects Claude for provider %j and returns visible text plus usage", async provider => {
    vi.stubEnv("AI_PROVIDER", provider);
    http.mockResolvedValue(message({ content: [{ type: "thinking", thinking: "private reasoning" }, { type: "redacted_thinking", data: "opaque" }, { type: "text", text: " Grounded " }, { type: "text", text: "post " }], usage: { input_tokens: 10, cache_creation_input_tokens: 4, cache_read_input_tokens: 3, output_tokens: 6 } }));
    expect(await ai.generateTextWithMetadata("article", { systemPrompt: "trusted", temperature: 0.7, maxTokens: 1234 })).toEqual({ text: "Grounded post", provider: "anthropic", model: "claude-sonnet-5", usage: { inputTokens: 17, outputTokens: 6 }, fallbackUsed: false });
    const [url, options] = http.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(options.body)).toMatchObject({ model: ai.DEFAULT_ANTHROPIC_MODEL, system: "trusted", max_tokens: 1234, messages: [{ role: "user", content: "article" }], thinking: { type: "disabled" } });
    expect(JSON.parse(options.body)).not.toHaveProperty("temperature");
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("prefers ANTHROPIC_API_KEY and respects the model override", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-unit-test-only");
    vi.stubEnv("ANTHROPIC_MODEL", "custom-sonnet-model");
    http.mockResolvedValue(message({ model: "custom-sonnet-model" }));
    expect(await ai.generateTextWithMetadata("article")).toMatchObject({ model: "custom-sonnet-model" });
    expect(new Headers(http.mock.calls[0][1].headers).get("x-api-key")).toBe("anthropic-unit-test-only");
    expect(JSON.parse(http.mock.calls[0][1].body).model).toBe("custom-sonnet-model");
  });

  it.each(["openrouter", "gemini"])("preserves explicit %s even with a Claude key", async provider => {
    vi.stubEnv("AI_PROVIDER", provider);
    http.mockResolvedValue(provider === "openrouter" ? legacy() : json({ modelVersion: "gemini-test", usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 }, candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Gemini post" }] } }] }));
    expect(await ai.generateTextWithMetadata("article")).toMatchObject({ provider, fallbackUsed: false, usage: provider === "openrouter" ? { inputTokens: 20, outputTokens: 8 } : { inputTokens: 9, outputTokens: 4 } });
  });

  it("retains OpenRouter as default without Claude credentials", async () => {
    vi.stubEnv("CLAUDE_API_KEY", "");
    http.mockResolvedValue(legacy());
    expect(await ai.generateTextWithMetadata("article")).toMatchObject({ provider: "openrouter" });
  });

  it("uses null for unreported usage and preserves string wrapper", async () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");
    http.mockImplementation(() => json({ choices: [{ message: { content: "Post" }, finish_reason: "stop" }] }));
    expect(await ai.generateTextWithMetadata("article")).toMatchObject({ usage: { inputTokens: null, outputTokens: null } });
    expect(await ai.generateText("article")).toBe("Post");
  });

  it.each([400, 401, 402, 403, 404, 408, 413, 422, 429, 500, 504, 529])("never retries HTTP %s by default or leaks provider bodies", async status => {
    http.mockResolvedValue(errorResponse(status));
    const result = await ai.generateText("article").catch(ai.getAIErrorResponse);
    expect(result).toHaveProperty("body.code");
    expect(JSON.stringify(result)).not.toContain("private-provider-details");
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("honors transient Retry-After without claiming quota exhaustion", async () => {
    vi.useFakeTimers();
    http.mockResolvedValueOnce(errorResponse(429, undefined, { "retry-after": "2" })).mockResolvedValueOnce(message());
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_rate_limit", retryAfterSeconds: 2 });
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_rate_limit" });
    expect(http).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2001);
    expect(await ai.generateText("article")).toBe("Grounded post");
  });

  it.each(["invalid", "Wed, 16 Sep 2026 12:00:10 GMT"])("parses Retry-After %s safely", async header => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    http.mockResolvedValue(errorResponse(429, undefined, { "retry-after": header }));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_rate_limit", retryAfterSeconds: header === "invalid" ? 60 : 10 });
  });

  it("recognizes the documented structured spend-cap error", async () => {
    http.mockResolvedValue(errorResponse(429, { error_code: "enforced_spend_limit_reached" }));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_quota" });
  });

  it.each(["max_tokens", "tool_use", "pause_turn", "stop_sequence", null])("rejects stop_reason %j without fallback", async stop_reason => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockResolvedValue(message({ stop_reason }));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_invalid_output" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([{ stop_reason: "refusal" }, { stop_details: { type: "refusal" } }])("does not fall back after a refusal (%j)", async overrides => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockResolvedValue(message(overrides));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_refusal" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([
    { content: [] }, { content: [{ type: "thinking", thinking: "hidden" }] },
    { content: [{ type: "text", text: " " }] }, { content: [{ type: "text" }] },
  ])("rejects unusable blocks %j", async ({ content }) => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockResolvedValue(message({ content }));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_invalid_output" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([400, 413, 422])("does not fall back after invalid input HTTP %s", async status => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockResolvedValue(errorResponse(status));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([401, 402, 429, 500, 529])("uses exactly one explicit fallback for HTTP %s", async status => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockResolvedValueOnce(errorResponse(status)).mockResolvedValueOnce(legacy());
    expect(await ai.generateTextWithMetadata("article")).toEqual({ text: "Fallback post", provider: "openrouter", model: "legacy-model", usage: { inputTokens: 20, outputTokens: 8 }, fallbackUsed: true });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("does not recursively fall back if both providers fail", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockImplementation(() => errorResponse(500));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("does not retry a provider via its alias", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "claude");
    http.mockResolvedValue(errorResponse(500));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("fails closed for unknown provider or missing credentials", async () => {
    vi.stubEnv("AI_PROVIDER", "unknown");
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_configuration" });
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("CLAUDE_API_KEY", "");
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_configuration" });
    expect(http).not.toHaveBeenCalled();
  });

  it("validates input before admission and provider calls", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    for (const prompt of ["", " ", "x".repeat(200_001)]) await expect(ai.generateText(prompt)).rejects.toMatchObject({ code: "ai_invalid_input" });
    for (const maxTokens of [0, -1, 1.5, Infinity]) await expect(ai.generateText("article", { maxTokens })).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(http).not.toHaveBeenCalled();
  });

  it("never falls back after in-flight caller cancellation", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    http.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
      started();
    }));
    const result = ai.generateText("article", { signal: controller.signal }).catch(ai.getAIErrorResponse);
    await ready;
    controller.abort();
    expect(await result).toMatchObject({ body: { code: "ai_cancelled" } });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("shares one deadline with fallback and does not retry after timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(errorResponse(500)), 15_000)))
      .mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("abort")), { once: true })));
    const result = ai.generateText("article").catch(ai.getAIErrorResponse);
    await vi.advanceTimersByTimeAsync(ai.AI_REQUEST_TIMEOUT_MS);
    expect(await result).toMatchObject({ body: { code: "ai_timeout" } });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("enforces tenant budgets across providers without fallback bypass", async () => {
    vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "1");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockImplementation(() => message());
    await ai.generateText("article", { scope: { tenantId: "tenant-a" } });
    await expect(ai.generateText("article", { scope: { tenantId: "tenant-a" } })).rejects.toMatchObject({ code: "ai_budget" });
    await ai.generateText("article", { scope: { tenantId: "tenant-b" } });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed JSON without exposing it or falling back", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockResolvedValue(new Response("private-broken-json", { headers: { "content-type": "application/json" } }));
    expect(await ai.generateText("article").catch(ai.getAIErrorResponse)).toMatchObject({ body: { code: "ai_invalid_output" } });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("rejects context overflow without fallback", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    http.mockResolvedValue(message({ stop_reason: "model_context_window_exceeded" }));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each(["openrouter", "gemini"])("does not bypass %s refusals or invalid input via Claude fallback", async provider => {
    vi.stubEnv("AI_PROVIDER", provider);
    vi.stubEnv("AI_FALLBACK_PROVIDER", "claude");
    http.mockResolvedValueOnce(provider === "openrouter" ? json({ choices: [{ finish_reason: "content_filter" }] }) : json({ promptFeedback: { blockReason: "SAFETY" } }))
      .mockResolvedValueOnce(errorResponse(400));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_refusal" });
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("falls back to Claude only when explicitly configured from a legacy provider", async () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");
    vi.stubEnv("AI_FALLBACK_PROVIDER", "claude");
    http.mockResolvedValueOnce(errorResponse(500)).mockResolvedValueOnce(message());
    expect(await ai.generateTextWithMetadata("article")).toMatchObject({ provider: "anthropic", fallbackUsed: true });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("keeps Claude slots occupied when transport ignores abort and never starts fallback", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const release: Array<() => void> = [];
    http.mockImplementation(() => new Promise(resolve => release.push(() => resolve(message()))));
    const pending = Array.from({ length: ai.AI_MAX_CONCURRENT_REQUESTS }, () => ai.generateText("article").catch(ai.getAIErrorResponse));
    await vi.advanceTimersByTimeAsync(ai.AI_REQUEST_TIMEOUT_MS);
    for (const result of await Promise.all(pending)) expect(result).toMatchObject({ body: { code: "ai_timeout" } });
    await expect(ai.generateText("overflow")).rejects.toMatchObject({ code: "ai_busy" });
    expect(http).toHaveBeenCalledTimes(4);
    release.forEach(done => done());
    await vi.advanceTimersByTimeAsync(0);
    http.mockResolvedValue(message());
    expect(await ai.generateText("next")).toBe("Grounded post");
    expect(http).toHaveBeenCalledTimes(5);
  });

  it("suppresses SDK debug logging even if enabled in the process environment", async () => {
    vi.stubEnv("ANTHROPIC_LOG", "debug");
    const log = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    http.mockResolvedValue(message());
    await ai.generateText("article");
    expect(log).not.toHaveBeenCalled();
  });
});