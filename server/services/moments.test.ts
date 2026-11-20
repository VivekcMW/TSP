import { describe, expect, it } from "vitest";
import {
  addDays, entersLeadWindowDuring, isInLeadWindow, momentMatchesProfile, momentsForProfile, parseMomentWindow,
  profileTerms, regionForEdition, suggestedAngle, tagMatches, todayIn, type MomentRecord,
} from "./moments";

const moment = (overrides: Partial<MomentRecord> = {}): MomentRecord => ({
  id: "m1", title: "Union Budget", startsOn: "2027-02-01", endsOn: null, region: "global", tags: ["finance"], leadDays: 14,
  url: null, description: null, ...overrides,
});
const profile = { keywords: [{ keyword: "Retail media", weight: 0.9 }, { keyword: "Crypto", weight: -0.5 }], companies: ["Acme Bank"],
  recommendedIndustry: "finance_banking", searchEdition: "en-IN" };

describe("moment matching", () => {
  it("maps search editions to moment regions", () => {
    expect(regionForEdition("en-IN")).toBe("IN");
    expect(regionForEdition("hi-IN")).toBe("IN");
    expect(regionForEdition("en-GB")).toBe("UK");
    expect(regionForEdition("en-US")).toBe("US");
    expect(regionForEdition("de-DE")).toBe("EU");
    expect(regionForEdition("en-AU")).toBe("AU");
    expect(regionForEdition(null)).toBeNull();
    expect(regionForEdition("xx-XX")).toBeNull();
  });

  it("matches tags as whole words against keywords, companies and the industry, ignoring negative keywords", () => {
    const terms = profileTerms(profile);
    expect(tagMatches("retail", terms)).toBe(true);
    expect(tagMatches("retail media", terms)).toBe(true);
    expect(tagMatches("Retail Media Week", terms)).toBe(true);
    expect(tagMatches("bank", terms)).toBe(true);
    expect(tagMatches("finance", terms)).toBe(true);
    expect(tagMatches("banking", terms)).toBe(true);
    expect(tagMatches("ret", terms)).toBe(false);
    expect(tagMatches("crypto", terms)).toBe(false);
    expect(tagMatches("healthcare", terms)).toBe(false);
  });

  it("matches the recommended industry only on whole industry phrases, never on one word of the slug", () => {
    const industry = (recommendedIndustry: string) => profileTerms({ recommendedIndustry });
    // False positives from splitting slugs into single words.
    expect(tagMatches("real time marketing", industry("real_estate"))).toBe(false);
    expect(tagMatches("public relations", industry("government_public"))).toBe(false);
    expect(tagMatches("health technology", industry("technology_saas"))).toBe(false);
    expect(tagMatches("estate", industry("real_estate"))).toBe(false);
    expect(tagMatches("public", industry("government_public"))).toBe(false);
    expect(tagMatches("intellectual property", industry("real_estate"))).toBe(false);
    expect(tagMatches("anything", industry("other"))).toBe(false);
    // Real matches.
    expect(tagMatches("real estate", industry("real_estate"))).toBe(true);
    expect(tagMatches("Commercial Real Estate", industry("real_estate"))).toBe(true);
    expect(tagMatches("proptech", industry("real_estate"))).toBe(true);
    expect(tagMatches("public sector", industry("government_public"))).toBe(true);
    expect(tagMatches("government", industry("government_public"))).toBe(true);
    expect(tagMatches("saas", industry("technology_saas"))).toBe(true);
    expect(tagMatches("enterprise software", industry("technology_saas"))).toBe(true);
    expect(tagMatches("e-commerce", industry("ecommerce_retail"))).toBe(true);
  });

  it("does not match a moment on an industry word alone", () => {
    const realEstate = { recommendedIndustry: "real_estate", searchEdition: "en-US" };
    expect(momentMatchesProfile(moment({ tags: ["real time marketing"] }), realEstate)).toBe(false);
    expect(momentMatchesProfile(moment({ tags: ["public relations"] }), { recommendedIndustry: "government_public" })).toBe(false);
    expect(momentMatchesProfile(moment({ tags: ["health technology"] }), { recommendedIndustry: "technology_saas" })).toBe(false);
    expect(momentMatchesProfile(moment({ tags: ["real estate"] }), realEstate)).toBe(true);
  });

  it("requires a global or matching region and a matching tag (or 'all')", () => {
    expect(momentMatchesProfile(moment(), profile)).toBe(true);
    expect(momentMatchesProfile(moment({ region: "IN" }), profile)).toBe(true);
    expect(momentMatchesProfile(moment({ region: "US" }), profile)).toBe(false);
    expect(momentMatchesProfile(moment({ tags: ["healthcare"] }), profile)).toBe(false);
    expect(momentMatchesProfile(moment({ tags: ["healthcare", "ALL"] }), profile)).toBe(true);
    expect(momentMatchesProfile(moment({ tags: [] }), profile)).toBe(false);
    expect(momentMatchesProfile(moment({ tags: ["all"], region: "UK" }), { searchEdition: "en-GB" })).toBe(true);
    expect(momentMatchesProfile(moment({ tags: ["finance"] }), null)).toBe(false);
  });
});

