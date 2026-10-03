import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
const { find, fetcher, generate, context } = vi.hoisted(() => ({ find: vi.fn(), fetcher: vi.fn(), generate: vi.fn(), context: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("../db", () => { throw new Error("Database access forbidden in request deadline tests"); });
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../middlewares/requireDbUser", () => ({ authedOf: () => ({ tenant: { tenantId: "trusted-tenant", userId: "trusted-user" } }) }));
vi.mock("../routes/editorial-context", async original => ({ ...await original<typeof import("../routes/editorial-context")>(), editorialContext: context }));
vi.mock("./punditBrain", () => ({ generatePlatformReviewsDetailed: generate }));
vi.mock("./urlFetcher", () => ({ fetchArticleFromUrl: fetcher }));
vi.mock("./articlePool", () => ({ findPooledArticle: find }));
vi.mock("./keywordSearch", () => ({ isGoogleNewsArticleUrl: () => false, resolveGoogleNewsArticleUrl: vi.fn() }));
import { executeEditorialRequest, prepareEditorialRequest, type EditorialExecutionContext, type PreparedEditorialRequest } from "./editorial-request";

const start = Date.parse("2026-10-01T00:00:00Z");
const jobId = "00000000-0000-4000-8000-000000000001";
const attackerId = "00000000-0000-4000-8000-000000000099";
const article = { title: "Trial", content: "Desk reports a trial in thirty stores.", source: "Desk", url: "https://publisher.test/trial", domain: "publisher.test" };
const prepared: PreparedEditorialRequest = { input: { url: article.url, selectedPlatforms: ["linkedin"], format: "short-post" }, options: {} };
const signal = new AbortController().signal;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(start); vi.resetAllMocks();
  find.mockResolvedValue(null); fetcher.mockResolvedValue(article); generate.mockResolvedValue({ posts: {} });
  context.mockResolvedValue({ voice: "Saved voice", scope: { tenantId: "trusted-tenant" }, voiceScope: { tenantId: "trusted-tenant", userId: "trusted-user" } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("trusted execution deadlines across source fetch (no I/O)", () => {
  it.each([undefined, start + 200_000])("deducts both index lookup and fetch from the execution budget (%s)", async deadlineAt => {
    find.mockImplementationOnce(async () => { vi.setSystemTime(start + 10_000); return null; });
    fetcher.mockImplementationOnce(async () => { vi.setSystemTime(start + 30_000); return article; });
    const progress = vi.fn();
    await executeEditorialRequest(prepared, signal, progress, 240_000, { deadlineAt, jobId });
    const effectiveDeadline = deadlineAt ?? start + 240_000;
    expect(generate.mock.calls[0][2]).toMatchObject({ timeoutMs: effectiveDeadline - start - 30_000, deadlineAt: effectiveDeadline, jobId, onPlatformComplete: progress, signal });
  });

  it("retains the direct 60s-after-fetch default by omitting an execution budget", async () => {
    fetcher.mockImplementationOnce(async () => { vi.setSystemTime(start + 45_000); return article; });
    await executeEditorialRequest(prepared, signal);
    for (const field of ["timeoutMs", "deadlineAt", "jobId"]) expect(generate.mock.calls[0][2]).not.toHaveProperty(field);
  });

  it("passes a deadline-only context unchanged instead of renewing it after fetch", async () => {
    fetcher.mockImplementationOnce(async () => { vi.setSystemTime(start + 15_000); return article; });
    await executeEditorialRequest(prepared, signal, undefined, undefined, { deadlineAt: start + 30_000, jobId });
    expect(generate.mock.calls[0][2]).toMatchObject({ deadlineAt: start + 30_000, jobId });
    expect(generate.mock.calls[0][2]).not.toHaveProperty("timeoutMs");
  });

  it.each(["relative", "absolute"])("does not start writers when the %s budget expires during fetch", async kind => {
    fetcher.mockImplementationOnce(async () => { vi.setSystemTime(start + 30_000); return article; });
    await expect(executeEditorialRequest(prepared, signal, undefined, kind === "relative" ? 30_000 : undefined,
      kind === "absolute" ? { deadlineAt: start + 30_000 } : {})).rejects.toMatchObject({ code: "ai_timeout" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not start writers after cancellation during fetch", async () => {
    const controller = new AbortController();
    fetcher.mockImplementationOnce(async () => { controller.abort(); return article; });
    await expect(executeEditorialRequest(prepared, controller.signal, undefined, 240_000)).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects already-expired execution before even looking up the source", async () => {
    await expect(executeEditorialRequest(prepared, signal, undefined, undefined, { deadlineAt: start })).rejects.toMatchObject({ code: "ai_timeout" });
    expect(find).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });

  it.each([{}, { deadlineAt: start + 120_000, jobId }])("ignores arbitrary persisted execution preferences and accepts only server context %j", async trusted => {
    const injected = { ...prepared, input: { ...prepared.input, jobId: attackerId, deadlineAt: start + 1, timeoutMs: 1 },
      options: { voice: "Saved voice", jobId: attackerId, deadlineAt: start + 1, timeoutMs: 1, diagnosticContext: { jobId: attackerId, stage: "repair" } } };
    await executeEditorialRequest(injected, signal, undefined, undefined, trusted);
    const options = generate.mock.calls[0][2];
    expect(options.voice).toBe("Saved voice");
    expect(options).not.toHaveProperty("timeoutMs"); expect(options).not.toHaveProperty("diagnosticContext");
    expect(options.jobId).toBe(trusted.jobId); expect(options.deadlineAt).toBe(trusted.deadlineAt);
    expect(JSON.stringify(options)).not.toContain(attackerId);
  });

  it.each(["manual", "selected"] as const)("never prepares budget, deadline, or job ID from a %s request body", async kind => {
    const controls = { timeoutMs: 240_000, deadlineAt: start + 300_000, jobId: attackerId, diagnosticContext: { jobId: attackerId } };
    const body = { ...controls, url: article.url, title: article.title, content: article.content, selectedPlatforms: ["linkedin"], options: controls };
    const result = await prepareEditorialRequest({ body } as Request, kind, signal);
    for (const field of Object.keys(controls)) {
      expect(result.input).not.toHaveProperty(field); expect(result.options).not.toHaveProperty(field);
    }
    expect(result.input).not.toHaveProperty("options");
    expect(result.options).toMatchObject({ scope: { tenantId: "trusted-tenant" }, voice: "Saved voice" });
  });

  it("keeps prepared options allowlisted even if server preference assembly grows new fields", async () => {
    context.mockResolvedValue({ voice: "Saved voice", timeoutMs: 240_000, deadlineAt: start + 300_000, jobId, signal });
    const result = await prepareEditorialRequest({ body: prepared.input } as Request, "selected", signal);
    expect(Object.keys(result.options).sort()).toEqual(["format", "scope", "userContext", "voice", "voiceScope"]);
  });

  it.each([{ deadlineAt: Infinity }, { deadlineAt: NaN }, { deadlineAt: -1 }, { deadlineAt: 1.5 },
    { deadlineAt: Number.MAX_SAFE_INTEGER + 1 }, { deadlineAt: "later" }, { jobId: "PRIVATE" }])("rejects malformed trusted context before fetch (%j)", async trusted => {
    await expect(executeEditorialRequest(prepared, signal, undefined, undefined, trusted as EditorialExecutionContext)).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(find).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity, 240_001])("rejects invalid trusted relative budget %s before fetch", async timeoutMs => {
    await expect(executeEditorialRequest(prepared, signal, undefined, timeoutMs)).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(find).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
});