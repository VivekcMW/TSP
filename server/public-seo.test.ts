import { describe, expect, it } from "vitest";
import { BLOG_POSTS, blogPostSeoTitle } from "../client/src/lib/blog-posts";
import { publicSeoForPath, renderInitialSeo, sitemapEntries } from "./public-seo";
import { USE_CASES } from "../shared/use-cases";
import { allAudiencePages } from "../shared/audience-pages";

const template = `<!doctype html><html><head>
<meta name="description" content="default" />
<meta property="og:title" content="default" />
<meta property="og:description" content="default" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://www.thesocialpundit.com" />
<meta property="og:image" content="default.jpg" />
<meta name="twitter:title" content="default" />
<meta name="twitter:description" content="default" />
<meta name="twitter:image" content="default.jpg" />
<link rel="canonical" href="https://www.thesocialpundit.com" />
<title>Default</title>
<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>
</head><body></body></html>`;

describe("public initial SEO", () => {
  it("returns distinct metadata for every public marketing route", () => {
    const home = publicSeoForPath("/")!;
    const pricing = publicSeoForPath("/pricing")!;
    const blog = publicSeoForPath("/blog")!;
    expect(new Set([home.title, pricing.title, blog.title])).toHaveLength(3);
    expect(pricing.canonical).toBe("https://www.thesocialpundit.com/pricing");
  });

  it("keeps the homepage title short enough to show in full in search results", () => {
    // Search results truncate titles at roughly 580px, about 60 characters.
    expect(publicSeoForPath("/")!.title.length).toBeLessThanOrEqual(60);
  });

  it("renders article metadata and schema before JavaScript runs", () => {
    const post = BLOG_POSTS[0];
    const result = renderInitialSeo(template, `/blog/${post.slug}`);
    expect(result.indexable).toBe(true);
    expect(result.html).toContain(`<title data-rh="true">${blogPostSeoTitle(post)}</title>`);
    expect(result.html).toContain(`href="https://www.thesocialpundit.com/blog/${post.slug}"`);
    expect(result.html).toContain('content="article"');
    expect(result.html).toContain('"@type":"Article"');
    expect(result.html).toContain('"@type":"BreadcrumbList"');
    expect(result.html).not.toContain("<title>Default</title>");
  });

  it("marks unknown and invalid article routes as non-indexable", () => {
    expect(renderInitialSeo(template, "/not-real").indexable).toBe(false);
    expect(renderInitialSeo(template, "/blog/not-real").indexable).toBe(false);
  });

  it("escapes metadata before inserting it into HTML", () => {
    const post = BLOG_POSTS.find(candidate => candidate.title.includes("Didn't")) ?? BLOG_POSTS[0];
    const result = renderInitialSeo(template, `/blog/${post.slug}`);
    expect(result.html).not.toContain("<script>alert");
    expect(result.indexable).toBe(true);
  });

  it("renders focused use-case metadata and FAQ schema before JavaScript runs", () => {
    const useCase = USE_CASES[0];
    const result = renderInitialSeo(template, `/use-cases/${useCase.slug}`);
    expect(result.indexable).toBe(true);
    expect(result.html).toContain(`<title data-rh="true">${useCase.seoTitle}</title>`);
    expect(result.html).toContain(`href="https://www.thesocialpundit.com/use-cases/${useCase.slug}"`);
    expect(result.html).toContain('"@type":"WebPage"');
    expect(result.html).toContain('"@type":"FAQPage"');
    expect(result.html).toContain('data-rh="true"');
  });
});

describe("role and industry pages", () => {
  it("render their own metadata, breadcrumbs and FAQ schema before JavaScript runs", () => {
    for (const { path, page } of allAudiencePages()) {
      const result = renderInitialSeo(template, path);
      expect(result.indexable, path).toBe(true);
      expect(result.html).toContain(`<title data-rh="true">${page.seoTitle.replaceAll("&", "&amp;")}</title>`);
      expect(result.html).toContain(`href="https://www.thesocialpundit.com${path}"`);
      expect(result.html).toContain('"@type":"BreadcrumbList"');
      expect(result.html).toContain('"@type":"FAQPage"');
    }
  });

  it("render hub pages as collections of their pages", () => {
    const result = renderInitialSeo(template, "/industries");
    expect(result.html).toContain('"@type":"CollectionPage"');
    expect(result.html).toContain("https://www.thesocialpundit.com/industries/advertising-media");
  });

  it("do not index unknown slugs", () => {
    expect(renderInitialSeo(template, "/roles/astronauts").indexable).toBe(false);
    expect(renderInitialSeo(template, "/industries/not-real").indexable).toBe(false);
  });
});

describe("canonical URLs", () => {
  it("gives the homepage a trailing slash so it matches the sitemap entry", () => {
    expect(publicSeoForPath("/")!.canonical).toBe("https://www.thesocialpundit.com/");
    expect(sitemapEntries()[0].loc).toBe("https://www.thesocialpundit.com/");
  });

  it("treats a trailing slash on an inner page as the same canonical URL", () => {
    expect(publicSeoForPath("/pricing/")!.canonical).toBe(publicSeoForPath("/pricing")!.canonical);
  });
});
