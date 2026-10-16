import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOG_POSTS } from "../client/src/lib/blog-posts";
import { publicSeoForPath, sitemapEntries } from "../server/public-seo";
import { generateSitemap } from "./generate-search-files";
import { USE_CASES } from "../shared/use-cases";
import { allAudiencePages } from "../shared/audience-pages";
import { COMPARISONS } from "../shared/comparisons";

const SITE_URL = "https://www.thesocialpundit.com";

describe("search discovery files", () => {
  it("generates canonical public URLs and every journal article", () => {
    const sitemap = generateSitemap();
    expect(sitemap).toContain("<loc>https://www.thesocialpundit.com/</loc>");
    expect(sitemap).toContain("<loc>https://www.thesocialpundit.com/pricing</loc>");
    expect(sitemap).toContain("<loc>https://www.thesocialpundit.com/sitemap</loc>");
    for (const useCase of USE_CASES) {
      expect(sitemap).toContain(`<loc>https://www.thesocialpundit.com/use-cases/${useCase.slug}</loc>`);
    }
    for (const hub of ["/roles", "/industries"]) expect(sitemap).toContain(`<loc>https://www.thesocialpundit.com${hub}</loc>`);
    for (const { path } of allAudiencePages()) expect(sitemap).toContain(`<loc>https://www.thesocialpundit.com${path}</loc>`);
    for (const post of BLOG_POSTS) {
      expect(sitemap).toContain(`<loc>https://www.thesocialpundit.com/blog/${post.slug}</loc>`);
      expect(sitemap).toContain(`<lastmod>${post.date}</lastmod>`);
    }
  });

  it("excludes private, auth, and removed marketing routes", () => {
    const sitemap = generateSitemap();
    for (const path of ["/dashboard", "/admin", "/sign-in", "/sign-up", "/resources"]) {
      expect(sitemap).not.toContain(`<loc>https://www.thesocialpundit.com${path}</loc>`);
    }
  });
});

describe("sitemap and page metadata stay in sync", () => {
  it("lists only URLs the server can serve indexable metadata for", () => {
    for (const entry of sitemapEntries()) {
      expect(entry.loc.startsWith(`${SITE_URL}/`)).toBe(true);
      const pathname = entry.loc.slice(SITE_URL.length);
      expect(publicSeoForPath(pathname), `no metadata for ${pathname}`).toBeDefined();
    }
  });

  it("covers every public page and article exactly once", () => {
    const locs = sitemapEntries().map(entry => entry.loc);
    expect(new Set(locs).size).toBe(locs.length);
    expect(locs).toHaveLength(16 + USE_CASES.length + 2 + allAudiencePages().length + 1 + COMPARISONS.length + BLOG_POSTS.length);
  });

  it("emits a well-formed urlset with a single root", () => {
    const sitemap = generateSitemap();
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(sitemap.match(/<url>/g)).toHaveLength(sitemapEntries().length);
    expect(sitemap.match(/<urlset/g)).toHaveLength(1);
    expect(sitemap.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("gives every URL a real calendar date and drops hints Google ignores", () => {
    const sitemap = generateSitemap();
    for (const entry of sitemapEntries()) {
      expect(entry.lastmod, entry.loc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.lastmod)), entry.loc).toBe(false);
    }
    expect(sitemap).not.toContain("<changefreq>");
    expect(sitemap).not.toContain("<priority>");
  });

  it("is committed in its generated form", () => {
    expect(readFileSync(resolve("client/public/sitemap.xml"), "utf8")).toBe(generateSitemap());
  });
});
