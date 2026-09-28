import { beforeEach, describe, expect, it, vi } from "vitest";

// From Cloud Run each decoder takes up to ~1.5 s per link and often fails, and a refresh decodes
// dozens of links inside a 20 s budget, so decoded links are remembered.
const { legacy, modern, offline } = vi.hoisted(() => ({ legacy: vi.fn(), modern: vi.fn(), offline: vi.fn() }));
vi.mock("decode-google-news-url", () => ({ decodeGoogleNewsUrl: legacy, tryOfflineDecode: offline }));
vi.mock("google-news-decoder", () => ({ default: class { decodeGoogleNewsUrl = modern; } }));
import { resolveGoogleNewsArticleUrl } from "./keywordSearch";

const link = (id: string) => `https://news.google.com/rss/articles/${id}?oc=5`;
const never = () => new Promise<never>(() => {});
const after = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
const timed = async (work: Promise<string>) => { const start = Date.now(); const url = await work; return { url, ms: Date.now() - start }; };

beforeEach(() => {
  vi.resetAllMocks();
  offline.mockReturnValue(null);
});

describe("resolveGoogleNewsArticleUrl", () => {
  it("tries the second decoder when the first fails or runs out of time", async () => {
    modern.mockImplementation(never);
    legacy.mockImplementation(() => after(10, "https://publisher.test/second"));
    const { url, ms } = await timed(resolveGoogleNewsArticleUrl(link("fallback"), undefined, 100));
    expect(url).toBe("https://publisher.test/second");
    expect(ms).toBeGreaterThanOrEqual(95);
  });

  it("ignores a decoder that fails or answers with another Google News link", async () => {
    modern.mockResolvedValue({ status: false, message: "blocked" });
    legacy.mockImplementation(() => after(10, link("still-wrapped")));
    expect(await resolveGoogleNewsArticleUrl(link("wrapped"), undefined, 200)).toBe(link("wrapped"));

    modern.mockRejectedValue(new Error("429"));
    legacy.mockImplementation(() => after(10, "https://publisher.test/second"));
    expect(await resolveGoogleNewsArticleUrl(link("second"), undefined, 200)).toBe("https://publisher.test/second");
  });

  it("remembers a decoded link, so later refreshes don't ask Google again", async () => {
    modern.mockResolvedValue({ status: true, decodedUrl: "https://publisher.test/remembered" });
    legacy.mockImplementation(never);
    expect(await resolveGoogleNewsArticleUrl(link("repeat"), undefined, 200)).toBe("https://publisher.test/remembered");
    expect(await resolveGoogleNewsArticleUrl(`https://news.google.com/articles/repeat?hl=en-IN`, undefined, 200)).toBe("https://publisher.test/remembered");
    expect(modern).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
  });

  it("tries again next time when a link could not be decoded", async () => {
    modern.mockRejectedValue(new Error("timeout"));
    legacy.mockRejectedValue(new Error("timeout"));
    expect(await resolveGoogleNewsArticleUrl(link("retry"), undefined, 100)).toBe(link("retry"));
    modern.mockResolvedValue({ status: true, decodedUrl: "https://publisher.test/later" });
    expect(await resolveGoogleNewsArticleUrl(link("retry"), undefined, 100)).toBe("https://publisher.test/later");
  });

  it("doesn't start decoding once the refresh is cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await resolveGoogleNewsArticleUrl(link("cancelled"), controller.signal, 100)).toBe(link("cancelled"));
    expect(modern).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
});
