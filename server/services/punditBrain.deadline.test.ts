import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyEditorialVoice } from "@shared/editorial-voice";
import * as editorialClaims from "@shared/editorial-claims";
import { AIGenerationError, type GenerationResult } from "./openRouter";
const { provider, getVoice } = vi.hoisted(() => ({ provider: vi.fn(), getVoice: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../db", () => { throw new Error("Database access forbidden in writer deadline tests"); });
vi.mock("../repositories/editorialVoice", () => ({ editorialVoiceRepository: { get: getVoice } }));
vi.mock("./openRouter", async original => ({ ...await original<typeof import("./openRouter")>(), generateTextWithMetadata: provider }));
import { EDITORIAL_CLEANUP_HEADROOM_MS, EDITORIAL_PROVIDER_TIMEOUT_MS,
  generatePlatformReviewsDetailed, generatePostContentDetailed, type EditorialOptions } from "./punditBrain";

const start = Date.parse("2026-10-01T00:00:00Z");
const jobId = "00000000-0000-4000-8000-000000000001";
const sentence = "Desk reports a trial in thirty stores.";
const article = { headline: "Trial", summary: sentence, source: "Desk", articleUrl: "" };
const fetched = { title: article.headline, content: article.summary, source: article.source, url: "" };
const voiceScope = { tenantId: "trusted-tenant", userId: "trusted-user" };
const reply = (text = JSON.stringify({ segments: [{ text: sentence, excerptIds: ["p1"] }] })): GenerationResult => ({
  text, provider: "gemini", model: "mock-model", usage: { inputTokens: 1, outputTokens: 1 }, fallbackUsed: false,
});

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(start);
  provider.mockReset().mockResolvedValue(reply());
  getVoice.mockReset().mockResolvedValue(emptyEditorialVoice());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("one shared editorial writer deadline (mocked providers only)", () => {
  it("gives queued writers a provisional 90s provider budget and accepts a result beyond 20s", async () => {
    expect(EDITORIAL_PROVIDER_TIMEOUT_MS).toBe(90_000);
    expect(EDITORIAL_CLEANUP_HEADROOM_MS).toBe(5_000);
    provider.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(reply()), 35_000)));
    const generation = generatePostContentDetailed(article, "linkedin", "professional", { timeoutMs: 240_000, deadlineAt: start + 300_000, jobId });
    expect(provider.mock.calls[0][1]).toMatchObject({ timeoutMs: 90_000, deadlineAt: start + 235_000, diagnosticContext: { jobId, stage: "writer" } });
    expect(provider.mock.calls[0][0]).not.toContain(jobId);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(provider.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(14_999);
    await expect(generation).resolves.toMatchObject({ content: sentence });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "direct default", options: {}, budget: 55_000 },
    { label: "earlier server deadline", options: { timeoutMs: 240_000, deadlineAt: start + 42_000 }, budget: 37_000 },
    { label: "later server deadline cannot renew direct default", options: { deadlineAt: start + 300_000 }, budget: 55_000 },
    { label: "exact provider minimum", options: { timeoutMs: 6_000 }, budget: 1_000 },
  ])("reserves cleanup headroom for $label", async ({ options, budget }) => {
    await generatePostContentDetailed(article, "linkedin", "professional", options);
    expect(provider.mock.calls[0][1]).toMatchObject({ timeoutMs: budget, deadlineAt: start + budget, diagnosticContext: { stage: "writer" } });
  });

  it.each([start - 1, start, start + 5_999])("does not invoke a provider with insufficient deadline %s", async deadlineAt => {
    await expect(generatePostContentDetailed(article, "linkedin", "professional", { deadlineAt, voiceScope })).rejects.toMatchObject({ code: "ai_timeout" });
    expect(provider).not.toHaveBeenCalled(); expect(getVoice).not.toHaveBeenCalled();
  });

  it("keeps the direct overall timer at 60s even if a provider ignores its smaller cap", async () => {
    provider.mockImplementationOnce((_prompt, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const generation = generatePostContentDetailed(article, "linkedin", "professional");
    const assertion = expect(generation).rejects.toMatchObject({ code: "ai_timeout" });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(provider.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await assertion;
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 0, 1])("checks claim-support completion at deadline offset %i without repair", async offset => {
    const deadlineAt = start + 20_000;
    const baseline = editorialClaims.checkClaimSupport;
    const checkClaims = vi.spyOn(editorialClaims, "checkClaimSupport").mockImplementationOnce((...args) => {
      const report = baseline(...args);
      vi.setSystemTime(deadlineAt + offset);
      // Moving wall time alone must not run the deadline timer.
      expect(provider.mock.calls[0][1].signal.aborted).toBe(false);
      return report;
    });
    const generation = generatePostContentDetailed(article, "linkedin", "professional", { deadlineAt });
    if (offset < 0) {
      const result = await generation;
      expect(result.content).toBe(sentence);
      expect(result.attributions).toEqual([{ text: sentence, excerptIds: ["p1"] }]);
      expect(result.claimSupport).toBe(checkClaims.mock.results[0].value);
      expect(result.validation).toEqual({ structural: "passed", attributionMapping: "passed", factualVerification: "not-performed", requiresHumanReview: true });
    } else await expect(generation).rejects.toMatchObject({ code: "ai_timeout" });
    expect(checkClaims).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][1].diagnosticContext.stage).toBe("writer");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("prioritizes claim-support cancellation over an elapsed deadline without repair", async () => {
    const deadlineAt = start + 20_000;
    const controller = new AbortController();
    const reason = new AIGenerationError("ai_cancelled");
    const baseline = editorialClaims.checkClaimSupport;
    const checkClaims = vi.spyOn(editorialClaims, "checkClaimSupport").mockImplementationOnce((...args) => {
      const report = baseline(...args);
      vi.setSystemTime(deadlineAt + 1);
      expect(provider.mock.calls[0][1].signal.aborted).toBe(false);
      controller.abort(reason);
      return report;
    });
    await expect(generatePostContentDetailed(article, "linkedin", "professional", { deadlineAt, signal: controller.signal })).rejects.toBe(reason);
    expect(checkClaims).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([0, 1])("rejects a final progress callback returning at deadline offset %i without replay", async offset => {
    const deadlineAt = start + 20_000;
    let completed = 0;
    const onPlatformComplete = vi.fn(async () => {
      if (++completed === 2) {
        vi.setSystemTime(deadlineAt + offset);
        expect(provider.mock.calls[0][1].signal.aborted).toBe(false);
      }
    });
    await expect(generatePlatformReviewsDetailed(fetched, ["linkedin", "medium"], { deadlineAt, tones: ["thoughtLeader"], onPlatformComplete }))
      .rejects.toMatchObject({ code: "ai_timeout" });
    expect(onPlatformComplete.mock.calls).toEqual([["linkedin"], ["medium"]]);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls.every(([, options]) => options.diagnosticContext.stage === "writer")).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(["default", "typed"] as const)("prioritizes %s cancellation in the last progress callback over an elapsed deadline without replay", async kind => {
    const deadlineAt = start + 20_000;
    const controller = new AbortController();
    const reason = kind === "typed" ? new AIGenerationError("ai_quota") : undefined;
    let completed = 0;
    const onPlatformComplete = vi.fn(async () => {
      if (++completed === 2) {
        vi.setSystemTime(deadlineAt + 1);
        expect(provider.mock.calls[0][1].signal.aborted).toBe(false);
        controller.abort(reason);
      }
    });
    const generation = generatePlatformReviewsDetailed(fetched, ["linkedin", "medium"], {
      deadlineAt, tones: ["thoughtLeader"], signal: controller.signal, onPlatformComplete,
    });
    if (reason) await expect(generation).rejects.toBe(reason);
    else await expect(generation).rejects.toMatchObject({ code: "ai_cancelled" });
    expect(onPlatformComplete.mock.calls).toEqual([["linkedin"], ["medium"]]);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("preserves the original sibling callback failure when a pending callback resumes after the deadline", async () => {
    const deadlineAt = start + 20_000;
    const failure = new Error("Progress callback failed");
    const onPlatformComplete = vi.fn(async platform => {
      if (platform === "linkedin") {
        // Resume only when the sibling failure aborts the batch, not on a timer.
        await new Promise<void>(resolve => provider.mock.calls[0][1].signal.addEventListener("abort", () => resolve(), { once: true }));
      } else {
        vi.setSystemTime(deadlineAt + 1);
        throw failure;
      }
    });
    await expect(generatePlatformReviewsDetailed(fetched, ["linkedin", "medium"], { deadlineAt, tones: ["thoughtLeader"], onPlatformComplete }))
      .rejects.toBe(failure);
    expect(onPlatformComplete.mock.calls).toEqual([["linkedin"], ["medium"]]);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls.every(([, options]) => options.signal.reason === failure)).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("subtracts initial writer time from the single repair budget without renewing its deadline", async () => {
    provider.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(reply("malformed")), 35_000)))
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(reply()), 10_000)));
    const generation = generatePostContentDetailed(article, "linkedin", "professional", { jobId });
    await vi.advanceTimersByTimeAsync(35_000);
    expect(provider.mock.calls.map(([, options]) => ({ timeoutMs: options.timeoutMs, deadlineAt: options.deadlineAt, diagnosticContext: options.diagnosticContext }))).toEqual([
      { timeoutMs: 55_000, deadlineAt: start + 55_000, diagnosticContext: { jobId, stage: "writer" } },
      { timeoutMs: 20_000, deadlineAt: start + 55_000, diagnosticContext: { jobId, stage: "repair" } },
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(generation).resolves.toMatchObject({ content: sentence, generation: { attempts: [expect.any(Object), expect.any(Object)] } });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("does not spend a repair when cleanup leaves less than the provider minimum", async () => {
    provider.mockImplementationOnce(async () => { vi.setSystemTime(start + 54_001); return reply("malformed"); });
    await expect(generatePostContentDetailed(article, "linkedin", "professional")).rejects.toMatchObject({ code: "ai_timeout" });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("does not reset the shared deadline for later platforms or tones", async () => {
    let call = 0;
    provider.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(reply()), ++call <= 2 ? 60_000 : 30_000)));
    const generation = generatePlatformReviewsDetailed(fetched, ["linkedin", "medium"], { timeoutMs: 120_000, tones: ["thoughtLeader", "dataDriven"], jobId });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.mock.calls.map(([, options]) => options.timeoutMs)).toEqual([90_000, 90_000, 55_000, 55_000]);
    expect(provider.mock.calls.every(([, options]) => options.deadlineAt === start + 115_000 && options.diagnosticContext.stage === "writer")).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(generation).resolves.toHaveProperty("posts.medium.dataDriven", sentence);
    expect(provider).toHaveBeenCalledTimes(4);
  });

  it.each(["single", "batch"] as const)("never dispatches a %s writer after cancellation or deadline during voice loading", async kind => {
    for (const interruption of ["cancel", "headroom", "deadline"] as const) {
      vi.setSystemTime(start); provider.mockClear(); getVoice.mockClear();
      let finishVoice!: (value: ReturnType<typeof emptyEditorialVoice>) => void;
      const pendingVoice = new Promise<ReturnType<typeof emptyEditorialVoice>>(resolve => { finishVoice = resolve; });
      getVoice.mockReturnValue(pendingVoice);
      const controller = new AbortController();
      const options = { signal: controller.signal, deadlineAt: start + 20_000, voiceScope };
      const generation = kind === "single" ? generatePostContentDetailed(article, "linkedin", "professional", options)
        : generatePlatformReviewsDetailed(fetched, ["linkedin"], options);
      const assertion = expect(generation).rejects.toMatchObject({ code: interruption === "cancel" ? "ai_cancelled" : "ai_timeout" });
      expect(getVoice).toHaveBeenCalledTimes(kind === "single" ? 1 : 2);
      if (interruption === "cancel") controller.abort();
      else await vi.advanceTimersByTimeAsync(interruption === "headroom" ? 14_001 : 20_000);
      finishVoice(emptyEditorialVoice()); await assertion;
      expect(provider).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("deducts both voice reloads and stops a cancelled repair before transport", async () => {
    const controller = new AbortController();
    getVoice.mockImplementationOnce(async () => { vi.setSystemTime(start + 10_000); return emptyEditorialVoice(); })
      .mockImplementationOnce(async () => { controller.abort(); return emptyEditorialVoice(); });
    provider.mockResolvedValueOnce(reply("malformed"));
    await expect(generatePostContentDetailed(article, "linkedin", "professional", { voiceScope, signal: controller.signal })).rejects.toMatchObject({ code: "ai_cancelled" });
    expect(getVoice).toHaveBeenCalledTimes(2); expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][1]).toMatchObject({ timeoutMs: 45_000, deadlineAt: start + 55_000 });
  });

  it.each([
    { deadlineAt: NaN }, { deadlineAt: Infinity }, { deadlineAt: -1 }, { deadlineAt: 1.5 },
    { deadlineAt: Number.MAX_SAFE_INTEGER + 1 }, { deadlineAt: "later" },
    { jobId: "PRIVATE user input" }, { jobId: 42 }, { timeoutMs: 240_001 },
  ])("validates trusted writer controls before any I/O (%j)", async options => {
    await expect(generatePostContentDetailed(article, "linkedin", "professional", options as EditorialOptions)).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(provider).not.toHaveBeenCalled(); expect(getVoice).not.toHaveBeenCalled();
  });
});