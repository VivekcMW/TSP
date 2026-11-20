import { describe, expect, it, vi } from "vitest";
import { alertsFor, effectiveWatchTerms, matchWatchTerms, mentions, recordWatchAlertsAfterRefresh, validateWatchSelection, watchOptions } from "./watch-alerts";

const profile = {
  companies: ["Acme Bank", " acme bank ", "Zeta"],
  influencers: ["Satya Nadella"],
  keywords: [{ keyword: "Retail media", weight: 0.8 }, { keyword: "Crypto", weight: -1 }],
};

describe("watchlist options", () => {
  it("offers profile companies, people and positive topics once each", () => {
    expect(watchOptions(profile)).toEqual([
      { kind: "company", term: "Acme Bank" }, { kind: "company", term: "Zeta" },
      { kind: "person", term: "Satya Nadella" }, { kind: "topic", term: "Retail media" },
    ]);
    expect(watchOptions(null)).toEqual([]);
  });

  it("keeps only stored terms still in the profile, in the profile's spelling", () => {
    expect(effectiveWatchTerms([{ kind: "company", term: "ACME BANK" }, { kind: "company", term: "Gone Ltd" }, { kind: "person", term: "Zeta" }], profile))
      .toEqual([{ kind: "company", term: "Acme Bank" }]);
  });

  it("rejects a selection with terms outside the profile", () => {
    expect(validateWatchSelection([{ kind: "company", term: "zeta" }], profile)).toEqual([{ kind: "company", term: "Zeta" }]);
    expect(validateWatchSelection([{ kind: "company", term: "Zeta" }, { kind: "company", term: "Other" }], profile)).toBeUndefined();
  });
});

describe("watch matching", () => {
  it("matches whole words and phrases, case-insensitively", () => {
    expect(mentions("Acme Bank posts record profit", "acme bank")).toBe(true);
    expect(mentions("Acme  Bank\nposts", "Acme Bank")).toBe(true);
    expect(mentions("Acmebank posts", "Acme Bank")).toBe(false);
    expect(mentions("Zetas rise", "Zeta")).toBe(false);
    expect(mentions("Why (Zeta) matters", "Zeta")).toBe(true);
    expect(mentions("C++ tooling", "C++")).toBe(true);
  });

  it("matches headline, summary, matched keywords and typed evidence", () => {
    const terms = [{ kind: "company" as const, term: "Zeta" }, { kind: "person" as const, term: "Satya Nadella" }, { kind: "topic" as const, term: "Retail media" }];
    expect(matchWatchTerms({ id: "1", headline: "Zeta raises funds", summary: null }, terms)).toEqual([terms[0]]);
    expect(matchWatchTerms({ id: "2", headline: "Cloud news", summary: "Satya Nadella said…" }, terms)).toEqual([terms[1]]);
    expect(matchWatchTerms({ id: "3", headline: "Ads", matchedKeywords: ["retail media"] }, terms)).toEqual([terms[2]]);
    expect(matchWatchTerms({ id: "4", headline: "Ads", qualityMetadata: { relevance: { evidence: [{ type: "influencer", label: "satya nadella" }, { type: "keyword", label: "Zeta" }] } } }, terms))
      .toEqual([terms[1]]);
  });

  it("creates one alert per story and term", () => {
    const terms = [{ kind: "company" as const, term: "Zeta" }];
    expect(alertsFor([{ id: "a", headline: "Zeta and Zeta", summary: "Zeta" }, { id: "a", headline: "Zeta again" }, { id: "b", headline: "Other" }], terms))
      .toEqual([{ inboxItemId: "a", kind: "company", term: "Zeta" }]);
    expect(alertsFor([{ id: "a", headline: "Zeta" }], [])).toEqual([]);
  });
});

describe("admission hook", () => {
  it("does nothing for failed or empty refreshes and never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(recordWatchAlertsAfterRefresh({ tenantId: "t", userId: "u" }, { success: false, items: [{ id: "a", headline: "Zeta" }] })).resolves.toBeUndefined();
    await expect(recordWatchAlertsAfterRefresh({ tenantId: "t", userId: "u" }, { success: true, items: [] })).resolves.toBeUndefined();
    await expect(recordWatchAlertsAfterRefresh({ tenantId: "t", userId: "u" }, undefined)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
