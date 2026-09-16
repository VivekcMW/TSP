import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./queryClient", async original => ({ ...await original<typeof import("./queryClient")>(), apiRequest: request }));
import { cancelEditorialRequest, createEditorialRequestState, editorialRequest } from "./editorial-request";
import { ApiError } from "./queryClient";

const id = "00000000-0000-4000-8000-000000000001";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("editorial request transport", () => {
  it("preserves numeric and HTTP-date Retry-After metadata at the real fetch boundary", async () => {
    const { apiRequest } = await vi.importActual<typeof import("./queryClient")>("./queryClient");
    vi.setSystemTime(new Date("2026-09-17T12:00:00Z"));
    for (const [header, expected] of [["3", 3000], ["Thu, 17 Sep 2026 12:00:07 GMT", 7000], ["invalid", undefined]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Temporary outage" }), { status: 503, headers: { "Retry-After": header } })));
      await expect(apiRequest("GET", "/api/editorial/jobs/example")).rejects.toMatchObject({ status: 503, retryAfterMs: expected });
    }
  });

  it("keeps direct single-post routes and local no-Redis results compatible", async () => {
    request.mockResolvedValueOnce(response({ content: "post" }));
    expect(await editorialRequest("/api/ai/generate-post", {})).toEqual({ content: "post" });
    expect(request.mock.calls[0][1]).toBe("/api/ai/generate-post");
    request.mockResolvedValueOnce(response({ posts: {} }));
    expect(await editorialRequest("/api/instant-review/selected", {})).toEqual({ posts: {} });
    expect(request.mock.calls[1][3].headers.Prefer).toBe("respond-async");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("polls progress, forwards tenant headers, and returns only the completed result", async () => {
    const onProgress = vi.fn();
    request.mockResolvedValueOnce(response({ jobId: id }, 202))
      .mockResolvedValueOnce(response({ status: "active", progress: { platformsCompleted: 1, platformsTotal: 2 } }))
      .mockResolvedValueOnce(response({ status: "completed", progress: { platformsCompleted: 2, platformsTotal: 2 } }))
      .mockResolvedValueOnce(response({ posts: { linkedin: "done" } }));
    const result = editorialRequest("/api/instant-review/manual", {}, { headers: { "x-tenant-id": "tenant-a" }, onProgress });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ posts: { linkedin: "done" } });
    expect(onProgress).toHaveBeenNthCalledWith(1, { platformsCompleted: 1, platformsTotal: 2 });
    expect(request.mock.calls.map(call => call[0])).toEqual(["POST", "GET", "GET", "GET"]);
    expect(request.mock.calls.at(-1)?.[1]).toBe(`/api/editorial/jobs/${id}/result`);
    for (const call of request.mock.calls) expect(call[3].headers["x-tenant-id"]).toBe("tenant-a");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends exactly one scoped cancellation with an independent non-aborted signal", async () => {
    const controller = new AbortController();
    request.mockResolvedValueOnce(response({ jobId: id }, 202))
      .mockResolvedValueOnce(response({ status: "active", progress: { platformsCompleted: 0, platformsTotal: 1 } }))
      .mockResolvedValueOnce(response({ status: "cancelled" }));
    const result = editorialRequest("/api/instant-review/selected", {}, { signal: controller.signal, headers: { "x-tenant-id": "tenant-a" } });
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(); await assertion;
    const deletes = request.mock.calls.filter(call => call[0] === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0][1]).toBe(`/api/editorial/jobs/${id}`);
    expect(deletes[0][3].signal.aborted).toBe(false);
    expect(deletes[0][3].headers).toEqual({ "x-tenant-id": "tenant-a" });
  });

  it("never retries admission or falls back to direct generation on queue errors", async () => {
    request.mockRejectedValueOnce(new Error("Queue unavailable"));
    await expect(editorialRequest("/api/instant-review/selected", {})).rejects.toThrow("Queue unavailable");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce(response({ jobId: id }, 202))
      .mockResolvedValueOnce(response({ status: "failed", progress: {}, error: { status: 503, body: { message: "Provider quota exhausted" } } }));
    await expect(editorialRequest("/api/instant-review/selected", {})).rejects.toMatchObject({ status: 503, message: "Provider quota exhausted" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("rejects malformed admission IDs before polling or fetching arbitrary paths", async () => {
    request.mockResolvedValueOnce(response({ jobId: "../../private" }, 202));
    await expect(editorialRequest("/api/instant-review/selected", {})).rejects.toMatchObject({ status: 502 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retains cancellation through status 503 backoff and sends DELETE on abort", async () => {
    const controller = new AbortController();
    request.mockResolvedValueOnce(response({ jobId: id }, 202))
      .mockRejectedValueOnce(new ApiError(503, "Temporary outage", 5000))
      .mockResolvedValueOnce(response({ status: "cancelled" }));
    const result = editorialRequest("/api/instant-review/manual", {}, { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.map(call => call[0])).toEqual(["POST", "GET"]);
    controller.abort(); await assertion;
    expect(request.mock.calls.map(call => call[0])).toEqual(["POST", "GET", "DELETE"]);
    expect(request.mock.calls[2][3].signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors Retry-After on status and retries a transient result failure without readmission", async () => {
    request.mockResolvedValueOnce(response({ jobId: id }, 202))
      .mockRejectedValueOnce(new ApiError(429, "Slow down", 5000))
      .mockResolvedValueOnce(response({ status: "completed", progress: {} }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response({ posts: "recovered" }));
    const result = editorialRequest("/api/instant-review/manual", {});
    await vi.advanceTimersByTimeAsync(4999);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toEqual({ posts: "recovered" });
    expect(request.mock.calls.filter(call => call[0] === "POST")).toHaveLength(1);
  });

  it("bounds transient retries and resumes the retained job after error recovery without POST", async () => {
    const state = createEditorialRequestState();
    request.mockResolvedValueOnce(response({ jobId: id }, 202)).mockRejectedValue(new ApiError(503, "Temporary outage"));
    const failed = editorialRequest("/api/instant-review/manual", {}, { state });
    const assertion = expect(failed).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(25_000); await assertion;
    expect(request).toHaveBeenCalledTimes(7); // admission + initial GET + five retries
    expect(state.jobId).toBe(id); expect(state.terminal).not.toBe(true);
    const deadline = state.deadline;
    request.mockResolvedValueOnce(response({ status: "completed", progress: {} }))
      .mockResolvedValueOnce(response({ posts: "recovered" }));
    expect(await editorialRequest("/api/instant-review/manual", {}, { state })).toEqual({ posts: "recovered" });
    expect(state.deadline).toBe(deadline);
    expect(request.mock.calls.filter(call => call[0] === "POST")).toHaveLength(1);
  });

  it("retains the same UUID after uncertain admission but assigns a fresh UUID to a new intent", async () => {
    const state = createEditorialRequestState();
    request.mockRejectedValueOnce(new TypeError("Lost admission response"));
    await expect(editorialRequest("/api/instant-review/manual", { title: "Same" }, { state })).rejects.toThrow();
    request.mockResolvedValueOnce(response({ jobId: id }, 202))
      .mockResolvedValueOnce(response({ status: "completed", progress: {} }))
      .mockResolvedValueOnce(response({ posts: "done" }));
    await editorialRequest("/api/instant-review/manual", { title: "Same" }, { state });
    request.mockResolvedValueOnce(response({ posts: "new" }));
    await editorialRequest("/api/instant-review/manual", { title: "Same" });
    const posts = request.mock.calls.filter(call => call[0] === "POST");
    expect(posts[0][2].requestIntent).toBe(state.requestIntent);
    expect(posts[1][2].requestIntent).toBe(state.requestIntent);
    expect(posts[2][2].requestIntent).not.toBe(state.requestIntent);
  });

  it("does not disguise cancellation network failure as success and allows cancel recovery", async () => {
    const state = createEditorialRequestState();
    const controller = new AbortController();
    request.mockResolvedValueOnce(response({ jobId: id }, 202))
      .mockRejectedValueOnce(new ApiError(503, "Temporary outage"))
      .mockRejectedValueOnce(new TypeError("Network down"));
    const result = editorialRequest("/api/instant-review/manual", {}, { state, signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ status: 503, message: expect.stringContaining("Cancellation could not be confirmed") });
    await vi.advanceTimersByTimeAsync(0); controller.abort(); await assertion;
    expect(state.jobId).toBe(id); expect(state.terminal).not.toBe(true);
    request.mockResolvedValueOnce(response({ status: "cancelled" }));
    await cancelEditorialRequest(state);
    expect(state.terminal).toBe(true);
  });

  it("enforces the original deadline even when Retry-After exceeds it", async () => {
    const state = { ...createEditorialRequestState(), deadline: Date.now() + 2000 };
    request.mockResolvedValueOnce(response({ jobId: id }, 202))
      .mockRejectedValueOnce(new ApiError(503, "Outage", 600_000))
      .mockResolvedValueOnce(response({ status: "cancelled" }));
    const result = editorialRequest("/api/instant-review/manual", {}, { state });
    const assertion = expect(result).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(2000); await assertion;
    expect(request.mock.calls.map(call => call[0])).toEqual(["POST", "GET", "DELETE"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows corrected input after confirmed admission rejection, but never retries non-transient polling", async () => {
    const state = createEditorialRequestState();
    request.mockRejectedValueOnce(new ApiError(400, "Invalid input"));
    await expect(editorialRequest("/api/instant-review/manual", {}, { state })).rejects.toMatchObject({ status: 400 });
    expect(state.terminal).toBe(true);
    request.mockResolvedValueOnce(response({ jobId: id }, 202)).mockRejectedValueOnce(new ApiError(403, "Forbidden"));
    await expect(editorialRequest("/api/instant-review/manual", {})).rejects.toMatchObject({ status: 403 });
    expect(request.mock.calls.map(call => call[0])).toEqual(["POST", "POST", "GET"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});