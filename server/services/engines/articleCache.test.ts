import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchedArticle } from "./types";

let getCachedArticles: typeof import("./articleCache").getCachedArticles;
let limits: typeof import("./articleCache").ARTICLE_CACHE_LIMITS;
const article = (overrides: Partial<FetchedArticle> = {}): FetchedArticle => ({
  title: "Story", link: "https://news.test/story", pubDate: "2026-09-19",
  source: "News", content: "Public content", categories: ["Technology"], ...overrides,
});
function deferred() {
  let resolve!: (articles: FetchedArticle[]) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<FetchedArticle[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const keyFor = (edition: string, queries: string[]) => `keywords:${JSON.stringify([edition, queries])}`;

beforeEach(async () => {
  vi.resetModules();
  ({ getCachedArticles, ARTICLE_CACHE_LIMITS: limits } = await import("./articleCache"));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-19T00:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("bounded process-local provider article cache", () => {
  it("coalesces misses, uses the same key for hits, and isolates all mutable results", async () => {
    const input = [article()];
    const gate = deferred();
    const fetcher = vi.fn(() => gate.promise);
    const ignored = vi.fn(async () => [article({ title: "Wrong" })]);
    const first = getCachedArticles("same", fetcher);
    const second = getCachedArticles("same", ignored);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    gate.resolve(input);
    const [a, b] = await Promise.all([first, second]);
    input[0].categories.push("producer mutation"); input[0].title = "changed";
    a[0].categories.push("consumer mutation"); a[0].title = "changed"; a.push(article());
    expect(b).toEqual([article()]);
    b[0].categories.length = 0;
    const hit = await getCachedArticles("same", ignored);
    expect(hit).toEqual([article()]);
    hit[0].content = "mutated hit";
    expect(await getCachedArticles("same", ignored)).toEqual([article()]);
    expect(ignored).not.toHaveBeenCalled();
  });

  it("starts TTL at settlement, expires at the boundary, and does not slide on reads", async () => {
    const gate = deferred();
    const first = getCachedArticles("ttl", () => gate.promise);
    await vi.advanceTimersByTimeAsync(limits.ttlMs * 2);
    gate.resolve([article()]); await first;
    const refresh = vi.fn(async () => [article({ title: "Fresh" })]);
    await vi.advanceTimersByTimeAsync(limits.ttlMs - 1);
    expect(await getCachedArticles("ttl", refresh)).toEqual([article()]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await getCachedArticles("ttl", refresh)).toEqual([article({ title: "Fresh" })]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caches successful empty results", async () => {
    const fetcher = vi.fn(async () => []);
    expect(await getCachedArticles("empty", fetcher)).toEqual([]);
    expect(await getCachedArticles("empty", fetcher)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["sync", "async"])("never caches %s failures, sanitizes errors and permits retry", async kind => {
    const fetcher = vi.fn(() => {
      const error = new Error("secret query https://user:password@private.test/");
      if (kind === "sync") throw error;
      return Promise.reject(error);
    });
    const outcomes = await Promise.allSettled([
      getCachedArticles("private-query", fetcher), getCachedArticles("private-query", fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toMatchObject({ name: "ArticleCacheError", code: "fetch", message: "Article search could not complete. Please try again." });
        expect(outcome.reason.cause).toBeUndefined();
      }
    }
    expect(await getCachedArticles("private-query", async () => [article()])).toEqual([article()]);
  });

  it("preserves edition, query order/case, whitespace and delimiter boundaries", async () => {
    const keys = [keyFor("en-US", ["AI", "B"]), keyFor("en-GB", ["AI", "B"]),
      keyFor("en-US", ["B", "AI"]), keyFor("en-US", ["ai", "B"]),
      keyFor("en-US", ["AI|B"]), keyFor("en-US", ["AI ", "B"]),
      keyFor("en-US", ["AI,B"]), keyFor("en-US", ['AI","B'])];
    const fetchers = keys.map((key) => vi.fn(async () => [article({ title: key })]));
    await Promise.all(keys.map((key, i) => getCachedArticles(key, fetchers[i])));
    for (const [i, key] of keys.entries()) {
      expect(await getCachedArticles(key, fetchers[i])).toEqual([article({ title: key })]);
      expect(fetchers[i]).toHaveBeenCalledTimes(1);
    }
  });

  it("evicts the least recently used entry at the entry limit, including empty entries", async () => {
    const fetchers = Array.from({ length: limits.maxEntries }, () => vi.fn(async () => []));
    for (const [i, fetcher] of fetchers.entries()) await getCachedArticles(`k${i}`, fetcher);
    await getCachedArticles("k0", fetchers[0]);
    await getCachedArticles("new", async () => []);
    await getCachedArticles("k0", fetchers[0]);
    await getCachedArticles("k1", fetchers[1]);
    expect(fetchers[0]).toHaveBeenCalledTimes(1);
    expect(fetchers[1]).toHaveBeenCalledTimes(2);
  });

  it("sweeps expired entries before evicting live ones regardless of LRU order", async () => {
    const old = vi.fn(async () => []);
    await getCachedArticles("old", old);
    await vi.advanceTimersByTimeAsync(1);
    const live = vi.fn(async () => []);
    for (let i = 0; i < limits.maxEntries - 1; i++) await getCachedArticles(`live${i}`, live);
    await getCachedArticles("old", old);
    await vi.advanceTimersByTimeAsync(limits.ttlMs - 1);
    await getCachedArticles("new", async () => []);
    live.mockClear();
    await getCachedArticles("live0", live);
    expect(live).not.toHaveBeenCalled();
    await getCachedArticles("old", old);
    expect(old).toHaveBeenCalledTimes(2);
  });

  function exactSizeEntry(key: string, bytes: number): FetchedArticle[] {
    const result = [article({ content: "" })];
    const overhead = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(result));
    result[0].content = "x".repeat(bytes - overhead);
    return result;
  }

  it("charges key + payload bytes exactly and evicts LRU at the total-byte limit", async () => {
    const count = limits.maxTotalBytes / limits.maxEntryBytes;
    const fetchers = Array.from({ length: count }, (_, i) => vi.fn(async () => exactSizeEntry(`b${i}`, limits.maxEntryBytes)));
    for (const [i, fetcher] of fetchers.entries()) await getCachedArticles(`b${i}`, fetcher);
    await getCachedArticles("b0", fetchers[0]);
    await getCachedArticles("overflow", async () => []);
    await getCachedArticles("b0", fetchers[0]);
    expect(fetchers[0]).toHaveBeenCalledTimes(1);
    await getCachedArticles("b1", fetchers[1]);
    expect(fetchers[1]).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(limits.ttlMs);
    for (const [i, fetcher] of fetchers.entries()) await getCachedArticles(`b${i}`, fetcher);
    fetchers[0].mockClear();
    await getCachedArticles("b0", fetchers[0]);
    expect(fetchers[0]).not.toHaveBeenCalled();
  });

  it("rejects oversized UTF-8/escaped payloads without caching or truncation", async () => {
    const oversized = [exactSizeEntry("big", limits.maxEntryBytes + 1),
      [article({ content: "界".repeat(Math.floor(limits.maxEntryBytes / 2)) })],
      [article({ content: "\u0000".repeat(Math.floor(limits.maxEntryBytes / 3)) })]];
    for (const batch of oversized) {
      const fetcher = vi.fn(async () => batch);
      await expect(getCachedArticles("big", fetcher)).rejects.toMatchObject({ code: "result" });
      await expect(getCachedArticles("big", fetcher)).rejects.toMatchObject({ code: "result" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
    expect(await getCachedArticles("big", async () => [article()])).toEqual([article()]);
  });

  it("bounds keys before invoking fetchers and accepts the exact UTF-8 key limit", async () => {
    const fetcher = vi.fn(async () => []);
    for (const key of ["", "x".repeat(limits.maxKeyBytes + 1), "界".repeat(limits.maxKeyBytes / 2)]) {
      await expect(getCachedArticles(key, fetcher)).rejects.toMatchObject({ code: "key" });
    }
    expect(fetcher).not.toHaveBeenCalled();
    const key = "é".repeat(limits.maxKeyBytes / 2);
    await getCachedArticles(key, fetcher); await getCachedArticles(key, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed/broad results and caps article/category counts", async () => {
    const batches: unknown[] = [null, {}, [null], [article({ categories: null as unknown as string[] })],
      [article({ title: 42 as unknown as string })], new Array(1),
      Array.from({ length: limits.maxArticles + 1 }, () => article()),
      [article({ categories: new Array(limits.maxCategoriesPerArticle + 1).fill("") })]];
    for (const batch of batches) {
      await expect(getCachedArticles("invalid", async () => batch as FetchedArticle[])).rejects.toMatchObject({ code: "result" });
    }
    const batch = Array.from({ length: limits.maxArticles }, () => article({ categories: new Array(limits.maxCategoriesPerArticle).fill("") }));
    expect(await getCachedArticles("valid", async () => batch)).toEqual(batch);
  });

  it("rejects entire provenance-bearing batches instead of sharing private source content", async () => {
    const privateArticle = article({ userSourceProvenance: { kind: "active-user-source", sourceId: "tenant-source" } });
    for (const value of [privateArticle, Object.assign(Object.create({ userSourceProvenance: privateArticle.userSourceProvenance }), article())]) {
      const fetcher = vi.fn(async () => [article(), value]);
      const outcomes = await Promise.allSettled([getCachedArticles("provider", fetcher), getCachedArticles("provider", fetcher)]);
      expect(outcomes.every(result => result.status === "rejected" && result.reason.code === "result")).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    expect(await getCachedArticles("provider", async () => [article()])).toEqual([article()]);
  });

  it("strips unknown/scoring fields and does not infer trusted provenance from labels", async () => {
    const expected = article({ source: "user-source", categories: ["active-user-source"] });
    const value = { ...expected, relevanceScore: 1, tenantId: "private", nested: { private: true }, toJSON: () => { throw new Error("must not run"); } };
    expect(await getCachedArticles("labels", async () => [value])).toEqual([expected]);
    expect(await getCachedArticles("labels", async () => [])).toEqual([expected]);
  });

  it("caps active distinct fetches without bypass or queued work, even after a long stall", async () => {
    await getCachedArticles("hit", async () => [article()]);
    const gates = Array.from({ length: limits.maxInFlight }, deferred);
    const fetchers = gates.map(gate => vi.fn(() => gate.promise));
    const tasks = gates.map((_, i) => getCachedArticles(`pending${i}`, fetchers[i]));
    const overflow = vi.fn(async () => []);
    await expect(getCachedArticles("overflow", overflow)).rejects.toMatchObject({ code: "busy" });
    await vi.advanceTimersByTimeAsync(limits.ttlMs - 1);
    expect(await getCachedArticles("hit", overflow)).toEqual([article()]);
    await vi.advanceTimersByTimeAsync(limits.ttlMs * 10);
    await expect(getCachedArticles("overflow", overflow)).rejects.toMatchObject({ code: "busy" });
    expect(vi.getTimerCount()).toBe(0);
    expect(overflow).not.toHaveBeenCalled();
    const joined = getCachedArticles("pending0", overflow);
    gates[0].resolve([]); await tasks[0]; await joined;
    await getCachedArticles("overflow", overflow);
    expect(overflow).toHaveBeenCalledTimes(1);
    gates.slice(1).forEach(gate => gate.resolve([])); await Promise.all(tasks);
    fetchers.forEach(fetcher => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it("bounds same-key consumers (including leader) and releases all on failure", async () => {
    const gate = deferred();
    const fetcher = vi.fn(() => gate.promise);
    const tasks = Array.from({ length: limits.maxConsumersPerKey }, () => getCachedArticles("shared", fetcher));
    const outcomes = Promise.allSettled(tasks);
    await expect(getCachedArticles("shared", fetcher)).rejects.toMatchObject({ code: "busy" });
    gate.reject(new Error("failure"));
    expect((await outcomes).every(result => result.status === "rejected")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await getCachedArticles("shared", async () => [])).toEqual([]);
  });

  it("bounds total consumers across keys and frees capacity after settlement", async () => {
    const gates = Array.from({ length: limits.maxConsumers / limits.maxConsumersPerKey }, deferred);
    const tasks = gates.flatMap((gate, i) => Array.from({ length: limits.maxConsumersPerKey }, () => getCachedArticles(`g${i}`, () => gate.promise)));
    const overflow = vi.fn(async () => []);
    await expect(getCachedArticles("another", overflow)).rejects.toMatchObject({ code: "busy" });
    expect(overflow).not.toHaveBeenCalled();
    gates.forEach(gate => gate.resolve([])); await Promise.all(tasks);
    await getCachedArticles("another", overflow);
    expect(overflow).toHaveBeenCalledTimes(1);
  });

  it("rejects a burst without starting or retaining bypass/queued fetches and recovers failed slots", async () => {
    const gate = deferred();
    const fetcher = vi.fn(() => gate.promise);
    const tasks = Array.from({ length: limits.maxInFlight }, (_, i) => getCachedArticles(`active${i}`, fetcher));
    const activeOutcomes = Promise.allSettled(tasks);
    const excess = vi.fn(async () => []);
    const rejected = await Promise.allSettled(Array.from({ length: 1000 }, (_, i) => getCachedArticles(`excess${i}`, excess)));
    expect(rejected.every(result => result.status === "rejected" && result.reason.code === "busy")).toBe(true);
    gate.reject(new Error("provider unavailable"));
    await activeOutcomes;
    expect(fetcher).toHaveBeenCalledTimes(limits.maxInFlight);
    expect(excess).not.toHaveBeenCalled();
    await Promise.all(Array.from({ length: limits.maxInFlight }, (_, i) => getCachedArticles(`excess${i}`, excess)));
    expect(excess).toHaveBeenCalledTimes(limits.maxInFlight);
  });

  it("does not evict healthy entries or charge bytes for invalid batches", async () => {
    const fetcher = vi.fn(async () => [article()]);
    for (let i = 0; i < limits.maxEntries; i++) await getCachedArticles(`healthy${i}`, fetcher);
    for (let i = 0; i < 3; i++) {
      await expect(getCachedArticles("invalid", async () => exactSizeEntry("invalid", limits.maxEntryBytes + 1)))
        .rejects.toMatchObject({ code: "result" });
    }
    fetcher.mockClear();
    for (let i = 0; i < limits.maxEntries; i++) await getCachedArticles(`healthy${i}`, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shares only within one module instance, with no cross-instance persistence", async () => {
    await getCachedArticles("same", async () => [article({ title: "Original instance" })]);
    vi.resetModules();
    const fresh = await import("./articleCache");
    const fetcher = vi.fn(async () => [article({ title: "New instance" })]);
    expect(await fresh.getCachedArticles("same", fetcher)).toEqual([article({ title: "New instance" })]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await getCachedArticles("same", fetcher)).toEqual([article({ title: "Original instance" })]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});