describe("lead windows and dates", () => {
  it("is in the lead window from leadDays before the start through the last day", () => {
    const budget = moment({ startsOn: "2027-02-01", endsOn: "2027-02-03", leadDays: 14 });
    expect(isInLeadWindow(budget, "2027-01-17")).toBe(false);
    expect(isInLeadWindow(budget, "2027-01-18")).toBe(true);
    expect(isInLeadWindow(budget, "2027-02-03")).toBe(true);
    expect(isInLeadWindow(budget, "2027-02-04")).toBe(false);
    expect(isInLeadWindow(moment({ startsOn: "2027-02-01", leadDays: 1 }), "2027-02-01")).toBe(true);
  });

  it("finds moments whose lead window opens, or which start, during a week", () => {
    expect(entersLeadWindowDuring(moment({ startsOn: "2027-02-01", leadDays: 14 }), "2027-01-18", "2027-01-24")).toBe(true);
    expect(entersLeadWindowDuring(moment({ startsOn: "2027-02-01", leadDays: 14 }), "2027-01-25", "2027-01-31")).toBe(false);
    expect(entersLeadWindowDuring(moment({ startsOn: "2027-02-01", leadDays: 30 }), "2027-02-01", "2027-02-07")).toBe(true);
  });

  it("does calendar arithmetic across months and DST-free UTC dates", () => {
    expect(addDays("2027-02-27", 2)).toBe("2027-03-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(todayIn("Asia/Kolkata", new Date("2026-11-16T20:00:00Z"))).toBe("2026-11-17");
    expect(todayIn("Not/AZone", new Date("2026-11-16T20:00:00Z"))).toBe("2026-11-16");
  });

  it("defaults the window to today..+60 and caps it at 120 days", () => {
    expect(parseMomentWindow({}, "2026-11-16")).toEqual({ from: "2026-11-16", to: "2027-01-15" });
    expect(parseMomentWindow({ from: "2026-12-01" }, "2026-11-16")).toEqual({ from: "2026-12-01", to: "2027-01-30" });
    expect(parseMomentWindow({ from: "2026-11-16", to: "2027-03-16" }, "2026-11-16")).toEqual({ from: "2026-11-16", to: "2027-03-16" });
    expect(parseMomentWindow({ from: "2026-11-16", to: "2027-03-17" }, "2026-11-16")).toBeUndefined();
    expect(parseMomentWindow({ from: "2026-11-16", to: "2026-11-15" }, "2026-11-16")).toBeUndefined();
    expect(parseMomentWindow({ from: "2026-02-30" }, "2026-11-16")).toBeUndefined();
    expect(parseMomentWindow({ from: ["2026-11-16", "2026-11-17"] }, "2026-11-16")).toBeUndefined();
  });
});

describe("moment views", () => {
  it("returns the contract shape sorted by date, with category, angle and lead window", () => {
    const views = momentsForProfile([
      moment({ id: "late", title: "Diwali retail rush", startsOn: "2026-12-20", tags: ["retail", "festive"], url: "https://example.test/diwali" }),
      moment({ id: "early", title: "Year-end close", startsOn: "2026-11-20", endsOn: "2026-11-22", tags: ["all", "finance"], leadDays: 7 }),
      moment({ id: "outside", startsOn: "2027-03-01" }),
      moment({ id: "elsewhere", startsOn: "2026-11-25", region: "US" }),
    ], profile, { from: "2026-11-16", to: "2027-01-15", today: "2026-11-16" });
    expect(views).toEqual([
      { id: "early", title: "Year-end close", date: "2026-11-20", endDate: "2026-11-22", leadDays: 7, category: "finance", url: null, description: null,
        suggestedAngle: "What Year-end close means for finance teams", inLeadWindow: true },
      { id: "late", title: "Diwali retail rush", date: "2026-12-20", endDate: null, leadDays: 14, category: "retail", url: "https://example.test/diwali", description: null,
        suggestedAngle: "What Diwali retail rush means for finance teams", inLeadWindow: false },
    ]);
  });

  it("falls back to 'your clients' and the 'general' category", () => {
    expect(suggestedAngle(" Budget Day ", { recommendedIndustry: "other" })).toBe("What Budget Day means for your clients");
    expect(momentsForProfile([moment({ tags: ["all"] })], null, { from: "2027-01-01", to: "2027-02-28", today: "2027-01-01" })[0].category).toBe("general");
  });
});
