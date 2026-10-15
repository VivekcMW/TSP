import { describe, expect, it } from "vitest";
import { USE_CASES } from "./use-cases";
import { AUDIENCE_INDEX } from "./audience-index";
import {
  AUDIENCE_SECTIONS, AUDIENCE_WORKFLOW, allAudiencePages, audiencePageJsonLd, getAudiencePage, relatedPageLabel,
  type AudiencePage,
} from "./audience-pages";

const pages = allAudiencePages();
const BRAND = " | TheSocialPundit";
const STOP_WORDS = new Set(["&", "and", "for", "the", "of", "on", "a", "in", "your", "by"]);

function pageText(page: AudiencePage) {
  return [
    page.label, page.eyebrow, page.headline, page.introduction, page.challengeTitle, ...page.challenge,
    ...page.outcomes.flatMap(outcome => [outcome.title, outcome.description]),
    ...page.postIdeas, ...page.faqs.flatMap(faq => [faq.question, faq.answer]),
    ...AUDIENCE_WORKFLOW.flatMap(step => [step.title, step.description]),
  ].join(" ");
}

describe("role and industry pages", () => {
  it("cover every role and every industry", () => {
    expect(AUDIENCE_SECTIONS.roles.pages.map(page => page.slug)).toEqual([
      "executives", "founders", "consultants", "sales-professionals", "marketing-professionals",
      "recruiters", "agency-leaders", "analysts-investors",
    ]);
    expect(AUDIENCE_SECTIONS.industries.pages.map(page => page.slug)).toEqual([
      "advertising-media", "technology-saas", "financial-services", "healthcare-life-sciences", "retail-ecommerce",
      "marketing-technology", "consulting-professional-services", "legal-services", "hospitality-travel",
      "real-estate", "education-edtech", "manufacturing-supply-chain", "hr-future-of-work",
    ]);
  });

  it("keeps the lightweight link index in step with the page content", () => {
    for (const kind of ["roles", "industries"] as const) {
      expect(AUDIENCE_INDEX[kind].pages).toEqual(AUDIENCE_SECTIONS[kind].pages.map(({ slug, label }) => ({ slug, label })));
    }
  });

  it.each(pages.map(entry => [entry.path, entry.page] as const))("%s has a search-friendly title and description", (_path, page) => {
    expect(page.seoTitle.endsWith(BRAND)).toBe(true);
    // Search results truncate titles at roughly 580px, about 60 characters.
    expect(page.seoTitle.length).toBeLessThanOrEqual(60);
    expect(page.metaDescription.length).toBeGreaterThanOrEqual(110);
    expect(page.metaDescription.length).toBeLessThanOrEqual(160);
  });

  it.each(pages.map(entry => [entry.path, entry.page] as const))("%s uses every title word in its copy", (_path, page) => {
    const text = pageText(page).toLowerCase();
    const words = page.seoTitle.replace(BRAND, "").toLowerCase().split(/[^a-z-]+/).filter(word => word && !STOP_WORDS.has(word));
    expect(words.filter(word => !text.includes(word))).toEqual([]);
  });

  it.each(pages.map(entry => [entry.path, entry.page] as const))("%s has enough substance to be worth indexing", (_path, page) => {
    expect(page.challenge.length).toBeGreaterThanOrEqual(2);
    expect(page.outcomes).toHaveLength(3);
    expect(page.postIdeas).toHaveLength(6);
    expect(page.faqs.length).toBeGreaterThanOrEqual(4);
    expect(pageText(page).split(/\s+/).length).toBeGreaterThanOrEqual(400);
  });

  it("never duplicates a title, description or headline across the site", () => {
    const titles = [...pages.map(entry => entry.page.seoTitle), ...USE_CASES.map(useCase => useCase.seoTitle)];
    const descriptions = pages.map(entry => entry.page.metaDescription);
    const headlines = pages.map(entry => entry.page.headline);
    for (const values of [titles, descriptions, headlines]) expect(new Set(values).size).toBe(values.length);
  });

  it("links only to real pages, never to itself", () => {
    for (const { path, page } of pages) {
      expect(page.related.length).toBeGreaterThanOrEqual(3);
      for (const target of page.related) {
        expect(target, `${path} links to itself`).not.toBe(path);
        expect(relatedPageLabel(target), `${path} links to unknown ${target}`).toBeDefined();
      }
    }
  });

  it("promises only what the product does", () => {
    for (const { path, page } of pages) {
      const text = pageText(page);
      expect(text, path).not.toMatch(/autopilot|guarantee|fully automat|go viral|\b10x\b/i);
    }
  });

  it("describes every FAQ in structured data", () => {
    const page = getAudiencePage("roles", "executives")!;
    const [, breadcrumbs, faq] = audiencePageJsonLd("roles", page) as Array<Record<string, any>>;
    expect(breadcrumbs.itemListElement[1].item).toBe("https://www.thesocialpundit.com/roles");
    expect(faq.mainEntity).toHaveLength(page.faqs.length);
  });
});
