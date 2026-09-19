import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@shared/schema";
import type { FetchedArticle } from "./types";
import { planSearchQueries } from "@shared/search-query-plan";
import { installInboxRefreshFixture } from "../../../test/inbox-refresh-fixture";
const { storage, fetchArticlesForQuery } = vi.hoisted(() => ({
  storage: { beginInboxRefresh: vi.fn(), commitInboxRefresh: vi.fn(), reserveSearchQueryPlan: vi.fn(), getUserSources: vi.fn(), getInboxItemByUrl: vi.fn(), createInboxItem: vi.fn() },
  fetchArticlesForQuery: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage }));
vi.mock("../publicationSources", () => ({ resolvePublicationSources: vi.fn().mockResolvedValue([]) }));
vi.mock("../keywordSearch", () => ({ fetchArticlesForQuery }));
vi.mock("../crawlerFetch", async original => ({ ...await original<typeof import("../crawlerFetch")>(),
  fetchPublicText: vi.fn(() => { throw new Error("Unexpected network request"); }),
}));
vi.mock("./articleCache", () => ({ getCachedArticles: (_key: string, fetcher: () => Promise<FetchedArticle[]>) => fetcher() }));
import { BaseIndustryEngine } from "./baseEngine";
import * as relevance from "../articleRelevance";
import { summarizeArticle } from "../articleSummary";

class Engine extends BaseIndustryEngine {
  readonly config = { industry: "other" as const, displayName: "Test", description: "", industryPrompt: "" };
  ownArticles: FetchedArticle[] = [];
  protected async fetchUserSources() { return this.ownArticles; }
}
const scope = { tenantId: "tenant", userId: "user" };
let persistedProfile: UserProfile;
const profile = (overrides: Partial<UserProfile> = {}) =>
  (persistedProfile = { keywords: [], companies: [], influencers: [], publications: [], ...overrides } as UserProfile);
const article = (link: string, content: string, extra: Partial<FetchedArticle> = {}): FetchedArticle => ({
  title: `Story ${link}`, link: `https://news.test/${link}`, content, source: "Publication", categories: [], pubDate: "", ...extra,
});
const ownSource = { userSourceProvenance: { kind: "active-user-source" as const, sourceId: "active-source" } };
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  installInboxRefreshFixture(storage);
  profile();
  let state: unknown = {};
  storage.reserveSearchQueryPlan.mockImplementation(async () => {
    const plan = planSearchQueries(persistedProfile, state);
    state = plan.state;
    return { queries: plan.queries, searchEdition: persistedProfile.searchEdition ?? "en-US", profile: persistedProfile };
  });
  storage.getUserSources.mockResolvedValue([]);
  storage.getInboxItemByUrl.mockResolvedValue(undefined);
  storage.createInboxItem.mockResolvedValue({ id: "saved" });
  fetchArticlesForQuery.mockResolvedValue([]);
});

