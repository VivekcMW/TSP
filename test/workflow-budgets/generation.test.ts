import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformKey } from "../../server/services/punditBrain";
import { metric } from "./metrics";

vi.mock("../../server/lib/redis", () => ({ redis: undefined }));
vi.mock("../../server/repositories/editorialVoice", () => ({ editorialVoiceRepository: { get: () => { throw new Error("Unexpected voice lookup"); } } }));
const article = { title: "Pilot result", content: "The pilot reduced latency by 12% in a trial of 30 stores.", source: "Research Desk", url: "https://news.test/pilot" };
const post = "Research Desk reports 12% lower latency in a 30-store trial. https://news.test/pilot";
const platforms: PlatformKey[] = ["twitter", "linkedin", "reddit", "medium"];
let brain: typeof import("../../server/services/punditBrain");
let calls: number, active: number, peak: number, requestedOutputTokens: number, reportedOutputTokens: number;
let mode: "normal" | "repair" | "repair-fallback" | "slow" | "quota" | "unknown";

beforeEach(async () => {
  vi.resetModules();
  calls = active = peak = requestedOutputTokens = reportedOutputTokens = 0;
  mode = "normal";
  vi.stubEnv("AI_PROVIDER", "openrouter"); vi.stubEnv("OPENROUTER_API_KEY", "mock-only-not-a-credential");
  vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
  vi.stubEnv("AI_FALLBACK_PROVIDER", ""); vi.stubEnv("AI_TENANT_REQUEST_BUDGET", "");
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    calls++; active++; peak = Math.max(peak, active); requestedOutputTokens += body.max_tokens;
    try {
      if (mode === "slow") await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(options.signal?.reason); };
        const timer = setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); }, 19_000);
        options.signal?.addEventListener("abort", abort, { once: true });
      });
      else await Promise.resolve();
      if (mode === "quota") return new Response("", { status: 429 });
      if (mode === "repair-fallback" && String(_url).includes("openrouter.ai")) return new Response("", { status: 503 });
      const prompt = JSON.parse(body.messages.at(-1).content);
      const needsRepair = ["repair", "repair-fallback"].includes(mode) && !prompt.repair;
      const content = needsRepair ? "{" : JSON.stringify({ segments: [{ text: post, excerptIds: ["p1"] }] });
      if (mode !== "unknown") reportedOutputTokens += 7;
      return new Response(JSON.stringify({ model: "mock-model", choices: [{ finish_reason: "stop", message: { content } }],
        ...(mode === "unknown" ? {} : { usage: { prompt_tokens: 11, completion_tokens: 7 } }) }), { status: 200 });
    } finally { active--; }
  }));
  brain = await import("../../server/services/punditBrain");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function report(scenario: string, extra: Record<string, unknown> = {}) {
  metric(scenario, { providerCalls: calls, peakProviderCalls: peak, requestedOutputTokenCeilings: requestedOutputTokens,
    mockReportedOutputTokens: reportedOutputTokens, dollarCostVerified: false, ...extra });
}

it("accounts for all 16 writer calls plus exactly one repair each through the real adapter", async () => {
  mode = "repair";
  const result = await brain.generatePlatformReviewsDetailed(article, platforms);
  expect(calls).toBe(32); expect(peak).toBe(2);
  expect(requestedOutputTokens).toBe(32 * 2048);
  expect(result.usage).toEqual({ inputTokens: 32 * 11, outputTokens: 32 * 7 });
  expect(Object.values(result.details).flatMap(value => Object.values(value)).every(value => value.generation.attempts.length === 2)).toBe(true);
  report("generation-max-repair", { posts: 16, aggregateUsage: result.usage });
});

it("counts failed primary transports as well as fallback and repair calls, without inventing their token usage", async () => {
  mode = "repair-fallback"; vi.useFakeTimers();
  vi.stubEnv("AI_FALLBACK_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "mock-only-not-a-credential");
  const pending = brain.generatePlatformReviewsDetailed(article, platforms);
  // Each explicit 503 gets one 1–1.25s retry before the configured fallback.
  await vi.advanceTimersByTimeAsync(30_000);
  const result = await pending;
  // 32 writer calls (16 posts + one repair each) x (primary + transient retry + fallback).
  expect(calls).toBe(96); expect(peak).toBe(2);
  expect(requestedOutputTokens).toBe(96 * 2048);
  expect(result.fallbackUsed).toBe(true);
  expect(result.usage.outputTokens).toBe(224);
  report("generation-repair-with-fallback", { posts: 16, failedPrimaryCalls: 64,
    failedPrimaryUsage: null, aggregateUsage: result.usage });
});

it("deduplicates the selected platform work before spending provider tokens", async () => {
  const result = await brain.generatePlatformReviewsDetailed(article, ["twitter", "twitter", "linkedin", "linkedin"]);
  expect(calls).toBe(8); expect(peak).toBe(2);
  expect(result.usage.outputTokens).toBe(56);
  report("generation-duplicate-platforms", { posts: 8 });
});

it("reserves cleanup headroom before the overall deadline and starts no late repairs or queued tones", async () => {
  mode = "slow"; vi.useFakeTimers();
  const settled = vi.fn();
  const outcome = brain.generatePlatformReviewsDetailed(article, platforms).catch(error => { settled(); return error; });
  const providerDeadline = 60_000 - brain.EDITORIAL_CLEANUP_HEADROOM_MS;
  await vi.advanceTimersByTimeAsync(providerDeadline - 1);
  expect(settled).not.toHaveBeenCalled();
  expect(calls).toBe(6); expect(active).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(await outcome).toMatchObject({ code: "ai_timeout" });
  // Two waves complete at 19s/38s. The third cannot finish its 19s response
  // before the 55s provider deadline; no fourth wave is ever dispatched.
  expect(calls).toBe(6); expect(active).toBe(0); expect(peak).toBe(2);
  expect(reportedOutputTokens).toBe(28);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toBe(6); expect(vi.getTimerCount()).toBe(0);
  report("generation-deadline", { fakeClockDeadlineMs: 60_000, providerDeadlineMs: providerDeadline,
    cleanupHeadroomMs: brain.EDITORIAL_CLEANUP_HEADROOM_MS, partialResultReturned: false });
});

it("stops a quota-failed batch at two started calls and makes no cooldown retry calls", async () => {
  mode = "quota";
  await expect(brain.generatePlatformReviewsDetailed(article, platforms)).rejects.toMatchObject({ code: "ai_quota" });
  expect(calls).toBe(2);
  await expect(brain.generatePlatformReviewsDetailed(article, platforms)).rejects.toMatchObject({ code: "ai_quota" });
  expect(calls).toBe(2); expect(active).toBe(0);
  report("generation-quota", { additionalCooldownCalls: 0 });
});

it("does not turn unreported provider tokens into verified zero usage", async () => {
  mode = "unknown";
  const result = await brain.generatePlatformReviewsDetailed(article, ["twitter"]);
  expect(calls).toBe(4); expect(result.usage).toEqual({ inputTokens: null, outputTokens: null });
  report("generation-unreported-usage", { mockReportedOutputTokens: null, aggregateUsage: result.usage });
});