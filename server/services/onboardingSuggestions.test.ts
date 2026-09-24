import { beforeEach, describe, expect, it, vi } from "vitest";

const { headlines, generateText } = vi.hoisted(() => ({ headlines: vi.fn(), generateText: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("./keywordSearch", () => ({ fetchNewsHeadlines: headlines }));
vi.mock("./openRouter", async original => ({ ...await original<typeof import("./openRouter")>(), generateText }));
import { clearOnboardingSuggestionCache, suggestOnboardingItems, type EntitySuggestion, type OnboardingSuggestionResponse } from "./onboardingSuggestions";
// Step-specific shape for assertions; the response type is a union keyed by step.
type AnyResult = OnboardingSuggestionResponse & { items: Array<{ name: string; reason?: string }>; people: EntitySuggestion[]; companies: EntitySuggestion[] };
const suggest = async (...args: Parameters<typeof suggestOnboardingItems>): Promise<AnyResult> => await suggestOnboardingItems(...args) as AnyResult;

const scope = { tenantId: "tenant-a" };
const focus = "I lead marketing at an out-of-home advertising company focused on programmatic DOOH.";
const news = (title: string, source: string, url: string | null = `https://${source.toLowerCase().replace(/\W+/g, "")}.test`, publishedAt = "2026-09-21T10:00:00.000Z") =>
  ({ title, source, sourceUrl: url, publishedAt, link: `https://news.google.com/rss/articles/${encodeURIComponent(title)}` });
const corpus = [
  news("Vistar Media expands programmatic DOOH in India", "ExchangeWire"),
  news("Programmatic DOOH spend rises for retail brands", "ExchangeWire"),
  news("Moving Walls wins DOOH measurement award", "Campaign India"),
  news("Retail media networks add in-store screens", "Adweek"),
  news("Stock tips for the week", "Generic Finance"),
];
// The model's replies, keyed by what each prompt asks for.
function replies(map: { phrases?: string[]; curate?: unknown; topics?: unknown; people?: unknown; fallback?: unknown }) {
  generateText.mockImplementation(async (prompt: string) => {
    if (prompt.includes("SEARCH PHRASES")) return JSON.stringify({ phrases: map.phrases ?? ["programmatic DOOH", "retail media"] });
    if (prompt.includes("CHOOSE OUTLETS")) { if (map.curate instanceof Error) throw map.curate; return JSON.stringify(map.curate); }
    if (prompt.includes("EXTRACT TOPICS")) return JSON.stringify(map.topics);
    if (prompt.includes("EXTRACT PEOPLE")) return JSON.stringify(map.people);
    if (prompt.includes("WITHOUT NEWS")) return JSON.stringify(map.fallback);
    throw new Error("unexpected prompt");
  });
}
const request = (step: "publications" | "topics" | "people" | "preview", extra: object = {}) => ({ step, focusDescription: focus, publications: [], topics: [], exclude: [], ...extra });

beforeEach(() => { vi.resetAllMocks(); clearOnboardingSuggestionCache(); headlines.mockResolvedValue(corpus); });

describe("publication suggestions from live news", () => {
  it("suggests only outlets found in real results, with site, article count and latest headline", async () => {
    replies({ curate: { outlets: [{ name: "Campaign India", reason: "India ad industry news" }, { name: "ExchangeWire", reason: "Programmatic trade coverage" }, { name: "Invented Weekly", reason: "Not in the results" }] } });
    const result = await suggest(request("publications"), scope);
    expect(result).toMatchObject({ step: "publications", grounded: true });
    expect(result.items).toEqual([
      { name: "Campaign India", url: "https://campaignindia.test/", reason: "India ad industry news", evidence: { count: 1, headline: "Moving Walls wins DOOH measurement award" } },
      { name: "ExchangeWire", url: "https://exchangewire.test/", reason: "Programmatic trade coverage", evidence: { count: 2, headline: "Vistar Media expands programmatic DOOH in India" } },
    ]);
    expect(headlines.mock.calls.map(call => call[0])).toEqual(["programmatic DOOH", "retail media"]);
  });

  it("never repeats excluded outlets and ranks by coverage when the model is unavailable", async () => {
    replies({ curate: new Error("provider down") });
    const result = await suggest(request("publications", { exclude: ["campaign india"] }), scope);
    expect(result.items.map(item => item.name)).toEqual(["ExchangeWire", "Adweek", "Generic Finance"]);
    expect(result.items[0].reason).toBe("2 recent articles on your topics");
  });
});

describe("topic suggestions grounded in headlines", () => {
  it("keeps only topics that cite real headlines and counts them", async () => {
    replies({ topics: { topics: [
      { topic: "Programmatic DOOH", weight: 1, headlines: [1, 2, 2] },
      { topic: "Retail media screens", weight: 0.7, headlines: [4] },
      { topic: "Metaverse billboards", weight: 0.9, headlines: [] },
      { topic: "Crypto", weight: 0.5, headlines: [99] },
    ] } });
    const result = await suggest(request("topics", { publications: [{ name: "ExchangeWire", url: "https://www.exchangewire.com/" }] }), scope);
    expect(result.items).toEqual([
      { name: "Programmatic DOOH", weight: 1, evidence: { count: 2, headline: "Vistar Media expands programmatic DOOH in India" } },
      { name: "Retail media screens", weight: 0.7, evidence: { count: 1, headline: "Retail media networks add in-store screens" } },
    ]);
    expect(headlines.mock.calls.map(call => call[0])).toContain("site:www.exchangewire.com programmatic DOOH");
  });
});

describe("people and company suggestions grounded in headlines", () => {
  it("drops any name that does not appear in a headline it cites", async () => {
    replies({ people: {
      people: [{ name: "Jane Doe", role: "Invented executive", headlines: [1] }],
      companies: [{ name: "Vistar Media", why: "Programmatic DOOH platform", headlines: [1] }, { name: "Moving Walls", why: "DOOH measurement", headlines: [3] }, { name: "Clear Channel", why: "Not in headlines", headlines: [2] }],
    } });
    const result = await suggest(request("people", { topics: ["Programmatic DOOH"] }), scope);
    expect(result.people).toEqual([]);
    expect(result.companies).toEqual([
      { name: "Vistar Media", reason: "Programmatic DOOH platform", evidence: { count: 1, headline: "Vistar Media expands programmatic DOOH in India" } },
      { name: "Moving Walls", reason: "DOOH measurement", evidence: { count: 1, headline: "Moving Walls wins DOOH measurement award" } },
    ]);
    expect(headlines.mock.calls.map(call => call[0])).toContain("Programmatic DOOH");
  });
});

describe("finish preview from live news", () => {
  const link = (title: string) => `https://news.google.com/rss/articles/${encodeURIComponent(title)}`;
  it("shows recent headlines for the top topics, preferring picked publications, without calling the model", async () => {
    headlines.mockImplementation(async (query: string) => query === "Programmatic DOOH" ? [
      news("Older DOOH story", "Generic Daily", undefined, "2026-09-20T10:00:00.000Z"),
      news("Newest DOOH story", "Other Desk", undefined, "2026-09-22T10:00:00.000Z"),
      news("Picked outlet DOOH story", "ExchangeWire", "https://www.exchangewire.com/", "2026-09-19T10:00:00.000Z"),
    ] : query === "Retail media" ? [news("Retail media advertising story", "Adweek")] : []);
    const result = await suggestOnboardingItems(request("preview", {
      topics: ["Programmatic DOOH", "Retail media", "Measurement", "Fourth topic"], publications: [{ name: "ExchangeWire", url: "https://www.exchangewire.com/" }],
    }), scope);
    expect(result).toEqual({ step: "preview", grounded: true, headlines: [
      { title: "Picked outlet DOOH story", source: "ExchangeWire", link: link("Picked outlet DOOH story"), publishedAt: "2026-09-19T10:00:00.000Z", topic: "Programmatic DOOH" },
      { title: "Retail media advertising story", source: "Adweek", link: link("Retail media advertising story"), publishedAt: "2026-09-21T10:00:00.000Z", topic: "Retail media" },
      { title: "Newest DOOH story", source: "Other Desk", link: link("Newest DOOH story"), publishedAt: "2026-09-22T10:00:00.000Z", topic: "Programmatic DOOH" },
    ] });
    expect(headlines.mock.calls.map(call => call[0])).toEqual(["Programmatic DOOH", "Retail media", "Measurement"]);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("leaves out headlines that share nothing with the user's focus unless a picked publication ran them", async () => {
    headlines.mockImplementation(async (query: string) => query === "Legislative framework" ? [
      news("Stamp taxes framework modernisation consultation", "Tax Desk"),
      news("Airport slot framework white paper", "Travel Radar"),
      news("Framework update from a picked outlet", "ExchangeWire", "https://www.exchangewire.com/"),
      news("Regulators modernise programmatic advertising rules", "Adweek"),
    ] : []);
    const result = await suggestOnboardingItems(request("preview", {
      topics: ["Legislative framework"], publications: [{ name: "ExchangeWire", url: "https://www.exchangewire.com/" }],
    }), scope);
    expect(result).toMatchObject({ headlines: [{ title: "Framework update from a picked outlet" }, { title: "Regulators modernise programmatic advertising rules" }] });
  });

  it("returns no headlines and searches nothing when no topics are picked", async () => {
    expect(await suggestOnboardingItems(request("preview"), scope)).toEqual({ step: "preview", grounded: true, headlines: [] });
    expect(headlines).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("people when headlines name few individuals", () => {
  it("adds widely known leaders, marked as AI suggestions, skipping excluded and duplicate names", async () => {
    replies({ people: {
      people: [], companies: [{ name: "Vistar Media", why: "DOOH platform", headlines: [1] }],
      knownPeople: [{ name: "Jane Leader", role: "Founder of a DOOH network" }, { name: "Removed Person", role: "Analyst" }, { name: "Vistar Media", role: "Company" }, { name: "Sam Analyst" }],
    } });
    const result = await suggest(request("people", { topics: ["Programmatic DOOH"], exclude: ["removed person"] }), scope);
    expect(result.people).toEqual([
      { name: "Jane Leader", reason: "Founder of a DOOH network", aiOnly: true },
      { name: "Sam Analyst", reason: "", aiOnly: true },
    ]);
    expect(result.companies.map(company => company.name)).toEqual(["Vistar Media"]);
  });

  it("uses only people from the news when the headlines name at least three", async () => {
    headlines.mockResolvedValue([
      news("Ana Rao joins DOOH board", "ExchangeWire"), news("Ben Ode on retail screens", "Adweek"), news("Cy Park launches measurement", "Campaign India"),
    ]);
    replies({ people: {
      people: [{ name: "Ana Rao", role: "Board member", headlines: [1] }, { name: "Ben Ode", role: "Retail media lead", headlines: [2] }, { name: "Cy Park", role: "Founder", headlines: [3] }],
      companies: [], knownPeople: [{ name: "Jane Leader", role: "Founder" }],
    } });
    const result = await suggest(request("people", { topics: ["Programmatic DOOH"] }), scope);
    expect(result.people.map(person => person.name)).toEqual(["Ana Rao", "Ben Ode", "Cy Park"]);
    expect(result.people.some(person => person.aiOnly)).toBe(false);
  });
});

describe("tolerant parsing of model replies", () => {
  it("keeps entities whose optional reason is missing and drops only malformed entries", async () => {
    replies({ people: {
      people: [{ name: "Vistar Media", headlines: ["1"] }],
      companies: [{ name: "Vistar Media", headlines: [1] }, { name: "Moving Walls", role: "DOOH measurement", headlines: [3] }, { headlines: [2] }],
    } });
    const result = await suggest(request("people", { topics: ["Programmatic DOOH"] }), scope);
    expect(result.people).toEqual([]);
    expect(result.companies).toEqual([
      { name: "Vistar Media", reason: "", evidence: { count: 1, headline: "Vistar Media expands programmatic DOOH in India" } },
      { name: "Moving Walls", reason: "DOOH measurement", evidence: { count: 1, headline: "Moving Walls wins DOOH measurement award" } },
    ]);
  });

  it("gives a topic without a weight the default and skips a malformed topic", async () => {
    replies({ topics: { topics: [{ topic: "Programmatic DOOH", headlines: [1] }, { topic: "X", weight: 0.9, headlines: [2] }, { topic: "Retail media screens", weight: 0.7, headlines: [4] }] } });
    const result = await suggest(request("topics"), scope);
    expect(result.items).toEqual([
      { name: "Retail media screens", weight: 0.7, evidence: { count: 1, headline: "Retail media networks add in-store screens" } },
      { name: "Programmatic DOOH", weight: 0.6, evidence: { count: 1, headline: "Vistar Media expands programmatic DOOH in India" } },
    ]);
  });
});

describe("resilience and cost", () => {
  it("falls back to model-only suggestions, marked ungrounded, when the news search fails", async () => {
    headlines.mockRejectedValue(new Error("search down"));
    replies({ fallback: { items: [{ name: "Adweek", reason: "Advertising trade news" }] } });
    const result = await suggest(request("publications"), scope);
    expect(result).toMatchObject({ grounded: false, items: [{ name: "Adweek", url: "https://www.adweek.com", reason: "Advertising trade news" }] });
  });

  it("serves an identical request from cache without searching or calling the model again", async () => {
    replies({ curate: { outlets: [{ name: "ExchangeWire", reason: "Programmatic trade coverage" }] } });
    const first = await suggest(request("publications"), scope);
    const calls = generateText.mock.calls.length + headlines.mock.calls.length;
    expect(await suggest(request("publications"), scope)).toEqual(first);
    expect(generateText.mock.calls.length + headlines.mock.calls.length).toBe(calls);
  });
});
