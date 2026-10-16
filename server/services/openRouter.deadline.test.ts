import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AILease, AILeaseOptions } from "./aiProviderLimiter";
import type { GenerationOptions, GenerationResult } from "./openRouter";

// Keep the real Gemini SDK, error normalization and lease error class. Only
// admission and HTTP are replaced; importing the real Redis client is forbidden.
const admission = vi.hoisted(() => ({ acquire: vi.fn<typeof import("./aiProviderLimiter").acquireAILease>() }));
const entropy = vi.hoisted(() => ({ jitter: vi.fn(() => 0) }));
vi.mock("node:crypto", async original => ({ ...await original<typeof import("node:crypto")>(), randomInt: entropy.jitter }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("./aiProviderLimiter", async importOriginal => ({
  ...await importOriginal<typeof import("./aiProviderLimiter")>(),
  acquireAILease: admission.acquire,
}));

const NOW = Date.parse("2026-10-01T12:00:00Z");
const MODEL = "gemini-3.1-pro-preview";
const JOB = "719ca12b-420a-4c50-a38c-8e6733ba04a0";
const TENANT = "a1bbfbeb-44e0-423d-9281-d01336fa2171";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROMPT = "private-test-prompt";
const SYSTEM = "private-test-system-instruction";
const KEY = "unit-test-only-not-a-credential";
const RAW_ERROR = "private-sdk-error https://provider.invalid/?key=private-test-key";
const REASONING = "private-test-reasoning";
const http = vi.fn<typeof fetch>();
const release = vi.fn<AILease>();
let ai: typeof import("./openRouter");
let limiter: typeof import("./aiProviderLimiter");
let warn: MockInstance<typeof console.warn>;
let cleanups: Array<() => void>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const gemini = (finishReason = "STOP") => json({
  modelVersion: MODEL,
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 7 },
  candidates: [{ finishReason, content: { parts: [{ thought: true, text: REASONING }, { text: " Grounded post " }] } }],
});
const failure = (status: number) => json({ error: { code: status, message: RAW_ERROR, prompt: PROMPT, apiKey: KEY, tenantId: TENANT } }, status);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function holdTransport(abortAware = false) {
  const transport = deferred<Response>();
  cleanups.push(() => transport.resolve(gemini()));
  http.mockImplementationOnce((_url, options) => {
    if (abortAware) options!.signal!.addEventListener("abort", () => transport.reject(new Error(RAW_ERROR)), { once: true });
    return transport.promise;
  });
  return transport;
}

function holdAdmission() {
  const lease = deferred<AILease>();
  cleanups.push(() => lease.resolve(release));
  admission.acquire.mockReturnValueOnce(lease.promise);
  return lease;
}

function observe(options: GenerationOptions = {}) {
  const fulfilled = vi.fn<(value: GenerationResult) => void>();
  const rejected = vi.fn<(error: unknown) => void>();
  const outcome = ai.generateTextWithMetadata(PROMPT, {
    systemPrompt: SYSTEM, scope: { tenantId: TENANT }, diagnosticContext: { jobId: JOB, stage: "writer" }, ...options,
  }).then(value => { fulfilled(value); return value; }, error => { rejected(error); return ai.getAIErrorResponse(error); });
  return { outcome, fulfilled, rejected };
}

function request(index = 0) {
  const options = http.mock.calls[index]?.[1];
  expect(options !== undefined, "expected an SDK HTTP request").toBe(true);
  expect(options!.signal).toBeInstanceOf(AbortSignal);
  return { headers: new Headers(options!.headers), signal: options!.signal!, body: JSON.parse(String(options!.body)) };
}

function expectRequests(count: number) {
  expect(http).toHaveBeenCalledTimes(count);
  // Do not dump HTTP headers or URLs containing credentials on assertion failure.
  for (const [url] of http.mock.calls) expect(new URL(String(url)).hostname).toBe("generativelanguage.googleapis.com");
}

function leaseOptions(): AILeaseOptions {
  expect(admission.acquire).toHaveBeenCalledTimes(1);
  expect(admission.acquire.mock.calls[0][0]).toBe(TENANT);
  const options = admission.acquire.mock.calls[0][1]!;
  expect(typeof options.onLost).toBe("function");
  return options;
}

function records(): Array<Record<string, unknown>> {
  return warn.mock.calls.map(call => {
    expect(call).toHaveLength(2);
    expect(call[0]).toBe("[ai-provider-failure]");
    const serialized = String(call[1]);
    for (const value of [PROMPT, SYSTEM, KEY, TENANT, RAW_ERROR, REASONING, "private-test-key", "provider.invalid"]) {
      expect(serialized.includes(value), "sensitive fixture data must not reach diagnostics").toBe(false);
    }
    return JSON.parse(serialized);
  });
}

function expectAbortRecord(overrides: Record<string, unknown>) {
  expect(records()).toEqual([{
    provider: "gemini", model: MODEL, code: "ai_timeout", status: null, retryAfterSeconds: null,
    operationId: expect.stringMatching(UUID), jobId: JOB, stage: "writer", elapsedMs: 2000, budgetMs: 2000,
    timeoutOrigin: "operation_deadline", attempt: 1, ...overrides,
  }]);
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  cleanups = [];
  http.mockReset().mockRejectedValue(new Error("Unexpected mocked provider request"));
  release.mockReset();
  admission.acquire.mockReset().mockReturnValue(release);
  entropy.jitter.mockReset().mockReturnValue(0);
  vi.stubGlobal("fetch", http);
  for (const key of ["AI_FALLBACK_PROVIDER", "AI_INTEGRATIONS_GEMINI_API_KEY", "AI_INTEGRATIONS_GEMINI_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_GEMINI_BASE_URL", "GOOGLE_VERTEX_BASE_URL"]) vi.stubEnv(key, "");
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("AI_MAX_CONCURRENT_REQUESTS", "1");
  vi.stubEnv("GEMINI_MODEL", MODEL);
  vi.stubEnv("GEMINI_API_KEY", KEY);
  vi.stubEnv("OPENROUTER_API_KEY", KEY);
  vi.stubEnv("OPENROUTER_BASE_URL", "https://fallback.invalid/api/v1");
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  limiter = await import("./aiProviderLimiter");
  ai = await import("./openRouter");
});

