import { describe, expect, it } from "vitest";
import { relatedPageLabel } from "./audience-pages";
import { COMPARE_HUB, COMPARISONS, COMPARISONS_CHECKED, comparisonJsonLd, US } from "./comparisons";

const vendorDomains: Record<string, string> = {
  taplio: "taplio.com", authoredup: "authoredup.com", buffer: "buffer.com", hootsuite: "hootsuite.com",
  jasper: "jasper.ai", "copy-ai": "copy.ai", feedly: "feedly.com", authory: "authory.com",
};

describe("comparison pages", () => {
  it("cover every competitor in the keyword plan", () => {
    expect(COMPARISONS.map(page => page.slug)).toEqual(Object.keys(vendorDomains));
  });

  it.each(COMPARISONS.map(page => [page.slug, page] as const))("%s has a search-friendly title and description", (_slug, page) => {
    expect(page.seoTitle).toContain(`TheSocialPundit vs ${page.competitor}`);
    expect(page.seoTitle.length).toBeLessThanOrEqual(60);
    expect(page.metaDescription.length).toBeGreaterThanOrEqual(110);
    expect(page.metaDescription.length).toBeLessThanOrEqual(160);
  });

  it.each(COMPARISONS.map(page => [page.slug, page] as const))("%s is fair and sourced from the vendor's own site", (slug, page) => {
    expect(page.sources.length).toBeGreaterThanOrEqual(2);
    for (const source of page.sources) expect(new URL(source).hostname.replace(/^www\./, "")).toBe(vendorDomains[slug]);
    // Says when the competitor is the better choice, not just when we are.
    expect(page.chooseCompetitorIf.length).toBeGreaterThanOrEqual(3);
    expect(page.verdict).toContain(`Choose ${page.competitor}`);
    expect(page.rows.length).toBeGreaterThanOrEqual(6);
    expect(page.faqs.length).toBeGreaterThanOrEqual(3);
  });

  it("never quotes competitor prices or makes unverifiable superlatives", () => {
    for (const page of COMPARISONS) {
      const text = JSON.stringify(page);
      expect(text, page.slug).not.toMatch(/[$€£₹]\s?\d|\/mo\b|per month/i);
      expect(text, page.slug).not.toMatch(/#1|number one|cheapest|guarantee|best-known|\bthe best\b|\bbest (tool|choice|alternative|option)\b/i);
    }
  });

  it("describes TheSocialPundit the same way on every page", () => {
    for (const page of COMPARISONS) {
      const ours = page.rows.map(row => row.theSocialPundit);
      expect(ours.some(cell => Object.values(US).includes(cell as (typeof US)[keyof typeof US])), page.slug).toBe(true);
    }
    expect(US.analytics).toMatch(/aren't a focus/);
  });

  it("dates every page and marks it up as an FAQ", () => {
    expect(COMPARISONS_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [page, breadcrumbs, faq] = comparisonJsonLd(COMPARISONS[0]) as Array<Record<string, any>>;
    expect(page.dateModified).toBe(COMPARISONS_CHECKED);
    expect(breadcrumbs.itemListElement[1].item).toBe(`https://www.thesocialpundit.com${COMPARE_HUB.path}`);
    expect(faq.mainEntity).toHaveLength(COMPARISONS[0].faqs.length);
  });

  it("keeps the hub title short", () => {
    expect(`${COMPARE_HUB.seoTitle} | TheSocialPundit`.length).toBeLessThanOrEqual(60);
    expect(relatedPageLabel("/compare/taplio")).toBeUndefined();
  });
});
