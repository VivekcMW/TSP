import type { Express, Request, RequestHandler, Response } from "express";
import type { UserProfile } from "@shared/schema";
import type { TenantScope } from "../storage";
import type { FetchedArticle } from "../services/engines/types";
import { planSearchQueries } from "@shared/search-query-plan";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installInboxRefreshFixture } from "../../test/inbox-refresh-fixture";

const { storage, getEngine, enqueue, search, crawl, resolveSources, network, pass, scope, dbUser } = vi.hoisted(() => ({
  storage: {
    beginInboxRefresh: vi.fn(), commitInboxRefresh: vi.fn(), getInboxRefreshReceipt: vi.fn(),
    getUserProfile: vi.fn(), getUser: vi.fn(), getUserSources: vi.fn(), updateUserSource: vi.fn(),
    getInboxItems: vi.fn(), getInboxItemByUrl: vi.fn(), createInboxItem: vi.fn(), addInboxItem: vi.fn(),
    updateInboxItem: vi.fn(), createEngineRunLog: vi.fn(), reserveSearchQueryPlan: vi.fn(),
  },
  getEngine: vi.fn(), enqueue: vi.fn(), search: vi.fn(), crawl: vi.fn(), resolveSources: vi.fn(),
  network: vi.fn(() => { throw new Error("Unexpected real network request"); }),
  pass: (_req: unknown, _res: unknown, next: () => void) => next(),
  scope: { tenantId: "relevance-tenant", userId: "relevance-user" },
  dbUser: { id: "relevance-user", industry: "other" },
}));

vi.mock("../storage", () => ({ storage, InboxCapacityError: class extends Error {}, InboxOperationConflictError: class extends Error {} }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: scope, dbUser }) }));
vi.mock("../middlewares/requirePermission", () => ({ requirePermission: () => pass }));
vi.mock("../middlewares/rateLimit", () => ({ inboxRefreshRateLimit: pass }));
vi.mock("../jobs/queue", () => ({ enqueueInboxRefresh: enqueue, getJobStatus: vi.fn(), InboxRefreshAdmissionError: class extends Error {} }));
// Both index.js (route) and directory (worker) resolve to this same registry mock.
vi.mock("../services/engines/index.js", () => ({ engineRegistry: { getEngine } }));
vi.mock("../services/metaEngine", () => ({ normalizeIndustryToSlug: (industry: string) => industry }));
vi.mock("../services/urlValidator", async original => ({
  ...await original<typeof import("../services/urlValidator")>(),
  validateUrl: vi.fn().mockResolvedValue({ isValid: true }),
}));
vi.mock("../services/publicationSources", () => ({ resolvePublicationSources: resolveSources }));
vi.mock("../services/keywordSearch", () => ({ fetchArticlesForQuery: search }));
vi.mock("../services/engines/articleCache", () => ({
  getCachedArticles: (_key: string, fetcher: () => Promise<FetchedArticle[]>) => fetcher(),
}));
vi.mock("../services/crawlerFetch", async original => ({
  ...await original<typeof import("../services/crawlerFetch")>(), fetchPublicText: crawl,
}));
vi.mock("node-fetch", () => ({ default: network }));
// Fail closed if a future import accidentally crosses an infrastructure boundary.
vi.mock("../db", () => { throw new Error("Database must not load in relevance route tests"); });
vi.mock("../lib/redis", () => { throw new Error("Redis must not load in relevance route tests"); });
vi.mock("bull", () => { throw new Error("Bull must not load in relevance route tests"); });

import { registerInboxRoutes } from "./inbox";
import { handleInboxRefresh } from "../jobs/handlers/inbox-refresh";
import { BaseIndustryEngine } from "../services/engines/baseEngine";
import * as relevance from "../services/articleRelevance";
import { summarizeArticle } from "../services/articleSummary";

// No fetch/score/process overrides: even source provenance and feed parsing are real.
class RelevanceEngine extends BaseIndustryEngine {
  readonly config = { industry: "other" as const, displayName: "Relevance test", description: "", industryPrompt: "" };
}