describe("engine shared relevance", () => {
  it("ranks by real weights and breaks ties by link, regardless of fetch order", async () => {
    const engine = new Engine();
    const articles = [article("z", "AI"), article("low", "Cloud"), article("a", "AI")];
    const interests = profile({ keywords: [{ keyword: "AI", weight: 1 }, { keyword: "Cloud", weight: 0.1 }] });
    const result = await engine.scoreArticles(articles, interests);
    expect(result.map(item => item.link)).toEqual(["https://news.test/a", "https://news.test/z", "https://news.test/low"]);
    expect(await engine.scoreArticles([...articles].reverse(), interests)).toEqual(result);
    expect(result.map(item => item.relevanceScore)).toEqual([0.5, 0.5, 0.0909]);
  });

  it("calls the scorer once per article and persists the exact result despite summary truncation", async () => {
    const engine = new Engine();
    const fetched = article("full", `${"Background information. ".repeat(50)} AI Meta Ada Lovelace`);
    engine.ownArticles = [fetched];
    const interests = profile({ keywords: [{ keyword: "AI", weight: 0.8 }], companies: ["Meta"], influencers: ["Ada Lovelace"] });
    const expected = relevance.scoreArticleRelevance(fetched, interests);
    const scorer = vi.spyOn(relevance, "scoreArticleRelevance");
    const result = await engine.processForUser(scope, interests);
    expect(result).toMatchObject({ success: true, articlesProcessed: 1, articlesMatched: 1, newInboxItems: 1 });
    expect(scorer).toHaveBeenCalledExactlyOnceWith(fetched, interests);
    expect(storage.createInboxItem).toHaveBeenCalledExactlyOnceWith(scope, expect.objectContaining({
      headline: fetched.title, source: fetched.source, articleUrl: fetched.link, summary: summarizeArticle(fetched.content).summary,
      matchedKeywords: expected.matchedKeywords, relevanceScore: String(expected.relevanceScore), relevanceReason: expected.relevanceReason, status: "active",
      qualityMetadata: expect.objectContaining({ relevance: { version: "concept-v1", evidence: expected.evidence } }),
    }));
    expect(fetched.content.slice(0, 500)).not.toContain("AI");
  });

  it.each(["search", "own-source"])("never falls back to irrelevant raw %s articles", async kind => {
    const engine = new Engine();
    const fetched = article("irrelevant", "Sports results", { source: "Preferred", categories: ["user-source"], ...(kind === "own-source" ? ownSource : {}) });
    if (kind === "search") fetchArticlesForQuery.mockResolvedValue([fetched]);
    else engine.ownArticles = [fetched];
    const result = await engine.processForUser(scope, profile({ keywords: [{ keyword: "AI", weight: 0.7 }], publications: ["Preferred"] }));
    expect(result).toMatchObject({ articlesProcessed: 1, articlesMatched: 0, newInboxItems: 0 });
    expect(storage.createInboxItem).not.toHaveBeenCalled();
  });

  it("does not infer publication identity from exact or substring source names", async () => {
    const engine = new Engine();
    const articles = [article("exact", "Sports", { source: "Meta" }), article("partial", "Sports", { source: "Metaverse" }),
      article("empty", "Sports", { source: "", categories: ["user-source"] })];
    expect(await engine.scoreArticles(articles, profile({ publications: ["Meta"] }))).toEqual([]);
  });

  it("persists source-only selection without searching disabled keywords or trusting search labels", async () => {
    const engine = new Engine();
    engine.ownArticles = [article("trusted", "Sports results", ownSource)];
    const untrusted = article("untrusted", "Other sports", { categories: ["user-source"] });
    fetchArticlesForQuery.mockResolvedValue([untrusted]);
    const interests = profile({ keywords: [{ keyword: "AI", weight: 0 }] });
    const result = await engine.processForUser(scope, interests);
    expect(result).toMatchObject({ articlesProcessed: 1, articlesMatched: 1, newInboxItems: 1 });
    expect(storage.reserveSearchQueryPlan).toHaveBeenCalledExactlyOnceWith(scope);
    expect(fetchArticlesForQuery).not.toHaveBeenCalled();
    expect(await engine.scoreArticles([untrusted], interests)).toEqual([]);
    expect(storage.createInboxItem).toHaveBeenCalledExactlyOnceWith(scope, expect.objectContaining({
      articleUrl: "https://news.test/trusted", relevanceScore: "0.1", matchedKeywords: [],
      relevanceReason: relevance.scoreArticleRelevance(engine.ownArticles[0], {}).relevanceReason,
    }));
  });

  it("passes title duplicates to commit so history exclusion precedes story grouping", async () => {
    const engine = new Engine();
    const unique = Array.from({ length: 12 }, (_, i) => article(String(i).padStart(2, "0"), "AI"));
    engine.ownArticles = [...unique, unique[0], { ...unique[1], link: "https://other.test/duplicate-title" }];
    storage.getInboxItemByUrl.mockImplementation(async (_scope, link) => link === unique[0].link ? { id: "existing" } : undefined);
    const result = await engine.processForUser(scope, profile({ keywords: [{ keyword: "AI", weight: 0.7 }] }));
    expect(result).toMatchObject({ articlesProcessed: 13, articlesMatched: 13, newInboxItems: 10 });
    expect(storage.commitInboxRefresh.mock.calls[0][4]).toHaveLength(13);
    expect(storage.getInboxItemByUrl).toHaveBeenCalledTimes(13);
    expect(storage.createInboxItem).toHaveBeenCalledTimes(10);
  });
});