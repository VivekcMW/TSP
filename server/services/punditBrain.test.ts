import { describe, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("./openRouter", () => ({ generateText }));

import { analyzeProfessionalIdentity } from "./punditBrain";

describe("professional identity analysis", () => {
  it("uses curated recommendations when the model returns malformed JSON", async () => {
    generateText.mockResolvedValue('{"primaryIndustry":"Technology & SaaS", broken');

    const analysis = await analyzeProfessionalIdentity("I build SaaS products and lead technical teams.", "technology_saas");

    expect(analysis.primaryIndustry).toBe("Technology & SaaS");
    expect(analysis.keywords.length).toBeGreaterThan(20);
    expect(analysis.publications.length).toBeGreaterThan(5);
  });
});