interface InboxWrite {
  headline: string;
  source: string;
  articleUrl: string;
  summary: string | null;
  relevanceScore: string;
  matchedKeywords: string[];
  relevanceReason: string;
  status: string;
}
type StoredItem = InboxWrite & { id: string };
interface RefreshResponse {
  count: number;
  articlesProcessed: number;
  articlesMatched: number;
  items: StoredItem[];
}

// Capture the real registered handlers and run the mocked middleware in memory.
// Unlike supertest, this does not open even a loopback HTTP socket.
const routes = new Map<string, RequestHandler[]>();
const registrar = Object.fromEntries(["get", "post", "patch"].map(method => [method,
  (url: string, ...handlers: RequestHandler[]) => routes.set(`${method} ${url}`, handlers),
]));
registerInboxRoutes(registrar as unknown as Express);

async function refreshRoute() {
  const req = { body: { tenantId: "forged", userId: "forged" }, query: {}, params: {} } as Request;
  const res = { statusCode: 200, status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  res.json.mockReturnValue(res);
  const handlers = routes.get("post /api/inbox/refresh");
  expect(handlers).toBeDefined();
  for (const handler of handlers!) {
    const next = vi.fn();
    await handler(req, res as unknown as Response, next);
    if (!next.mock.calls.length) break;
    expect(next).toHaveBeenCalledExactlyOnceWith();
  }
  expect(res.statusCode).toBe(200);
  expect(res.json).toHaveBeenCalledTimes(1);
  return res.json.mock.calls[0][0] as RefreshResponse;
}

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  keywords: [], companies: [], influencers: [], publications: [], ...overrides,
}) as UserProfile;
const article = (slug: string, content: string): FetchedArticle => ({
  title: `Report ${slug}`, link: `https://news.test/${slug}`, content,
  source: "Research Desk", categories: [], pubDate: "2026-09-19T00:00:00.000Z",
});
const expectedWrite = (item: FetchedArticle, score: number, matchedKeywords: string[], relevanceReason: string): InboxWrite => ({
  headline: item.title, source: item.source, articleUrl: item.link, summary: summarizeArticle(item.content).summary,
  relevanceScore: String(score), matchedKeywords, relevanceReason, status: "active",
});
const sourceRow = {
  id: "active-source", name: "Research Desk", feedUrl: "https://news.test/feed.json",
  sourceType: "feed", isActive: true, lastFetchedAt: null,
};

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-20T12:00:00Z"));
  vi.clearAllMocks();
  installInboxRefreshFixture(storage);
  storage.getInboxItemByUrl.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", network);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function compareRefreshPaths(options: {
  interests: UserProfile;
  callerProfile?: UserProfile;
  fetched: FetchedArticle[];
  expected: InboxWrite[];
  processed: number;
  matched: number;
  feedArticles?: FetchedArticle[];
  existingUrl?: string;
}) {
  const { interests, callerProfile = interests, fetched, expected, processed, matched, feedArticles, existingUrl } = options;
  const originalInputs = structuredClone({ interests, fetched, feedArticles });
  const processSpy = vi.spyOn(BaseIndustryEngine.prototype, "processForUser");
  const scoreSpy = vi.spyOn(BaseIndustryEngine.prototype, "scoreArticles");
  const scorerSpy = vi.spyOn(relevance, "scoreArticleRelevance");
  const snapshots: InboxWrite[][] = [];
  const scoredInputs: FetchedArticle[][] = [];
  const queryLabels = planSearchQueries(interests).queries;

  for (const mode of ["sync", "worker"] as const) {
    vi.clearAllMocks();
    const engine = new RelevanceEngine();
    const rows: StoredItem[] = [];
    getEngine.mockReturnValue(engine);
    enqueue.mockResolvedValue(null);
    storage.getUserProfile.mockResolvedValue(callerProfile);
    let queryState: unknown = {};
    storage.reserveSearchQueryPlan.mockImplementation(async () => {
      const plan = planSearchQueries(interests, queryState);
      queryState = plan.state;
      return { queries: plan.queries, searchEdition: interests.searchEdition ?? "en-US", profile: interests };
    });
    storage.getUser.mockResolvedValue(dbUser);
    storage.getUserSources.mockResolvedValue(feedArticles ? [sourceRow, { ...sourceRow, id: "inactive-source", isActive: false }] : []);
    storage.updateUserSource.mockResolvedValue(undefined);
    storage.getInboxItems.mockImplementation(async () => [...rows]);
    storage.getInboxItemByUrl.mockImplementation(async (_scope: TenantScope, url: string) =>
      url === existingUrl ? { id: "already-stored" } : rows.find(row => row.articleUrl === url));
    storage.createInboxItem.mockImplementation(async (_scope: TenantScope, data: InboxWrite) => {
      const row = { ...data, id: `item-${rows.length + 1}` };
      rows.push(row);
      return row;
    });
    storage.createEngineRunLog.mockResolvedValue(undefined);
    resolveSources.mockResolvedValue([]);
    search.mockImplementation(async (query: string) => query === queryLabels[0] ? fetched : []);
    crawl.mockImplementation(async (url: string) => {
      if (!feedArticles || url !== sourceRow.feedUrl) throw new Error("Unexpected crawl URL");
      return { text: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: feedArticles.map(item => ({
        id: item.link, url: item.link, title: item.title, content_text: item.content,
        date_published: item.pubDate, tags: item.categories,
      })) }) };
    });

    if (mode === "sync") {
      const response = await refreshRoute();
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...scope, manual: true, autoRefresh: false, triggeredBy: "manual",
        operationId: expect.stringMatching(/^refresh:/), dedupeKey: expect.any(String) }));
      expect(response).toMatchObject({ count: expected.length, articlesProcessed: processed, articlesMatched: matched });
      expect(response.items).toEqual(rows);
      expect(storage.getUser).not.toHaveBeenCalled();
    } else {
      const progress = vi.fn().mockResolvedValue(undefined);
      // Bull is a type only; the real handler needs just data, id and progress.
      const job = { id: "relevance-job", data: { ...scope, startedAt: Date.now(), manual: true }, progress };
      const result = await handleInboxRefresh(job as unknown as Parameters<typeof handleInboxRefresh>[0]);
      expect(result).toMatchObject({ articlesCreated: expected.length, articlesProcessed: processed, articlesMatched: matched });
      expect(progress).toHaveBeenCalledExactlyOnceWith(result);
      expect(storage.getUser).toHaveBeenCalledExactlyOnceWith(scope.userId);
      expect(enqueue).not.toHaveBeenCalled();
    }

    expect(getEngine).toHaveBeenCalledExactlyOnceWith("other");
    expect(storage.getUserProfile).toHaveBeenCalledExactlyOnceWith(scope);
    expect(processSpy).toHaveBeenCalledExactlyOnceWith(scope, callerProfile, expect.objectContaining({ operationId: expect.any(String), autoRefresh: false }));
    expect(processSpy.mock.calls[0][1]).toBe(callerProfile);
    expect(processSpy.mock.contexts[0]).toBe(engine);
    expect(scoreSpy).toHaveBeenCalledTimes(1);
    if (processed) expect(scoreSpy.mock.calls[0][1]).toBe(interests);
    expect(scorerSpy).toHaveBeenCalledTimes(processed);
    for (const [, passedProfile] of scorerSpy.mock.calls) expect(passedProfile).toBe(interests);
    scoredInputs.push(structuredClone(scoreSpy.mock.calls[0]?.[0] ?? []));
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledExactlyOnceWith(scope);
    expect(search.mock.calls).toEqual(queryLabels.map(query => [query, 8, interests.searchEdition ?? "en-US", expect.any(AbortSignal)]));
    expect(resolveSources).toHaveBeenCalledExactlyOnceWith(scope, interests);
    expect(storage.createEngineRunLog).toHaveBeenCalledExactlyOnceWith(scope, expect.objectContaining({
      industry: "other", status: "success", articlesProcessed: processed, articlesMatched: matched, errorMessage: null,
    }));
    expect(storage.createInboxItem.mock.calls.map(([writeScope]) => writeScope)).toEqual(expected.map(() => scope));
    const writes = storage.createInboxItem.mock.calls.map(([, data]) => data as InboxWrite);
    expect(writes).toMatchObject(expected);
    for (const write of writes) expect(write).toMatchObject({ qualityMetadata: expect.objectContaining({ version: "quality-v1" }) });
    // Numeric values as well as the exact database decimal strings are contractual.
    expect(writes.map(item => Number(item.relevanceScore))).toEqual(expected.map(item => Number(item.relevanceScore)));
    snapshots.push(structuredClone(writes));
    if (feedArticles) {
      expect(crawl).toHaveBeenCalledExactlyOnceWith(sourceRow.feedUrl, { signal: expect.any(AbortSignal) });
      expect(storage.updateUserSource).toHaveBeenCalledExactlyOnceWith(scope, sourceRow.id, expect.objectContaining({
        lastFetchStatus: "ok", lastFetchError: null,
      }));
      expect(scoredInputs.at(-1)).toEqual(expect.arrayContaining(feedArticles.map(item => expect.objectContaining({
        ...item, categories: item.categories.length ? item.categories : ["user-source"],
        userSourceProvenance: { kind: "active-user-source", sourceId: sourceRow.id },
      }))));
    } else {
      expect(crawl).not.toHaveBeenCalled();
    }
  }
  expect(scoredInputs[1]).toEqual(scoredInputs[0]);
  expect(snapshots[1]).toEqual(snapshots[0]);
  expect({ interests, fetched, feedArticles }).toEqual(originalInputs);
}

