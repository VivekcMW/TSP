import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BLOG_POSTS } from "../client/src/lib/blog-posts";
import { sitemapEntries } from "../server/public-seo";
import { parseRobots } from "../server/services/robots";
import { INDEXNOW_KEY, indexNowPayload, submitToIndexNow } from "../scripts/indexnow-submit";
import { generateLlmsFullTxt, generateLlmsTxt, generateRss, markupToText } from "./discovery-files";

const publicFile = (name: string) => readFileSync(resolve("client/public", name), "utf8");

describe("llms.txt", () => {
  const llms = generateLlmsTxt();

  it("links every public page in the sitemap except the sitemap page itself", () => {
    for (const { loc } of sitemapEntries()) {
      if (loc.endsWith("/sitemap")) continue;
      expect(llms, loc).toContain(`](${loc})`);
    }
  });

  it("states the facts AI answers most often get wrong", () => {
    expect(llms).toMatch(/^# TheSocialPundit\n\n> /);
    expect(llms).toContain("Nothing is published without the user's action");
    expect(llms).toContain("do not infer them");
  });

  it("is committed in its generated form", () => {
    expect(publicFile("llms.txt")).toBe(llms);
  });
});

describe("rss.xml", () => {
  const rss = generateRss();

  it("lists every journal article with a permalink and date", () => {
    expect(rss.match(/<item>/g)).toHaveLength(BLOG_POSTS.length);
    for (const post of BLOG_POSTS) {
      expect(rss).toContain(`<guid isPermaLink="true">https://www.thesocialpundit.com/blog/${post.slug}</guid>`);
    }
    expect(rss).not.toMatch(/Invalid Date/);
  });

  it("escapes text and is committed in its generated form", () => {
    expect(rss).not.toMatch(/<title>[^<]*&(?!amp;|lt;|gt;|quot;)/);
    expect(publicFile("rss.xml")).toBe(rss);
  });
});

describe("llms-full.txt", () => {
  it("keeps the page's text and heading structure, without markup", () => {
    const full = generateLlmsFullTxt({ "/": "<header>SiteMenuLink</header><main><h1>Turn what you know</h1><p>Real &amp; useful copy.</p></main>" });
    expect(full).toContain("URL: https://www.thesocialpundit.com/");
    expect(full).toContain("# Turn what you know");
    expect(full).toContain("Real & useful copy.");
    expect(full).not.toContain("SiteMenuLink");
    expect(markupToText("<p>a</p><svg><path d='x'/></svg><p>b</p>")).toBe("a\nb");
  });
});

describe("robots.txt", () => {
  const robots = publicFile("robots.txt");
  const crawlers = ["Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot", "SomeNewBot"];

  it.each(crawlers)("lets %s read public pages but not the private app", agent => {
    const rules = parseRobots(robots, agent);
    for (const path of ["/", "/blog/how-to-build-a-personal-brand", "/roles/executives", "/compare/taplio", "/llms.txt"]) expect(rules.allows(path), path).toBe(true);
    for (const path of ["/dashboard", "/dashboard/create", "/admin", "/onboarding", "/api/me"]) expect(rules.allows(path), path).toBe(false);
  });

  it("points crawlers to the sitemap", () => {
    expect(robots).toContain("Sitemap: https://www.thesocialpundit.com/sitemap.xml");
  });
});

describe("IndexNow", () => {
  it("serves the verification key from the site root", () => {
    expect(publicFile(`${INDEXNOW_KEY}.txt`)).toBe(INDEXNOW_KEY);
  });

  it("submits every sitemap URL for the canonical host", () => {
    const payload = indexNowPayload();
    expect(payload.host).toBe("www.thesocialpundit.com");
    expect(payload.keyLocation).toBe(`https://www.thesocialpundit.com/${INDEXNOW_KEY}.txt`);
    expect(payload.urlList).toEqual(sitemapEntries().map(entry => entry.loc));
    expect(payload.urlList.every(url => url.startsWith("https://www.thesocialpundit.com/"))).toBe(true);
  });

  it("treats 200 and 202 as accepted and anything else as a failure", async () => {
    const accepted = vi.fn(async () => new Response(null, { status: 202 }));
    await expect(submitToIndexNow(accepted as unknown as typeof fetch)).resolves.toMatchObject({ status: 202 });
    const body = JSON.parse((accepted.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.key).toBe(INDEXNOW_KEY);
    const rejected = vi.fn(async () => new Response("bad key", { status: 403 }));
    await expect(submitToIndexNow(rejected as unknown as typeof fetch)).rejects.toThrow(/403/);
  });
});
