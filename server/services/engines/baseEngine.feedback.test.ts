import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@shared/schema";
import type { FetchedArticle } from "./types";
import { installInboxRefreshFixture } from "../../../test/inbox-refresh-fixture";

const { storage, load } = vi.hoisted(() => ({
  storage: { beginInboxRefresh: vi.fn(), commitInboxRefresh: vi.fn(), reserveSearchQueryPlan: vi.fn(), getUserSources: vi.fn(), getInboxItemByUrl: vi.fn(), createInboxItem: vi.fn(), getInboxItems: vi.fn() },
  load: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage }));
vi.mock("../../repositories/inboxFeedback", () => ({ inboxFeedbackRepository: { load } }));
vi.mock("../publicationSources", () => ({ resolvePublicationSources: async () => [] }));
vi.mock("../keywordSearch", () => ({ fetchArticlesForQuery: vi.fn().mockResolvedValue([]), isGoogleNewsArticleUrl: () => false, resolveGoogleNewsArticleUrl: vi.fn() }));
vi.mock("../bingNewsSearch", () => ({ fetchBingArticlesForQuery: async () => [] }));
vi.mock("../articlePool", () => ({ queryArticlePool: async () => [], registerPublications: async () => 0, prefetchPooledBodies: async () => 0, knownUnreadableLinks: async () => [] }));
vi.mock("../indexDiscovery", () => ({ noteDiscoveredSites: async () => 0, noteWatchTerms: async () => undefined }));
import { BaseIndustryEngine } from "./baseEngine";

const scope = { tenantId: "tenant", userId: "user" };
const profile = { keywords: [{ keyword: "Retail media", weight: 0.7 }, { keyword: "CTV", weight: 0.7 }], companies: [], influencers: [], publications: [] } as unknown as UserProfile;
const article = (slug: string, source: string, title: string): FetchedArticle => ({ title, content: `${title}. More detail.`, link: `https://news.test/${slug}`, source, categories: [], pubDate: null });
const fetched = [
  article("a", "Wire Daily", "Retail media budgets grow"),
  article("b", "Ad Brief", "CTV measurement gets a standard"),
  article("c", "Data Desk", "Retail media meets CTV"),
];

class Engine extends BaseIndustryEngine {
  readonly config = { industry: "other" as const, displayName: "Test", description: "", industryPrompt: "" };
  protected async fetchUserSources() { return structuredClone(fetched); }
  protected async fetchKeywordSearchArticles() { return []; }
}

type Candidate = { articleUrl: string; source: string; relevanceScore: string; rankingScore: string; matchedKeywords: string[]; relevanceReason: string };
async function refresh() {
  await new Engine().processForUser(scope, profile);
  const [, , , , candidates, { durationMs: _duration, ...metrics }] = storage.commitInboxRefresh.mock.calls.at(-1)!;
  return { metrics, candidates: (candidates as Candidate[]).map(({ articleUrl, source, relevanceScore, rankingScore, matchedKeywords, relevanceReason }) =>
    ({ articleUrl, source, relevanceScore, rankingScore, matchedKeywords, relevanceReason })) };
}

beforeEach(() => {
  vi.resetAllMocks();
  installInboxRefreshFixture(storage);
  storage.reserveSearchQueryPlan.mockResolvedValue({ queries: [], searchEdition: "en-US", profile });
  storage.getUserSources.mockResolvedValue([]);
  storage.getInboxItemByUrl.mockResolvedValue(undefined);
  storage.createInboxItem.mockImplementation(async (_scope, item) => item);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("refresh applies learned feed preferences", () => {
  it("ranks exactly as before with no preferences, or when they cannot be loaded", async () => {
    load.mockResolvedValue({ mutedSources: [], keywordAdjustments: {} });
    const none = await refresh();
    load.mockRejectedValue(new Error("relation \"feed_preferences\" does not exist"));
    const unavailable = await refresh();
    expect(none).toEqual(unavailable);
    expect(none.candidates.map(item => item.source)).toEqual(["Data Desk", "Wire Daily", "Ad Brief"]);
    const mine = vi.mocked(console.warn).mock.calls.filter(([message]) => String(message).startsWith("[feed-preferences]"));
    expect(mine).toHaveLength(1);
    expect(load).toHaveBeenCalledWith(scope);
  });

  it("skips muted sources before scoring", async () => {
    load.mockResolvedValue({ mutedSources: ["wire  DAILY"], keywordAdjustments: {} });
    const { candidates, metrics } = await refresh();
    expect(candidates.map(item => item.source)).toEqual(["Data Desk", "Ad Brief"]);
    expect(metrics.articlesProcessed).toBe(2);
  });

  it("scales keyword weights, changing the order and scores within range", async () => {
    load.mockResolvedValue({ mutedSources: [], keywordAdjustments: {} });
    const before = (await refresh()).candidates;
    load.mockResolvedValue({ mutedSources: [], keywordAdjustments: { "Retail media": -0.6, CTV: 0.4 } });
    const after = (await refresh()).candidates;
    expect(after.map(item => item.source)).toEqual(["Data Desk", "Ad Brief", "Wire Daily"]);
    const score = (list: Candidate[], source: string) => Number(list.find(item => item.source === source)!.relevanceScore);
    expect(score(after, "Wire Daily")).toBeLessThan(score(before, "Wire Daily"));
    expect(score(after, "Ad Brief")).toBeGreaterThan(score(before, "Ad Brief"));
    for (const item of after) {
      expect(Number(item.rankingScore)).toBeGreaterThan(0);
      expect(Number(item.rankingScore)).toBeLessThanOrEqual(1);
    }
  });
});
