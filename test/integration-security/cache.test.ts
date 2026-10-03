import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createAccountCache } from "../../client/src/lib/account-cache";
import { accountCache, apiRequest, ApiError, getQueryFn, queryClient } from "../../client/src/lib/queryClient";
import { EDITORIAL_RECOVERY_KEY, saveEditorialRecovery } from "../../client/src/lib/editorial-recovery";
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

const makeTenantClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
async function tenantFixture() {
  const client = makeTenantClient();
  const scope = createAccountCache(client);
  await scope.synchronize("a");
  client.setQueryData(["/api/me"], { id: "a", registrationCompleted: null });
  client.setQueryData(["/api/profile"], { userId: "a", tenantId: "tenant-a" });
  await scope.synchronizeTenant("a", "tenant-a");
  return { client, scope };
}

describe("resolved tenant cache boundary", () => {
  it.each([null, { id: "a", registrationCompleted: null }])("adopts the first tenant without cancelling or refetching the account bootstrap: %j", async me => {
    const client = makeTenantClient();
    const scope = createAccountCache(client);
    await scope.synchronize("a");
    const initial = deferred<typeof me>();
    let signal!: AbortSignal;
    const loadMe = vi.fn((context: { signal: AbortSignal }) => { signal = context.signal; return initial.promise; });
    const request = client.fetchQuery({ queryKey: ["/api/me"], queryFn: loadMe });
    const profile = { userId: "a", tenantId: "tenant-a", onboardingStatus: "pending" };
    client.setQueryData(["/api/profile"], profile);
    const lifetime = scope.getSignal();
    await scope.synchronizeTenant("a", "tenant-a");
    expect(signal.aborted).toBe(false);
    expect(scope.getSignal()).toBe(lifetime);
    expect(client.getQueryData(["/api/profile"])).toBe(profile);
    initial.resolve(me);
    expect(await request).toEqual(me);
    await scope.synchronize("a");
    await scope.synchronizeTenant("a", "tenant-a");
    await client.fetchQuery({ queryKey: ["/api/me"], queryFn: loadMe });
    expect(loadMe).toHaveBeenCalledOnce();
    expect(client.getQueryData(["/api/me"])).toEqual(me);
    client.clear();
  });

  it("clears same-user tenant data before releasing readers and preserves only exact bootstrap queries", async () => {
    const { client, scope } = await tenantFixture();
    const privateKeys = [["/api/inbox"], ["/api/inbox", "active"], ["/api/drafts"], ["/api/trends"],
      ["inbox-refresh-job"], ["/api/profile", "social-links"], ["/api/me", "private-detail"]];
    for (const key of privateKeys) client.setQueryData(key, ["private-tenant-a"]);
    client.getMutationCache().build(client, { mutationKey: ["private-tenant-a"] });
    const meQuery = client.getQueryCache().find({ queryKey: ["/api/me"], exact: true });
    const meState = meQuery!.state;
    const profile = { userId: "a", tenantId: "tenant-b" };
    client.setQueryData(["/api/profile"], profile);
    const profileQuery = client.getQueryCache().find({ queryKey: ["/api/profile"], exact: true });
    const profileState = profileQuery!.state;
    const lifetime = scope.getSignal();
    const released: unknown[] = [];
    const unsubscribe = scope.subscribe(() => {
      if (!scope.getSnapshot().pending) released.push(client.getQueryCache().getAll().map(query => query.state.data));
    });
    const transition = scope.synchronizeTenant("a", "tenant-b");
    expect(scope.getSnapshot()).toMatchObject({ accountId: "a", tenantId: "tenant-b", pending: true });
    expect(lifetime.aborted).toBe(true);
    expect(scope.getSignal()).not.toBe(lifetime);
    expect(client.getQueryCache().getAll()).toHaveLength(2);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(released).toHaveLength(0);
    for (const key of privateKeys) expect(client.getQueryData(key)).toBeUndefined();
    await transition;
    expect(released).toHaveLength(1);
    expect(JSON.stringify(released)).not.toContain("tenant-a");
    expect(client.getQueryCache().find({ queryKey: ["/api/me"], exact: true })).not.toBe(meQuery);
    expect(client.getQueryState(["/api/me"])).toEqual(meState);
    expect(client.getQueryCache().find({ queryKey: ["/api/profile"], exact: true })).not.toBe(profileQuery);
    expect(client.getQueryState(["/api/profile"])).toEqual(profileState);
    expect(client.getQueryData(["/api/me"])).toBe(meState.data);
    expect(client.getQueryData(["/api/profile"])).toBe(profileState.data);
    for (const endpoint of ["/api/me", "/api/profile"]) {
      const loadBootstrap = vi.fn(async () => ({}));
      const bootstrap = new QueryObserver(client, { queryKey: [endpoint], queryFn: loadBootstrap });
      const stopBootstrap = bootstrap.subscribe(() => {});
      expect(bootstrap.getCurrentResult().status).toBe("success");
      expect(loadBootstrap).not.toHaveBeenCalled();
      stopBootstrap();
    }

    // A newly mounted consumer must see loading/new data, never a stale first
    // result while a background refetch replaces the previous tenant's inbox.
    const observed: unknown[] = [];
    const loadInbox = vi.fn(async () => ["tenant-b-story"]);
    const observer = new QueryObserver(client, { queryKey: ["/api/inbox"], queryFn: loadInbox });
    expect(observer.getCurrentResult().data).toBeUndefined();
    const stop = observer.subscribe(result => observed.push(result.data));
    await client.fetchQuery({ queryKey: ["/api/inbox"], queryFn: loadInbox });
    expect(loadInbox).toHaveBeenCalledOnce();
    expect(JSON.stringify(observed)).not.toContain("tenant-a");
    expect(observer.getCurrentResult().data).toEqual(["tenant-b-story"]);
    stop(); unsubscribe(); client.clear();
  });

  it.each([true, false])("fences late old tenant queries including pending bootstrap reads; signal consumed=%s", async consumeSignal => {
    const { client, scope } = await tenantFixture();
    const pending = [["/api/me"], ["/api/profile"], ["/api/inbox"], ["inbox-refresh-job"]].map(queryKey => {
      const result = deferred<unknown>();
      let signal: AbortSignal | undefined;
      const request = client.fetchQuery({ queryKey, staleTime: 0, queryFn: context => {
        if (consumeSignal) signal = context.signal;
        return result.promise;
      } }).catch(() => "cancelled");
      return { result, request, signal };
    });
    // A current response/cache update can arrive while an old query ignores
    // abort. Cancelling it must not roll the accepted profile back to tenant A.
    const profile = client.setQueryData(["/api/profile"], { userId: "a", tenantId: "tenant-b" });
    await scope.synchronizeTenant("a", "tenant-b");
    if (consumeSignal) for (const entry of pending) expect(entry.signal?.aborted).toBe(true);
    client.setQueryData(["/api/inbox"], ["tenant-b-story"]);
    client.setQueryData(["inbox-refresh-job"], { status: "idle" });
    for (const entry of pending) entry.result.resolve({ tenantId: "tenant-a", private: "late-old-result" });
    await Promise.all(pending.map(entry => entry.request));
    expect(client.getQueryData(["/api/me"])).toEqual({ id: "a", registrationCompleted: null });
    expect(client.getQueryData(["/api/profile"])).toBe(profile);
    expect(client.getQueryState(["/api/profile"])?.fetchStatus).toBe("idle");
    expect(client.getQueryData(["/api/inbox"])).toEqual(["tenant-b-story"]);
    expect(client.getQueryData(["inbox-refresh-job"])).toEqual({ status: "idle" });
    expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data))).not.toContain("tenant-a");
    client.clear();
  });

  it.each(["/api/me", "/api/profile"])("isolates already-resolved old %s queries before their cache commit", async endpoint => {
    const { client, scope } = await tenantFixture();
    const oldData = endpoint === "/api/me" ? { id: "a", name: "Old account row" } : { userId: "a", tenantId: "tenant-a" };
    const old = deferred<typeof oldData>();
    const request = client.fetchQuery({ queryKey: [endpoint], staleTime: 0, queryFn: () => old.promise });
    const oldQuery = client.getQueryCache().find({ queryKey: [endpoint], exact: true });
    old.resolve(oldData);
    // The retryer resolves first; Query.fetch's awaited cache commit is queued
    // behind this continuation. Cancellation alone cannot reject that result.
    await old.promise;
    client.setQueryData(["/api/me"], { id: "a", name: "Current account row" });
    client.setQueryData(["/api/profile"], { userId: "a", tenantId: "tenant-b" });
    const current = client.getQueryData([endpoint]);
    await scope.synchronizeTenant("a", "tenant-b");
    expect(await request).toEqual(oldData);
    expect(oldQuery?.state.data).toEqual(oldData);
    expect(client.getQueryData([endpoint])).toBe(current);
    expect(client.getQueryCache().find({ queryKey: [endpoint], exact: true })).not.toBe(oldQuery);
    expect(scope.getSnapshot()).toMatchObject({ tenantId: "tenant-b", pending: false });
    client.clear();
  });

  it("preserves same-user session and same-tenant profile refreshes without resetting the lifetime", async () => {
    const { client, scope } = await tenantFixture();
    const lifetime = scope.getSignal();
    const snapshot = scope.getSnapshot();
    const inbox = ["retained-local-data"];
    client.setQueryData(["/api/inbox"], inbox);
    client.setQueryData(["/api/profile"], { userId: "a", tenantId: "tenant-a", focusDescription: "Updated preferences" });
    await scope.synchronize("a");
    await scope.synchronizeTenant("a", "tenant-a");
    expect(scope.getSnapshot()).toBe(snapshot);
    expect(scope.getSignal()).toBe(lifetime);
    expect(lifetime.aborted).toBe(false);
    expect(client.getQueryData(["/api/inbox"])).toBe(inbox);
    client.clear();
  });

  it("ignores missing profiles and stale tenant effects from a different session or profile", async () => {
    const { client, scope } = await tenantFixture();
    const snapshot = scope.getSnapshot();
    const lifetime = scope.getSignal();
    await scope.synchronizeTenant("other-account", "tenant-a");
    await scope.synchronizeTenant("a", "tenant-b");
    await scope.synchronizeTenant("a", "");
    client.removeQueries({ queryKey: ["/api/profile"] });
    await scope.synchronizeTenant("a", "tenant-b");
    expect(scope.getSnapshot()).toBe(snapshot);
    expect(scope.getSignal()).toBe(lifetime);
    expect(lifetime.aborted).toBe(false);
    client.clear();
  });

  it("only releases the newest tenant transition and lets account changes and sign-out supersede it", async () => {
    const { client, scope } = await tenantFixture();
    const released: (string | undefined)[] = [];
    const stop = scope.subscribe(() => { if (!scope.getSnapshot().pending) released.push(scope.getSnapshot().tenantId); });
    client.setQueryData(["/api/profile"], { tenantId: "tenant-b" });
    const first = scope.synchronizeTenant("a", "tenant-b");
    client.setQueryData(["/api/profile"], { tenantId: "tenant-c" });
    const second = scope.synchronizeTenant("a", "tenant-c");
    await Promise.all([first, second]);
    expect(released).toEqual(["tenant-c"]);

    client.setQueryData(["/api/profile"], { tenantId: "tenant-d" });
    await Promise.all([scope.synchronizeTenant("a", "tenant-d"), scope.synchronize("b")]);
    expect(scope.getSnapshot()).toMatchObject({ accountId: "b", tenantId: undefined, pending: false });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    // The same tenant name under another account still needs a fresh /api/me.
    client.setQueryData(["/api/me"], { id: "b" });
    client.setQueryData(["/api/profile"], { userId: "b", tenantId: "tenant-c" });
    await scope.synchronizeTenant("b", "tenant-c");
    expect(client.getQueryData(["/api/me"])).toEqual({ id: "b" });

    client.setQueryData(["/api/profile"], { userId: "b", tenantId: "tenant-d" });
    await Promise.all([scope.synchronizeTenant("b", "tenant-d"), scope.beginSignOut()]);
    await scope.synchronizeTenant("b", "tenant-d");
    expect(scope.getSnapshot()).toMatchObject({ tenantId: undefined, pending: true, signingOut: true });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    await scope.finishSignOut();
    await scope.synchronize("b"); // Failed sign-out rebuilds; no old bootstrap survives.
    expect(scope.getSnapshot()).toMatchObject({ accountId: "b", tenantId: undefined, pending: false });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    stop(); client.clear();
  });

  it("retains same-tenant recovery metadata but drops it on a same-user tenant swap without replay", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { client, scope } = await tenantFixture();
    saveEditorialRecovery({ userId: "a", tenantId: "tenant-a" }, "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002");
    await scope.synchronize("a");
    await scope.synchronizeTenant("a", "tenant-a");
    expect(values.has(EDITORIAL_RECOVERY_KEY)).toBe(true);
    client.setQueryData(["/api/profile"], { userId: "a", tenantId: "tenant-b" });
    await scope.synchronizeTenant("a", "tenant-b");
    expect(values.has(EDITORIAL_RECOVERY_KEY)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    client.clear();
  });
});

