import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let ai: typeof import("./openRouter");
const fetchMock = vi.fn();
const completion = (content = "Grounded post") => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AI_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_API_KEY", "unit-test-only");
  vi.stubEnv("OPENROUTER_BASE_URL", "https://provider.invalid/api/v1");
  vi.stubEnv("GEMINI_API_KEY", "unit-test-only");
  ai = await import("./openRouter");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("AI provider safety", () => {
  it("returns real provider text and separates trusted system instructions", async () => {
    fetchMock.mockResolvedValue(completion("  Real content  "));
    expect(await ai.generateText("untrusted article", { systemPrompt: "trusted rules" })).toBe("Real content");
    const options = fetchMock.mock.calls[0][1];
    expect(JSON.parse(options.body).messages).toEqual([{ role: "system", content: "trusted rules" }, { role: "user", content: "untrusted article" }]);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.redirect).toBe("error");
  });

  it.each([401, 402, 403, 429])("does not retry HTTP %s, suppresses subsequent calls, and redacts bodies", async status => {
    fetchMock.mockResolvedValue(new Response("provider-secret-body", { status, headers: { "retry-after": "120" } }));
    const code = [402, 429].includes(status) ? "ai_quota" : "ai_configuration";
    await expect(ai.generateText("article")).rejects.toMatchObject({ code });
    await expect(ai.generateText("another article")).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const failure = ai.getAIErrorResponse(new ai.AIGenerationError(code));
    expect(failure.status).toBe(503);
    expect(JSON.stringify(failure)).not.toContain("provider-secret-body");
  });

  it("allows calls again after the bounded cooldown", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response("quota", { status: 429 })).mockResolvedValueOnce(completion());
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_quota" });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await ai.generateText("article")).toBe("Grounded post");
  });

  it.each(["", "   "])("rejects empty output %j instead of pretending to generate", async content => {
    fetchMock.mockResolvedValue(completion(content));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_invalid_output" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects truncated output", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "partial" } }] })));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_invalid_output" });
  });

  it("rejects malformed JSON without leaking the response", async () => {
    fetchMock.mockResolvedValue(new Response("sensitive non-JSON body"));
    const failure = await ai.generateText("article").catch(ai.getAIErrorResponse);
    expect(failure).toMatchObject({ status: 502, body: { code: "ai_invalid_output" } });
    expect(JSON.stringify(failure)).not.toContain("sensitive");
  });

  it("rejects an error envelope even if the provider returns HTTP 200", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 429, message: "private billing details" } })));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_quota" });
    await expect(ai.generateText("next")).rejects.toMatchObject({ code: "ai_quota" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed for missing credentials without a provider request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("AI_INTEGRATIONS_GEMINI_API_KEY", "");
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: "ai_configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors a caller deadline and cancels in-flight transport", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }));
    const outcome = ai.generateText("article", { signal: controller.signal }).catch(ai.getAIErrorResponse);
    controller.abort(new ai.AIGenerationError("ai_timeout"));
    expect(await outcome).toMatchObject({ status: 504, body: { code: "ai_timeout" } });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("keeps transport slots occupied when a transport ignores timeout cancellation", async () => {
    vi.useFakeTimers();
    const releases: Array<() => void> = [];
    fetchMock.mockImplementation(() => new Promise(resolve => releases.push(() => resolve(completion()))));
    const pending = Array.from({ length: ai.AI_MAX_CONCURRENT_REQUESTS }, () => ai.generateText("article").catch(ai.getAIErrorResponse));
    await vi.advanceTimersByTimeAsync(ai.AI_REQUEST_TIMEOUT_MS);
    expect((await Promise.all(pending)).every(result => typeof result !== "string" && result.status === 504)).toBe(true);
    await expect(ai.generateText("overflow")).rejects.toMatchObject({ code: "ai_busy" });
    releases.forEach(release => release());
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockResolvedValue(completion());
    await expect(ai.generateText("next")).resolves.toBe("Grounded post");
  });

  it("does not expose raw network exceptions", async () => {
    fetchMock.mockRejectedValue(new Error("secret-url-and-key"));
    const failure = await ai.generateText("article").catch(ai.getAIErrorResponse);
    expect(failure).toMatchObject({ status: 503, body: { code: "ai_unavailable" } });
    expect(JSON.stringify(failure)).not.toContain("secret-url-and-key");
  });

  it("times out, aborts transport, and releases capacity", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal;
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const outcome = ai.generateText("article").catch(ai.getAIErrorResponse);
    await vi.advanceTimersByTimeAsync(ai.AI_REQUEST_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ status: 504, body: { code: "ai_timeout" } });
    expect(signal!.aborted).toBe(true);
    fetchMock.mockResolvedValue(completion());
    expect(await ai.generateText("next article")).toBe("Grounded post");
  });

  it("caps in-flight requests without an unbounded waiting queue", async () => {
    const releases: Array<() => void> = [];
    fetchMock.mockImplementation(() => new Promise(resolve => releases.push(() => resolve(completion()))));
    const pending = Array.from({ length: ai.AI_MAX_CONCURRENT_REQUESTS }, () => ai.generateText("article"));
    await expect(ai.generateText("overflow")).rejects.toMatchObject({ code: "ai_busy" });
    expect(fetchMock).toHaveBeenCalledTimes(ai.AI_MAX_CONCURRENT_REQUESTS);
    releases.forEach(release => release());
    await Promise.all(pending);
    fetchMock.mockResolvedValue(completion());
    await expect(ai.generateText("next")).resolves.toBe("Grounded post");
  });

  it("rejects cancelled work before any provider call", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(ai.generateText("article", { signal: controller.signal })).rejects.toMatchObject({ code: "ai_cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429])("real Gemini SDK preserves HTTP %s and never retries (mock HTTP only)", async status => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: status, message: "sensitive provider body" } }), { status, headers: { "content-type": "application/json" } }));
    await expect(ai.generateText("article")).rejects.toMatchObject({ code: status === 429 ? "ai_quota" : "ai_configuration" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Gemini uses a system instruction and joins visible text, not reasoning", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "private reasoning", thought: true }, { text: "Grounded " }, { text: "post" }] } }] }), { headers: { "content-type": "application/json" } }));
    expect(await ai.generateText("article", { systemPrompt: "trusted rules" })).toBe("Grounded post");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toBe("trusted rules");
    expect(body.contents[0].parts[0].text).toBe("article");
  });
});