describe("real inbox refresh relevance parity", () => {
  it("does not invent scored keyword evidence when manually adding a trend", async () => {
    storage.getInboxItems.mockResolvedValue([]);
    storage.addInboxItem.mockResolvedValue({ item: { id: "manual" }, alreadyExists: false });
    const handler = routes.get("post /api/inbox/add-trend")!.at(-1)!;
    const res = { json: vi.fn(), status: vi.fn() };
    await handler({ body: { title: "Weather report", link: "https://news.test/weather", topic: "AI" } } as Request,
      res as unknown as Response, vi.fn());
    expect(storage.addInboxItem).toHaveBeenCalledExactlyOnceWith(scope, expect.objectContaining({
      matchedKeywords: [], relevanceScore: "0",
      relevanceReason: "Manually added from trends; relevance has not been scored.",
    }));
    expect(res.json).toHaveBeenCalledWith({ message: "Article added to inbox", item: { id: "manual" } });
  });

  it("requests persisted relevance ordering before inbox pagination", async () => {
    storage.getInboxItems.mockResolvedValue([]);
    const handler = routes.get("get /api/inbox")!.at(-1)!;
    const res = { json: vi.fn(), status: vi.fn() };
    await handler({ query: { limit: "5", offset: "2" } } as unknown as Request, res as unknown as Response, vi.fn());
    expect(storage.getInboxItems).toHaveBeenCalledExactlyOnceWith(scope, { limit: 5, offset: 2, order: "relevance" });
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it.each([false, true])("persists exact weighted scores, evidence and tie order (reversed fetch: %s)", async reverse => {
    const low = article("low", "Cloud");
    const z = article("z", "AI");
    const a = article("a", "AI");
    const full = article("full", `${"Background information. ".repeat(40)}AI Cloud Meta Ada Lovelace Sports`);
    const disabled = article("disabled", "Sports");
    const irrelevant = article("irrelevant", "metadata railway results");
    const fetched = [low, z, disabled, full, irrelevant, a];
    expect(full.content.indexOf("AI")).toBeGreaterThan(500);
    expect(full.content.slice(0, 500)).not.toMatch(/AI|Cloud|Meta|Ada Lovelace|Sports/);
    await compareRefreshPaths({
      interests: profile({ keywords: [{ keyword: "AI", weight: 1 }, { keyword: "Cloud", weight: 0.1 }, { keyword: "Sports", weight: 0 }], companies: ["Meta"], influencers: ["Ada Lovelace"] }),
      fetched: reverse ? [...fetched].reverse() : fetched, processed: 6, matched: 4,
      expected: [
        // Meta and Ada Lovelace appear only in the body (headline "Report full"): half weight each.
        expectedWrite(full, 0.6429, ["Ada Lovelace", "AI", "Cloud", "Meta"], 'Matched article text: influencer "Ada Lovelace"; keyword "AI"; keyword "Cloud"; company "Meta".'),
        expectedWrite(a, 0.5, ["AI"], 'Matched article text: keyword "AI".'),
        expectedWrite(z, 0.5, ["AI"], 'Matched article text: keyword "AI".'),
        expectedWrite(low, 0.0909, ["Cloud"], 'Matched article text: keyword "Cloud".'),
      ],
    });
  });

  it("returns zero matched/created without filling the inbox with irrelevant or disabled-interest articles", async () => {
    await compareRefreshPaths({
      interests: profile({ keywords: [{ keyword: "AI", weight: 1 }, { keyword: "Sports", weight: 0 }], publications: ["Research Desk"] }),
      fetched: [article("disabled", "Sports"), { ...article("metadata", "metadata railway"), categories: ["AI", "user-source"] }],
      feedArticles: [article("own-unmatched", "Weather results")], processed: 3, matched: 0, expected: [],
    });
  });

  it.each([false, true])("uses real active-source provenance without inventing topic evidence (zero-weight only: %s)", async zeroWeight => {
    const own = article("own", "Sports results");
    const spoofed = { ...article("spoofed", "Sports results"), categories: ["user-source"] };
    await compareRefreshPaths({
      interests: profile({ keywords: zeroWeight ? [{ keyword: "Sports", weight: 0 }] : [] }),
      fetched: zeroWeight ? [spoofed] : [], feedArticles: [own], processed: 1, matched: 1,
      expected: [expectedWrite(own, 0.1, [], "Selected from an active user source; no positive textual interests configured. This is source selection, not a topic match.")],
    });
    expect(search).not.toHaveBeenCalled();
    expect(relevance.scoreArticleRelevance(spoofed, profile()).relevanceScore).toBe(0);
  });

  it("does not search or score when every configured keyword is disabled", async () => {
    await compareRefreshPaths({
      interests: profile({ keywords: [{ keyword: "Sports", weight: 0 }] }),
      fetched: [article("disabled", "Sports")], processed: 0, matched: 0, expected: [],
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("passes the persisted search edition through both sync and worker refreshes", async () => {
    const item = article("regional", "AI");
    await compareRefreshPaths({
      interests: profile({ keywords: [{ keyword: "AI", weight: 0.7 }], searchEdition: "hi-IN" }),
      fetched: [item], processed: 1, matched: 1,
      expected: [expectedWrite(item, 0.4118, ["AI"], 'Matched article text: keyword "AI".')],
    });
  });

  it("uses the reserved profile after a concurrent edit in both sync and worker refreshes", async () => {
    const item = article("current", "AI");
    await compareRefreshPaths({
      callerProfile: profile({ keywords: [{ keyword: "Stale", weight: 1 }], publications: ["Stale publication"], searchEdition: "fr-FR" }),
      interests: profile({ keywords: [{ keyword: "AI", weight: 1 }], publications: ["Current publication"], searchEdition: "hi-IN" }),
      fetched: [item], processed: 1, matched: 1,
      expected: [expectedWrite(item, 0.5, ["AI"], 'Matched article text: keyword "AI".')],
    });
  });

  it("uses source-only semantics when a concurrent edit disables the stale positive interests", async () => {
    const own = article("source-only", "Sports results");
    await compareRefreshPaths({
      callerProfile: profile({ keywords: [{ keyword: "AI", weight: 1 }] }),
      interests: profile({ keywords: [{ keyword: "AI", weight: 0 }] }),
      fetched: [], feedArticles: [own], processed: 1, matched: 1,
      expected: [expectedWrite(own, 0.1, [], "Selected from an active user source; no positive textual interests configured. This is source selection, not a topic match.")],
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("keeps total matches separate from the top-ten cap and existing-URL persistence count", async () => {
    const articles = Array.from({ length: 12 }, (_, index) => article(`story-${String(index).padStart(2, "0")}`, "AI"));
    await compareRefreshPaths({
      interests: profile({ keywords: [{ keyword: "AI", weight: 1 }] }),
      fetched: [...articles].reverse().concat(articles[0], { ...articles[1], link: "https://syndicated.test/duplicate-title" }),
      existingUrl: articles[0].link, processed: 13, matched: 13,
      expected: articles.slice(1, 11).map(item => expectedWrite(item, 0.5, ["AI"], 'Matched article text: keyword "AI".')),
    });
  });
});