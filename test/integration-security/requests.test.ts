import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountCache, apiRequest, ApiError, queryClient } from "../../client/src/lib/queryClient";

beforeEach(async () => {
  await accountCache.synchronize(null);
  await accountCache.synchronize("a");
});
afterEach(async () => {
  await accountCache.finishSignOut();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("account-bound API transport", () => {
  it("rejects old API responses after an identity change, even if fetch ignores abort", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(yes => { resolve = yes; }));
    vi.stubGlobal("fetch", fetch);
    const request = apiRequest("POST", "/api/drafts", { content: "private-a" });
    const outcome = request.catch(error => error);
    const signal = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
    await accountCache.synchronize("b");
    expect(signal.aborted).toBe(true);
    resolve(new Response(JSON.stringify({ id: "private-a" })));
    expect(await outcome).toMatchObject({ name: "AbortError" });
  });

  it("aborts response-body consumption from the previous account", async () => {
    const fetch = vi.fn((_url: string, options: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(controller) { options.signal!.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError"))); },
    }))));
    vi.stubGlobal("fetch", fetch);
    const response = await apiRequest("GET", "/api/inbox");
    const body = response.json().catch(error => error);
    await accountCache.synchronize("b");
    expect(await body).toMatchObject({ name: "AbortError" });
  });

  it("blocks writes on a cached account refetch failure but allows recovery reads", async () => {
    queryClient.setQueryData(["/api/me"], { id: "a" });
    await queryClient.fetchQuery({ queryKey: ["/api/me"], staleTime: 0, queryFn: () => { throw new ApiError(500, "Unavailable"); } }).catch(() => {});
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await expect(apiRequest("PATCH", "/api/profile", {})).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
    await apiRequest("GET", "/api/me");
    expect(fetch).toHaveBeenCalledOnce();
    queryClient.setQueryData(["/api/me"], { id: "a" });
    await apiRequest("PATCH", "/api/profile", {});
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not send requests while explicit sign-out is in progress", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await accountCache.beginSignOut();
    await expect(apiRequest("POST", "/api/drafts", {})).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps caller cancellation and same-account requests intact", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const caller = new AbortController();
    await apiRequest("GET", "/api/inbox", undefined, { signal: caller.signal });
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    await accountCache.synchronize("a");
    expect(signal.aborted).toBe(false);
    caller.abort();
    expect(signal.aborted).toBe(true);
  });
});