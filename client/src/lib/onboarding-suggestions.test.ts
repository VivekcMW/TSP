import { describe, expect, it } from "vitest";
import { choiceKey, defaultSearchEdition, evidenceLabel, parseOnboardingSuggestions } from "./onboarding-suggestions";

describe("onboarding suggestion responses", () => {
  it("keeps valid publications with safe URLs and drops malformed entries individually", () => {
    expect(parseOnboardingSuggestions("publications", {
      step: "publications", grounded: true, items: [
        { name: " ExchangeWire ", url: "https://www.exchangewire.com/#top", reason: "Programmatic coverage", evidence: { count: 4, headline: "DOOH spend rises" } },
        { name: "Script", url: "javascript:alert(1)", reason: "Bad URL keeps the name" },
        { name: "No URL", url: null, reason: "" },
        { name: " ", url: "https://blank.invalid/" }, null, "text",
        { name: "Bad evidence", url: null, evidence: { count: -1, headline: 3 } },
      ],
    })).toEqual({ grounded: true, items: [
      { kind: "source", name: "ExchangeWire", url: "https://www.exchangewire.com/", reason: "Programmatic coverage", evidence: { count: 4, headline: "DOOH spend rises" } },
      { kind: "source", name: "Script", reason: "Bad URL keeps the name" },
      { kind: "source", name: "No URL" },
      { kind: "source", name: "Bad evidence" },
    ] });
  });

  it("maps topic weights and people/company groups, deduplicating by name", () => {
    expect(parseOnboardingSuggestions("topics", { step: "topics", grounded: false, items: [
      { name: "Retail media", weight: 0.9 }, { name: "retail media", weight: 0.2 }, { name: "Heavy", weight: 4 },
    ] })).toEqual({ grounded: false, items: [{ kind: "topic", name: "Retail media", weight: 0.9 }, { kind: "topic", name: "Heavy" }] });
    expect(parseOnboardingSuggestions("people", { step: "people", grounded: true,
      people: [{ name: "Ana Rao", reason: "CEO", evidence: { count: 2, headline: "Ana Rao on DOOH" } }],
      companies: [{ name: "Vistar Media", reason: "" }, { name: "ana rao" }],
    }).items).toEqual([
      { kind: "leader", name: "Ana Rao", reason: "CEO", evidence: { count: 2, headline: "Ana Rao on DOOH" } },
      { kind: "company", name: "Vistar Media" },
    ]);
  });

  it("rejects an envelope for a different step", () => {
    expect(() => parseOnboardingSuggestions("topics", { step: "publications", grounded: true, items: [] })).toThrow();
    expect(() => parseOnboardingSuggestions("people", null)).toThrow();
  });

  it("describes news evidence in plain words", () => {
    expect(evidenceLabel({ kind: "source", name: "A", evidence: { count: 1, headline: "h" } })).toBe("1 recent article");
    expect(evidenceLabel({ kind: "source", name: "A", evidence: { count: 12, headline: "h" } })).toBe("12 recent articles");
    expect(evidenceLabel({ kind: "topic", name: "A", evidence: { count: 3, headline: "h" } })).toBe("in 3 headlines");
    expect(evidenceLabel({ kind: "company", name: "A" })).toBeUndefined();
  });
});

describe("default news edition", () => {
  it("prefers the profile country, then the time zone, and falls back to the US edition", () => {
    expect(defaultSearchEdition({ country: "India", timeZone: "America/New_York" })).toBe("en-IN");
    expect(defaultSearchEdition({ country: "United Kingdom" })).toBe("en-GB");
    expect(defaultSearchEdition({ timeZone: "Asia/Kolkata" })).toBe("en-IN");
    expect(defaultSearchEdition({ timeZone: "Asia/Calcutta" })).toBe("en-IN");
    expect(defaultSearchEdition({ timeZone: "Australia/Sydney" })).toBe("en-AU");
    expect(defaultSearchEdition({ timeZone: "America/Toronto" })).toBe("en-CA");
    expect(defaultSearchEdition({ timeZone: "Europe/London" })).toBe("en-GB");
    expect(defaultSearchEdition({ timeZone: "Asia/Singapore" })).toBe("en-US");
    expect(defaultSearchEdition({})).toBe("en-US");
  });

  it("uses a local-language edition only when the browser language matches it", () => {
    expect(defaultSearchEdition({ timeZone: "Europe/Paris", language: "fr-FR" })).toBe("fr-FR");
    expect(defaultSearchEdition({ timeZone: "Europe/Paris", language: "en-GB" })).toBe("en-US");
    expect(defaultSearchEdition({ country: "India", language: "hi-IN" })).toBe("hi-IN");
    expect(defaultSearchEdition({ country: "Brazil", language: "pt-BR" })).toBe("pt-BR");
    expect(defaultSearchEdition({ country: "Germany", language: "en-US" })).toBe("en-US");
  });
});

describe("matching suggestion names to built-in choices", () => {
  it("treats domain-style, punctuated and differently cased names as the same choice", () => {
    expect(choiceKey("bestmediainfo.com")).toBe(choiceKey("BestMediaInfo"));
    expect(choiceKey("www.afaqs.com")).toBe(choiceKey("afaqs!"));
    expect(choiceKey("Exchange4Media")).toBe(choiceKey("exchange4media"));
    expect(choiceKey("The Drum")).not.toBe(choiceKey("Drum Media"));
    expect(choiceKey("Ad Age")).not.toBe(choiceKey("Adage.io News"));
  });
});
