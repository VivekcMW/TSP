import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { crawl } = vi.hoisted(() => ({ crawl: vi.fn() }));
vi.mock("./crawlerFetch", async original => ({ ...await original<typeof import("./crawlerFetch")>(), fetchPublicText: crawl }));
import { CrawlError } from "./crawlerFetch";
import { forgetRobots, isAllowedByRobots, parseRobots } from "./robots";

const rules = `
User-agent: Googlebot
Disallow: /private/

User-agent: *
Disallow: /admin/
Disallow: /search
Allow: /admin/public/

User-agent: TheSocialPundit
Disallow: /members/
`;

beforeEach(() => { vi.resetAllMocks(); forgetRobots(); });
afterEach(() => vi.restoreAllMocks());

describe("parseRobots", () => {
  it("applies our own group when the file names us, otherwise the wildcard group", () => {
    const ours = parseRobots(rules, "TheSocialPundit");
    expect(ours.allows("/members/area")).toBe(false);
    expect(ours.allows("/admin/settings")).toBe(true);
    const generic = parseRobots(rules, "OtherBot");
    expect(generic.allows("/admin/settings")).toBe(false);
    expect(generic.allows("/admin/public/page")).toBe(true);
    expect(generic.allows("/search?q=x")).toBe(false);
    expect(generic.allows("/news/story")).toBe(true);
  });

  it("allows everything for an empty file or one with no matching group", () => {
    expect(parseRobots("", "TheSocialPundit").allows("/anything")).toBe(true);
    expect(parseRobots("User-agent: Googlebot\nDisallow: /", "TheSocialPundit").allows("/anything")).toBe(true);
  });

  it("understands wildcards and end anchors", () => {
    const parsed = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/", "TheSocialPundit");
    expect(parsed.allows("/files/report.pdf")).toBe(false);
    expect(parsed.allows("/files/report.pdf.html")).toBe(true);
    expect(parsed.allows("/tmp-old/x")).toBe(false);
  });
});

describe("isAllowedByRobots", () => {
  it("fetches each host's robots.txt once and remembers the answer", async () => {
    crawl.mockResolvedValue({ url: "https://news.test/robots.txt", text: "User-agent: *\nDisallow: /paywall/", status: 200, headers: new Headers() });
    expect(await isAllowedByRobots("https://news.test/paywall/story")).toBe(false);
    expect(await isAllowedByRobots("https://news.test/news/story")).toBe(true);
    expect(await isAllowedByRobots("https://news.test/feed.xml")).toBe(true);
    expect(crawl).toHaveBeenCalledTimes(1);
    expect(crawl.mock.calls[0][0]).toBe("https://news.test/robots.txt");
  });

  it("treats a missing or unreachable robots.txt as permission, without retrying every time", async () => {
    crawl.mockRejectedValue(new CrawlError("http", "The source returned HTTP 404."));
    expect(await isAllowedByRobots("https://news.test/story")).toBe(true);
    expect(await isAllowedByRobots("https://news.test/other")).toBe(true);
    expect(crawl).toHaveBeenCalledTimes(1);
  });
});
