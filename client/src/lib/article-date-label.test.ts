import { describe, expect, it } from "vitest";
import type { ArticleQuality } from "@shared/article-quality";
import { articleDateLabel } from "./article-date-label";
const item = { publishedAt: null, discoveredAt: null, createdAt: null, qualityMetadata: null };
describe("honest article date labels", () => {
  it("does not invent a date for missing or invalid legacy values", () => {
    expect(articleDateLabel(item)).toBe("Publication date unknown");
    expect(articleDateLabel({ ...item, createdAt: new Date("bad") })).toBe("Publication date unknown");
    expect(articleDateLabel({ ...item, createdAt: new Date("2020-01-01") })).toMatch(/^Added .*Publication date unknown$/);
  });
  it("shows date-only precision without timezone conversion and validated instants as Published", () => {
    const qualityMetadata = { date: { quality: "valid", precision: "day", day: "2020-01-01" } } as ArticleQuality;
    expect(articleDateLabel({ ...item, qualityMetadata })).toBe("Published 2020-01-01 (date only)");
    expect(articleDateLabel({ ...item, publishedAt: new Date("2020-01-01"), qualityMetadata: { ...qualityMetadata, date: { ...qualityMetadata.date, precision: "instant" } } })).toMatch(/^Published /);
  });
});