import { beforeEach, describe, expect, it, vi } from "vitest";

// Generation reads the story from the shared index when its page is there, and live otherwise.
const { find, fetcher, generate } = vi.hoisted(() => ({ find: vi.fn(), fetcher: vi.fn(), generate: vi.fn() }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../middlewares/requireDbUser", () => ({ authedOf: vi.fn() }));
vi.mock("../routes/editorial-context", async importOriginal => ({ ...await importOriginal<typeof import("../routes/editorial-context")>(), editorialContext: vi.fn() }));
vi.mock("./punditBrain", () => ({ generatePlatformReviewsDetailed: generate }));
vi.mock("./urlFetcher", () => ({ fetchArticleFromUrl: fetcher }));
vi.mock("./articlePool", () => ({ findPooledArticle: find }));
vi.mock("./keywordSearch", () => ({ isGoogleNewsArticleUrl: () => false, resolveGoogleNewsArticleUrl: vi.fn() }));
import { executeEditorialRequest } from "./editorial-request";

const body = "The National Pharmaceutical Pricing Authority capped stent prices for a third year. ".repeat(12);
const prepared = { input: { url: "https://www.publisher.test/health/stents?utm_source=digest", selectedPlatforms: ["linkedin"], format: "post" }, options: {} } as unknown as Parameters<typeof executeEditorialRequest>[0];
const signal = new AbortController().signal;

beforeEach(() => {
  vi.resetAllMocks();
  generate.mockResolvedValue({ platforms: [] });
  fetcher.mockResolvedValue({ title: "Live title", content: "Live content", source: "Live", url: "https://www.publisher.test/health/stents", domain: "publisher.test" });
});

describe("executeEditorialRequest and the shared index", () => {
  it("hands the AI the indexed body instead of fetching the page", async () => {
    find.mockResolvedValue({ canonicalUrl: "https://www.publisher.test/health/stents", title: "NPPA caps stent prices", source: "Pharma Daily",
      sourceOrigin: "https://www.publisher.test", content: body, inputKind: "page_body", readable: true, publishedAt: new Date("2026-09-27T10:00:00Z") });
    const result = await executeEditorialRequest(prepared, signal);
    expect(find).toHaveBeenCalledWith("https://www.publisher.test/health/stents?utm_source=digest");
    expect(fetcher).not.toHaveBeenCalled();
    expect(generate.mock.calls[0][0]).toMatchObject({
      title: "NPPA caps stent prices", content: body, source: "Pharma Daily", url: "https://www.publisher.test/health/stents", domain: "publisher.test",
      contentMetadata: { extractionMethod: "index", originalLength: body.length, retainedLength: body.length, truncated: false },
      publishedAt: "2026-09-27T10:00:00.000Z",
    });
    expect(result.article).toMatchObject({ title: "NPPA caps stent prices" });
  });

  it.each([null, { readable: false, inputKind: "feed_excerpt", content: "" }, { readable: null, inputKind: "feed_excerpt", content: "excerpt" }])(
    "fetches the page live when the index has no readable body (%j)", async known => {
      find.mockResolvedValue(known);
      await executeEditorialRequest(prepared, signal);
      expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://www.publisher.test/health/stents?utm_source=digest", signal);
      expect(generate.mock.calls[0][0]).toMatchObject({ title: "Live title" });
    });

  it("fetches the page live when the index lookup itself fails", async () => {
    find.mockRejectedValue(new Error("index down"));
    await executeEditorialRequest(prepared, signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
