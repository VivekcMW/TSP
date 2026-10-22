import { describe, expect, it } from "vitest";
import { relatedPageLabel } from "@shared/audience-pages";
import { BLOG_GUIDES } from "./blog-guides";
import { FREE_TOOLS } from "@shared/free-tools";
import { FREE_TOOL_LINKS } from "./free-tool-links";
import { BLOG_POSTS, blogPostJsonLd, blogPostSeoTitle, blogPostTools, getBlogPost, headingAnchor, isHeading } from "./blog-posts";

describe("journal", () => {
  it("has unique slugs, newest first", () => {
    const slugs = BLOG_POSTS.map(post => post.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const dates = BLOG_POSTS.map(post => post.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it.each(BLOG_POSTS.map(post => [post.slug, post] as const))("%s has a title search results show in full", (_slug, post) => {
    expect(blogPostSeoTitle(post).length).toBeLessThanOrEqual(60);
    expect(post.excerpt.length).toBeLessThanOrEqual(160);
  });
});

describe("how-to guides", () => {
  it("cover the highest-value questions", () => {
    expect(BLOG_GUIDES).toHaveLength(12);
  });

  it("only suggest free tools that exist", () => {
    const tools = new Set(FREE_TOOLS.map(tool => tool.path));
    for (const post of BLOG_POSTS) {
      for (const path of post.relatedTools ?? []) expect(tools.has(path), `${post.slug}: ${path}`).toBe(true);
      expect(blogPostTools(post)).toHaveLength(2);
    }
    expect(blogPostTools(getBlogPost("how-to-write-a-linkedin-hook")!)[0].path).toBe("/tools/linkedin-hook-generator");
  });

  it("homepage links cover every free tool", () => {
    expect(FREE_TOOL_LINKS.map(link => link.href)).toEqual(FREE_TOOLS.map(tool => tool.path));
  });

  it.each(BLOG_GUIDES.map(guide => [guide.slug, guide] as const))("%s answers first and is structured for search and AI", (_slug, guide) => {
    expect(guide.summary!.split(/\s+/).length).toBeGreaterThanOrEqual(30);
    const headings = guide.content.filter(isHeading);
    expect(headings.length).toBeGreaterThanOrEqual(4);
    expect(new Set(headings.map(headingAnchor)).size).toBe(headings.length);
    expect(isHeading(guide.content[0])).toBe(false);
    expect(guide.faqs!.length).toBeGreaterThanOrEqual(3);
    const article = [guide.summary, ...guide.content, ...guide.faqs!.flatMap(faq => [faq.question, faq.answer])].join(" ");
    expect(article.split(/\s+/).length).toBeGreaterThanOrEqual(550);
    for (const path of guide.relatedPages!) expect(relatedPageLabel(path), path).toBeDefined();
  });

  it("never invents statistics or guarantees", () => {
    for (const guide of BLOG_GUIDES) {
      const text = [guide.summary, ...guide.content, ...guide.faqs!.flatMap(faq => [faq.question, faq.answer])].join(" ");
      expect(text, guide.slug).not.toMatch(/\d+(\.\d+)?\s?%|studies show|research shows|guarantee|go viral/i);
    }
  });

  it("marks up FAQs and real dates", () => {
    const guide = BLOG_GUIDES[0];
    const schema = blogPostJsonLd(guide) as Array<Record<string, any>>;
    expect(schema[0]).toMatchObject({ "@type": "Article", datePublished: guide.date, dateModified: guide.date });
    expect(schema.find(item => item["@type"] === "FAQPage")!.mainEntity).toHaveLength(guide.faqs!.length);
    expect(blogPostJsonLd({ ...guide, faqs: undefined }).some(item => item["@type"] === "FAQPage")).toBe(false);
  });
});
