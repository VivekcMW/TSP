import { expect, it, vi } from "vitest";
import type { FetchedArticle } from "../../server/services/engines/types";
import { memoryProbe, metric, MiB } from "./metrics";

it("measures maximum-sized cache churn and exactly eight admitted fetches / 128 consumers", async () => {
  vi.resetModules();
  const { getCachedArticles, ARTICLE_CACHE_LIMITS: limits } = await import("../../server/services/engines/articleCache");
  const memory = memoryProbe();
  const batch = (key: string) => {
    const articles: FetchedArticle[] = [{ title: "Public", source: "Fixture", link: "https://news.test/story", pubDate: null, content: "", categories: [] }];
    articles[0].content = "x".repeat(limits.maxEntryBytes - Buffer.byteLength(key) - Buffer.byteLength(JSON.stringify(articles)));
    return articles;
  };
  let fetches = 0;
  // Four cachefuls: a byte-bound working set, not unbounded retained results.
  const resident = limits.maxTotalBytes / limits.maxEntryBytes;
  for (let i = 0; i < resident * 4; i++) {
    const key = `churn-${i}`;
    await getCachedArticles(key, async () => { fetches++; return batch(key); });
    memory.sample();
  }
  const unexpected = vi.fn(async () => []);
  for (let i = resident * 3; i < resident * 4; i++) await getCachedArticles(`churn-${i}`, unexpected);
  expect(unexpected).not.toHaveBeenCalled();
  await getCachedArticles("churn-0", unexpected);
  expect(unexpected).toHaveBeenCalledTimes(1);

  const releases: (() => void)[] = [];
  let active = 0, peakFetches = 0, admittedFetches = 0;
  const tasks: Promise<FetchedArticle[]>[] = [];
  const followers = limits.maxConsumers / limits.maxInFlight;
  for (let i = 0; i < limits.maxInFlight; i++) {
    const key = `pending-${i}`;
    const fetcher = async () => {
      admittedFetches++; active++; peakFetches = Math.max(peakFetches, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--; return batch(key);
    };
    for (let j = 0; j < followers; j++) tasks.push(getCachedArticles(key, fetcher));
  }
  const settled = Promise.allSettled(tasks);
  try {
    const bypass = vi.fn(async () => []);
    const rejected = await Promise.allSettled(Array.from({ length: 1000 }, (_, i) =>
      getCachedArticles(i % 2 ? `excess-${i}` : "pending-0", bypass)));
    expect(rejected.every(value => value.status === "rejected" && value.reason.code === "busy")).toBe(true);
    expect(bypass).not.toHaveBeenCalled();
    expect(admittedFetches).toBe(8); // The leader is included, never eight plus one.
    expect(peakFetches).toBe(8);
    expect(tasks).toHaveLength(128);
    releases.forEach(release => release());
    const outcomes = await settled;
    memory.sample(); // Includes all 128 independent half-MiB consumer copies.
    expect(outcomes.every(value => value.status === "fulfilled")).toBe(true);
    const values = outcomes.filter(value => value.status === "fulfilled").map(value => value.value);
    expect(new Set(values.map(value => value[0])).size).toBe(128);
    expect(values.reduce((total, value) => total + Buffer.byteLength(value[0].content), 0)).toBeGreaterThan(63 * MiB);
    const measured = memory.result();
    // Deliberately generous local regression alarms, not V8 object-size promises.
    expect(measured.deltaMiB.heapUsed).toBeLessThan(256);
    expect(measured.deltaMiB.rss).toBeLessThan(512);
    metric("cache-max-payload", { churnFetches: fetches, residentSerializedBytes: limits.maxTotalBytes,
      admittedFetches, peakFetches, admittedConsumers: tasks.length, rejected: rejected.length,
      consumerPayloadMiB: 64, memory: measured, thresholdsMiB: { heapUsed: 256, rss: 512 } });
  } finally { releases.forEach(release => release()); await settled; }
  expect(await getCachedArticles("recovered", async () => [])).toEqual([]);
});