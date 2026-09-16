import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createAccountCache } from "../../client/src/lib/account-cache";
import { ApiError, getQueryFn } from "../../client/src/lib/queryClient";
import { dashboardRedirectTarget, gateQueryStatus } from "../../client/src/lib/integration-security";

afterEach(() => vi.unstubAllGlobals());
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
};

describe("account cache boundary", () => {
  it("clears unknown startup data, preserves same-account cache, clears on identity change/logout", async () => {
    const client = new QueryClient();
    const scope = createAccountCache(client);
    client.setQueryData(["/api/me"], { id: "old" });
    await scope.synchronize("a");
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    client.setQueryData(["/api/profile"], { tenantId: "tenant-a" });
    await scope.synchronize("a");
    expect(client.getQueryData(["/api/profile"])).toEqual({ tenantId: "tenant-a" });
    const change = scope.synchronize("b");
    expect(scope.getSnapshot().pending).toBe(true);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    await change;
    client.setQueryData(["/api/me"], { id: "b" });
    await scope.synchronize(null);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(scope.getSnapshot()).toMatchObject({ accountId: null, pending: false });
  });

  it.each([true, false])("rejects late old requests even when signal is consumed=%s", async (consumeSignal) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const scope = createAccountCache(client);
    await scope.synchronize("a");
    const old = deferred<string>();
    let signal: AbortSignal | undefined;
    const request = client.fetchQuery({ queryKey: ["/api/me"], queryFn: (context) => {
      if (consumeSignal) signal = context.signal;
      return old.promise;
    } }).catch(() => "cancelled");
    await scope.synchronize("b");
    if (consumeSignal) expect(signal?.aborted).toBe(true);
    client.setQueryData(["/api/me"], "b");
    old.resolve("private-a");
    expect(await request).toBe("cancelled");
    expect(client.getQueryData(["/api/me"])).toBe("b");
    client.clear();
  });

  it("only releases the newest transition and locks account rendering for explicit logout", async () => {
    const client = new QueryClient();
    const scope = createAccountCache(client);
    await Promise.all([scope.synchronize("a"), scope.synchronize("b"), scope.synchronize("c")]);
    expect(scope.getSnapshot()).toMatchObject({ accountId: "c", pending: false });
    client.setQueryData(["private"], "c");
    const logout = scope.beginSignOut();
    expect(scope.getSnapshot().signingOut).toBe(true);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    await scope.synchronize("c");
    expect(scope.getSnapshot().pending).toBe(true);
    await logout;
    client.setQueryData(["late"], "c");
    await scope.finishSignOut();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    await scope.synchronize("c"); // Failed sign-out: rebuild, don't resurrect cache.
    expect(scope.getSnapshot()).toMatchObject({ accountId: "c", pending: false });
  });

  it("passes React Query cancellation to fetch and preserves structured HTTP failures", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({ defaultOptions: { queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false } } });
    await expect(client.fetchQuery({ queryKey: ["/api/me"] })).rejects.toMatchObject({ status: 403, name: "ApiError" });
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "include", signal: expect.any(AbortSignal) });
    client.clear();
  });
});

describe("cached availability and legacy routes", () => {
  it.each([new TypeError("offline"), new ApiError(500, "Server unavailable"), new ApiError(503, "Unavailable"), new ApiError(429, "Busy")])("retains valid data only on availability failure: %s", (error) => {
    expect(gateQueryStatus({ onboardingStatus: "completed" }, error)).toBe("ok");
    expect(gateQueryStatus(undefined, error)).toBe("error");
    expect(gateQueryStatus(null, error)).toBe("error");
  });
  it.each([401, 403, 404, 422])("does not trust cached data after HTTP %s", (status) => {
    expect(gateQueryStatus({ id: "a" }, new ApiError(status, "No access"))).toBe("error");
  });
  it("preserves OAuth context but destination tab/view wins", () => {
    const url = dashboardRedirectTarget("/dashboard/settings?tab=integrations", "connected=twitter&error=access+denied&provider=twitter&tab=billing");
    expect(new URLSearchParams(url.split("?")[1])).toEqual(new URLSearchParams("connected=twitter&error=access+denied&provider=twitter&tab=integrations"));
    expect(dashboardRedirectTarget("/dashboard/settings?tab=content", "tab=account")).toBe("/dashboard/settings?tab=content");
    expect(dashboardRedirectTarget("/dashboard/content?view=published", "view=drafts&from=old")).toBe("/dashboard/content?view=published&from=old");
  });
});