afterEach(async () => {
  // Settle owned promises even after an assertion fails, before restoring spies.
  for (const cleanup of cleanups) cleanup();
  await vi.advanceTimersByTimeAsync(0);
  vi.clearAllTimers(); // The real SDK leaves an unref'ed timeout after success.
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("real Gemini SDK operation deadlines", () => {
  it("rejects a late result even before a delayed deadline timer fires", async () => {
    http.mockImplementationOnce(async () => { vi.setSystemTime(NOW + 90_001); return gemini(); });
    const result = observe({ timeoutMs: 90_000 });
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_timeout")));
    expectAbortRecord({ elapsedMs: 90_001, budgetMs: 90_000 });
    expect(result.fulfilled).not.toHaveBeenCalled();
    expectRequests(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("accepts a 35s-plus Pro response within 90s, sends timeout 90 and LOW/8192, and never falls back", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const transport = holdTransport();
    const result = observe({ timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(0);
    expectRequests(1);
    const sent = request();
    expect(sent.headers.get("X-Server-Timeout")).toBe("90");
    expect(sent.body.generationConfig).toEqual({ temperature: 1, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "LOW" } });
    expect(sent.body.contents[0].parts[0].text).toBe(PROMPT);
    expect(sent.body.systemInstruction.parts[0].text).toBe(SYSTEM);
    expect(leaseOptions().ttlMs).toBe(120_000);
    await vi.advanceTimersByTimeAsync(35_001);
    expect(sent.signal.aborted).toBe(false);
    expect(result.fulfilled).not.toHaveBeenCalled();
    expect(result.rejected).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    transport.resolve(gemini());
    expect(await result.outcome).toEqual({ text: "Grounded post", provider: "gemini", model: MODEL, usage: { inputTokens: 10, outputTokens: 11 }, fallbackUsed: false });
    expect(release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expectRequests(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("retains the default 20s SDK and operation timeout and a 50s lease", async () => {
    holdTransport(true);
    const result = observe();
    await vi.advanceTimersByTimeAsync(0);
    expect(ai.AI_REQUEST_TIMEOUT_MS).toBe(20_000);
    expect(request().headers.get("X-Server-Timeout")).toBe("20");
    expect(leaseOptions().ttlMs).toBe(50_000);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(result.rejected).not.toHaveBeenCalled();
    expect(request().signal.aborted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_timeout")));
    expect(request().signal.aborted).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expectAbortRecord({ elapsedMs: 20_000, budgetMs: 20_000 });
    expectRequests(1);
  });

  it("clamps both SDK and operation deadlines after delayed lease admission without resetting the lease TTL", async () => {
    const lease = holdAdmission();
    holdTransport(true);
    const result = observe({ timeoutMs: 90_000, deadlineAt: NOW + 50_000 });
    expect(leaseOptions().ttlMs).toBe(80_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expectRequests(0);
    lease.resolve(release);
    await vi.advanceTimersByTimeAsync(0);
    expect(request().headers.get("X-Server-Timeout")).toBe("40");
    await vi.advanceTimersByTimeAsync(39_999);
    expect(result.rejected).not.toHaveBeenCalled();
    expect(request().signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_timeout")));
    expect(request().signal.aborted).toBe(true);
    expectAbortRecord({ elapsedMs: 50_000, budgetMs: 40_000 });
    expect(release).toHaveBeenCalledTimes(1);
    expectRequests(1);
  });

  it.each([1000, 90_000, 120_000])("admits the valid %s ms budget with exactly 30s of lease headroom", async timeoutMs => {
    http.mockResolvedValueOnce(gemini());
    expect(await observe({ timeoutMs, deadlineAt: NOW + 240_000 }).outcome).toMatchObject({ provider: "gemini", fallbackUsed: false });
    expect(leaseOptions().ttlMs).toBe(timeoutMs + 30_000);
    expect(request().headers.get("X-Server-Timeout")).toBe(String(timeoutMs / 1000));
    expectRequests(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(["cancelled", "expired"] as const)("releases late admission after an operation is %s, with zero transport dispatch", async mode => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const lease = holdAdmission();
    const controller = new AbortController();
    const result = observe({ timeoutMs: 5000, signal: controller.signal });
    expect(leaseOptions().ttlMs).toBe(35_000);
    const elapsedMs = mode === "cancelled" ? 1000 : 5000;
    await vi.advanceTimersByTimeAsync(elapsedMs);
    if (mode === "cancelled") controller.abort();
    const code = mode === "cancelled" ? "ai_cancelled" : "ai_timeout";
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError(code)));
    expectAbortRecord({ code, model: null, stage: "admission", attempt: null, elapsedMs, budgetMs: 5000, timeoutOrigin: mode === "cancelled" ? "caller_cancel" : "operation_deadline" });
    expect(release).not.toHaveBeenCalled();
    expectRequests(0);
    await expect(ai.generateText("overflow")).rejects.toMatchObject({ code: "ai_busy" });
    expect(admission.acquire).toHaveBeenCalledTimes(1);
    lease.resolve(release);
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledTimes(1);
    expectRequests(0);
    expect(warn).toHaveBeenCalledTimes(1);
    http.mockResolvedValueOnce(gemini());
    expect(await observe().outcome).toMatchObject({ text: "Grounded post", fallbackUsed: false });
    expectRequests(1);
    expect(admission.acquire).toHaveBeenCalledTimes(2);
  });

  it.each([999, 1000])("dispatches after admission only if at least 1000ms remain (%s ms)", async remaining => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const lease = holdAdmission();
    http.mockResolvedValueOnce(gemini());
    const result = observe({ timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000 - remaining);
    lease.resolve(release);
    await vi.advanceTimersByTimeAsync(0);
    if (remaining < 1000) {
      expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_timeout")));
      expectRequests(0);
      expectAbortRecord({ model: null, stage: "admission", attempt: null, elapsedMs: 4001, budgetMs: 5000 });
    } else {
      expect(await result.outcome).toMatchObject({ provider: "gemini", fallbackUsed: false });
      expectRequests(1);
      expect(request().headers.get("X-Server-Timeout")).toBe("1");
    }
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("abort ownership and immediate diagnostics", () => {
  it.each(["cancellation", "caller deadline", "lease loss", "clock deadline"] as const)("prevents dispatch on %s during SDK preprocessing", async mode => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const controller = new AbortController();
    const result = observe({ timeoutMs: 5000, signal: controller.signal });
    // Synchronous admission has entered generateContent, but its first awaited
    // preprocessing step has not resumed to attach the SDK abort listener.
    expectRequests(0);
    if (mode === "cancellation") controller.abort();
    if (mode === "caller deadline") controller.abort(new ai.AIGenerationError("ai_timeout"));
    if (mode === "lease loss") leaseOptions().onLost!(new limiter.AIProviderLimitError("ai_unavailable", 7));
    if (mode === "clock deadline") vi.setSystemTime(NOW + 5000); // no timer callback
    const code = mode === "cancellation" ? "ai_cancelled" : mode === "lease loss" ? "ai_unavailable" : "ai_timeout";
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError(code, mode === "lease loss" ? 7 : undefined)));
    await vi.advanceTimersByTimeAsync(0);
    expectRequests(0);
    expect(release).toHaveBeenCalledTimes(1);
    expectAbortRecord({ code, elapsedMs: mode === "clock deadline" ? 5000 : 0, budgetMs: 5000,
      retryAfterSeconds: mode === "lease loss" ? 7 : null,
      timeoutOrigin: mode === "cancellation" ? "caller_cancel" : mode === "caller deadline" ? "caller_deadline" : mode === "lease loss" ? "lease_lost" : "operation_deadline" });
    expect(result.fulfilled).not.toHaveBeenCalled();
    // SDK rejection settles the lease/slot; a genuinely new request can proceed.
    http.mockResolvedValueOnce(gemini());
    expect(await observe().outcome).toMatchObject({ text: "Grounded post", fallbackUsed: false });
    expectRequests(1);
    expect(release).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("lease loss aborts transport (abort-aware: %s) and cannot trigger retry or fallback", async abortAware => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const transport = holdTransport(abortAware);
    const result = observe({ timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(1500);
    const options = leaseOptions();
    expect(options.ttlMs).toBe(120_000);
    options.onLost!(new limiter.AIProviderLimitError("ai_unavailable", 7));
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_unavailable", 7)));
    expect(request().signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expectAbortRecord({ code: "ai_unavailable", retryAfterSeconds: 7, elapsedMs: 1500, budgetMs: 90_000, timeoutOrigin: "lease_lost" });
    expect(release).toHaveBeenCalledTimes(abortAware ? 1 : 0);
    options.onLost!(new limiter.AIProviderLimitError("ai_unavailable", 7));
    await vi.advanceTimersByTimeAsync(100_000);
    expectRequests(1);
    expect(warn).toHaveBeenCalledTimes(1);
    if (!abortAware) {
      await expect(ai.generateText("overflow")).rejects.toMatchObject({ code: "ai_busy" });
      expect(admission.acquire).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();
      transport.resolve(gemini());
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.fulfilled).not.toHaveBeenCalled();
    expect(result.rejected).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "invalid output", "rejection"] as const)("logs internal timeout immediately once, retaining slot and lease until late %s settles", async late => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const transport = holdTransport();
    const result = observe({ timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(1999);
    expectRequests(1);
    expect(warn).not.toHaveBeenCalled();
    expect(result.rejected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await result.outcome;
    expect(outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_timeout")));
    expectAbortRecord({}); // Assert before the adapter is allowed to settle.
    expect(request().signal.aborted).toBe(true);
    expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(ai.generateText("overflow")).rejects.toMatchObject({ code: "ai_busy" });
    expect(admission.acquire).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expectRequests(1);
    if (late === "rejection") transport.reject(new Error(RAW_ERROR));
    else transport.resolve(gemini(late === "invalid output" ? "MAX_TOKENS" : "STOP"));
    await vi.advanceTimersByTimeAsync(0);
    expectAbortRecord({}); // No duplicate provider failure or invalid-output log.
    expect(release).toHaveBeenCalledTimes(1);
    expect(result.fulfilled).not.toHaveBeenCalled();
    expect(result.rejected).toHaveBeenCalledTimes(1);
    expect(await result.outcome).toBe(outcome);
    http.mockResolvedValueOnce(gemini());
    expect(await observe().outcome).toMatchObject({ provider: "gemini", fallbackUsed: false });
    expectRequests(2);
    expect(admission.acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it.each(["timeout", "cancellation"] as const)("distinguishes caller %s from operation and upstream deadlines", async mode => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    holdTransport(true);
    const controller = new AbortController();
    const result = observe({ timeoutMs: 90_000, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(4321);
    controller.abort(mode === "timeout" ? new ai.AIGenerationError("ai_timeout") : new Error(RAW_ERROR));
    const code = mode === "timeout" ? "ai_timeout" : "ai_cancelled";
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError(code)));
    await vi.advanceTimersByTimeAsync(0);
    expectAbortRecord({ code, elapsedMs: 4321, budgetMs: 90_000, timeoutOrigin: mode === "timeout" ? "caller_deadline" : "caller_cancel" });
    expect(request().signal.aborted).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expectRequests(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("confirmed rejection is the only replayable transport outcome", () => {
  it.each([
    { jitter: 0 }, { jitter: 125 }, { jitter: 250 },
  ])("retries an explicit 503 exactly once after 1000ms plus $jitter ms, with a shrinking budget", async ({ jitter }) => {
    entropy.jitter.mockReturnValue(jitter);
    const first = holdTransport();
    http.mockResolvedValueOnce(failure(503));
    const result = observe({ timeoutMs: 90_000, deadlineAt: NOW + 10_000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(request().headers.get("X-Server-Timeout")).toBe("10");
    expect(leaseOptions().ttlMs).toBe(40_000);
    first.resolve(failure(503));
    await vi.advanceTimersByTimeAsync(0);
    expectRequests(1);
    expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000 + jitter - 1);
    expectRequests(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_unavailable")));
    expectRequests(2);
    const remaining = 4000 - jitter;
    expect(request(1).headers.get("X-Server-Timeout")).toBe(String(Math.ceil(remaining / 1000)));
    const logged = records();
    expect(logged).toEqual([
      { provider: "gemini", model: MODEL, code: "ai_unavailable", status: 503, retryAfterSeconds: null, operationId: expect.stringMatching(UUID), jobId: JOB, stage: "writer", elapsedMs: 5000, budgetMs: 10_000, timeoutOrigin: null, attempt: 1 },
      { provider: "gemini", model: MODEL, code: "ai_unavailable", status: 503, retryAfterSeconds: null, operationId: logged[0].operationId, jobId: JOB, stage: "writer", elapsedMs: 6000 + jitter, budgetMs: remaining, timeoutOrigin: null, attempt: 2 },
    ]);
    expect(admission.acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expectRequests(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("allows a successful explicit-503 retry without taking the configured fallback", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    entropy.jitter.mockReturnValue(0);
    http.mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(gemini());
    const result = observe({ timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result.outcome).toMatchObject({ text: "Grounded post", provider: "gemini", fallbackUsed: false });
    expect(request(1).headers.get("X-Server-Timeout")).toBe("4");
    expectRequests(2);
    expect(records()).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not reset the absolute deadline on the retry or start fallback after it expires", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    entropy.jitter.mockReturnValue(0);
    http.mockResolvedValueOnce(failure(503));
    holdTransport(true);
    const result = observe({ timeoutMs: 90_000, deadlineAt: NOW + 5000 });
    await vi.advanceTimersByTimeAsync(1000);
    expectRequests(2);
    expect(request(1).headers.get("X-Server-Timeout")).toBe("4");
    await vi.advanceTimersByTimeAsync(3999);
    expect(result.rejected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_timeout")));
    expect(request(1).signal.aborted).toBe(true);
    const logged = records();
    expect(logged).toHaveLength(2);
    expect(logged[1]).toEqual({ provider: "gemini", model: MODEL, code: "ai_timeout", status: null, retryAfterSeconds: null, operationId: logged[0].operationId, jobId: JOB, stage: "writer", elapsedMs: 5000, budgetMs: 4000, timeoutOrigin: "operation_deadline", attempt: 2 });
    await vi.advanceTimersByTimeAsync(90_000);
    expectRequests(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([999, 1000])("dispatches a retry only if at least 1000ms remain after jitter (%s ms)", async remaining => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    entropy.jitter.mockReturnValue(250);
    http.mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(gemini());
    const result = observe({ timeoutMs: 1250 + remaining });
    await vi.advanceTimersByTimeAsync(1249);
    expectRequests(1);
    await vi.advanceTimersByTimeAsync(1);
    if (remaining < 1000) {
      expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError("ai_timeout")));
      expectRequests(1);
    } else {
      expect(await result.outcome).toMatchObject({ provider: "gemini", fallbackUsed: false });
      expectRequests(2);
      expect(request(1).headers.get("X-Server-Timeout")).toBe("1");
    }
    expect(release).toHaveBeenCalledTimes(1);
    expect(admission.acquire).toHaveBeenCalledTimes(1);
  });

  it.each(["network", 500, 502, 408, 504] as const)("never retries or falls back for ambiguous %s even with an explicit fallback", async status => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "openrouter");
    const transport = holdTransport();
    const result = observe({ timeoutMs: 90_000, diagnosticContext: { jobId: JOB, stage: "repair" } });
    await vi.advanceTimersByTimeAsync(2500);
    if (status === "network") transport.reject(new Error(RAW_ERROR));
    else transport.resolve(failure(status));
    const timeout = status === 408 || status === 504;
    const code = timeout ? "ai_timeout" : "ai_unavailable";
    expect(await result.outcome).toEqual(ai.getAIErrorResponse(new ai.AIGenerationError(code)));
    expectAbortRecord({ code, status: status === "network" ? null : status, stage: "repair", elapsedMs: 2500, budgetMs: 90_000, timeoutOrigin: timeout ? "upstream_timeout" : null });
    expect(request().signal.aborted).toBe(false); // An upstream 504 is not a local abort.
    expect(release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expectRequests(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(admission.acquire).toHaveBeenCalledTimes(1);
  });
});

describe("deadline validation before admission", () => {
  it.each([0, -1, 999, 120_001, 1000.5, NaN, Infinity, -Infinity, null, "90000"])("rejects invalid timeout configuration %#", async timeoutMs => {
    await expect(ai.generateText(PROMPT, { timeoutMs } as unknown as GenerationOptions)).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(admission.acquire).not.toHaveBeenCalled();
    expectRequests(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([0, -1, NOW + 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, null, "90000"])("rejects invalid absolute deadline configuration %#", async deadlineAt => {
    await expect(ai.generateText(PROMPT, { deadlineAt } as unknown as GenerationOptions)).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(admission.acquire).not.toHaveBeenCalled();
    expectRequests(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([-1, 0, 999])("rejects an already exhausted %s ms deadline before admission", async remaining => {
    await expect(ai.generateText(PROMPT, { timeoutMs: 90_000, deadlineAt: NOW + remaining })).rejects.toMatchObject({ code: "ai_timeout" });
    expect(admission.acquire).not.toHaveBeenCalled();
    expectRequests(0);
    expect(release).not.toHaveBeenCalled();
  });
});