describe("tenant-bound API lifetime and availability", () => {
  beforeEach(async () => {
    await accountCache.synchronize(null);
    await accountCache.synchronize("a");
    queryClient.setQueryData(["/api/me"], { id: "a" });
    queryClient.setQueryData(["/api/profile"], { userId: "a", tenantId: "tenant-a" });
    await accountCache.synchronizeTenant("a", "tenant-a");
  });
  afterEach(async () => { await accountCache.finishSignOut(); queryClient.clear(); });

  it.each(["GET", "POST"])("rejects a late old-tenant %s response even when fetch ignores abort, without replay", async method => {
    const response = deferred<Response>();
    const fetch = vi.fn((_url: string, _options: RequestInit) => response.promise);
    vi.stubGlobal("fetch", fetch);
    const outcome = apiRequest(method, "/api/drafts", method === "POST" ? { content: "private-tenant-a" } : undefined).catch(error => error);
    const signal = fetch.mock.calls[0][1].signal!;
    queryClient.setQueryData(["/api/profile"], { userId: "a", tenantId: "tenant-b" });
    await accountCache.synchronizeTenant("a", "tenant-b");
    expect(signal.aborted).toBe(true);
    response.resolve(new Response(JSON.stringify({ id: "private-tenant-a" })));
    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(["/api/drafts"])).toBeUndefined();
  });

  it("aborts old-tenant response-body reads on the shared lifetime", async () => {
    const fetch = vi.fn((_url: string, options: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(controller) { options.signal!.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError"))); },
    }))));
    vi.stubGlobal("fetch", fetch);
    const response = await apiRequest("GET", "/api/editorial/jobs/old/result");
    const body = response.json().catch(error => error);
    queryClient.setQueryData(["/api/profile"], { userId: "a", tenantId: "tenant-b" });
    await accountCache.synchronizeTenant("a", "tenant-b");
    expect(await body).toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retains work on account outage and preserves its write block through a tenant swap until recovery", async () => {
    const local = ["retained-tenant-a"];
    const lifetime = accountCache.getSignal();
    queryClient.setQueryData(["/api/inbox"], local);
    const unavailable = new ApiError(503, "Account unavailable");
    await queryClient.fetchQuery({ queryKey: ["/api/me"], staleTime: 0, queryFn: () => { throw unavailable; } }).catch(() => {});
    const meState = queryClient.getQueryState(["/api/me"]);
    await accountCache.synchronize("a");
    await accountCache.synchronizeTenant("a", "tenant-a");
    expect(accountCache.getSnapshot()).toMatchObject({ accountId: "a", tenantId: "tenant-a", pending: false, signingOut: false });
    expect(lifetime.aborted).toBe(false);
    expect(queryClient.getQueryData(["/api/inbox"])).toBe(local);
    expect(gateQueryStatus(meState?.data, meState?.error)).toBe("ok");
    const fetch = vi.fn().mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await expect(apiRequest("PATCH", "/api/profile", {})).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();

    queryClient.setQueryData(["/api/profile"], { userId: "a", tenantId: "tenant-b" });
    await accountCache.synchronizeTenant("a", "tenant-b");
    expect(queryClient.getQueryState(["/api/me"])).toEqual(meState);
    expect(queryClient.getQueryState(["/api/me"])?.error).toBe(unavailable);
    await expect(apiRequest("POST", "/api/drafts", {})).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
    await apiRequest("GET", "/api/me");
    expect(fetch).toHaveBeenCalledOnce();
    queryClient.setQueryData(["/api/me"], { id: "a" });
    await apiRequest("PATCH", "/api/profile", {});
    expect(fetch).toHaveBeenCalledTimes(2);
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