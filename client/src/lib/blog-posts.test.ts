import { describe, expect, it } from "vitest";
import { relatedPageLabel } from "@shared/audience-pages";
import { BLOG_GUIDES } from "./blog-guides";
import { BLOG_POSTS, blogPostJsonLd, blogPostSeoTitle, headingAnchor, isHeading } from "./blog-posts";

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
  it("cover the ten highest-value questions", () => {
    expect(BLOG_GUIDES).toHaveLength(10);
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
