import { describe, expect, it } from "vitest";
import { matchedNewsTerms, matchesNewsQuery, newsQueryChips, newsQueryKey, newsQueryWindow, normalizeSiteDomain, parseNewsQuery, parseQueryDay } from "./news-search";

const now = new Date("2026-11-16T12:00:00Z");
const article = (extra: Partial<Parameters<typeof matchesNewsQuery>[0]> = {}) => ({
  title: "Retail media networks grow ad budgets", snippet: "Brands move spend to commerce media.", source: "Ad Brief",
  url: "https://www.adbrief.test/story", publishedAt: "2026-11-15T08:00:00Z", ...extra,
});

describe("parseNewsQuery", () => {
  it("requires plain words, keeps phrases and exclusions, and reads OR between terms", () => {
    const parsed = parseNewsQuery(`  retail   "media networks"  amazon OR walmart -crypto -"press release" `);
    expect(parsed.groups).toEqual([
      [{ kind: "word", text: "retail" }],
      [{ kind: "phrase", text: "media networks" }],
      [{ kind: "word", text: "amazon" }, { kind: "word", text: "walmart" }],
    ]);
    expect(parsed.exclude).toEqual([{ kind: "word", text: "crypto" }, { kind: "phrase", text: "press release" }]);
    expect(parsed.normalized).toBe(`retail "media networks" amazon OR walmart -crypto -"press release"`);
    expect(parsed.warnings).toEqual([]);
  });

  it("parses source:, site:, after:, before: and newer_than:, quoted values included", () => {
    const parsed = parseNewsQuery(`ai source:"Financial Times" site:https://www.Reuters.com/tech after:2026/1/5 before:2026-11-01 newer_than:2w -source:Blog -site:spam.test`);
    expect(parsed).toMatchObject({
      sources: ["Financial Times"], excludeSources: ["Blog"], sites: ["reuters.com"], excludeSites: ["spam.test"],
      after: "2026-01-05", before: "2026-11-01", newerThan: { amount: 2, unit: "w", days: 14 },
    });
    expect(parsed.normalized).toBe(`ai source:"Financial Times" -source:Blog site:reuters.com -site:spam.test after:2026-01-05 before:2026-11-01 newer_than:2w`);
  });

  it("treats unknown key:value tokens as plain words, quoted for providers", () => {
    const parsed = parseNewsQuery("label:ai from:me");
    expect(parsed.groups).toEqual([[{ kind: "word", text: "label:ai" }], [{ kind: "word", text: "from:me" }]]);
    expect(parsed.providerQuery).toBe(`"label:ai" "from:me"`);
  });

  it("re-parses its normalized form to the same query", () => {
    for (const input of [`a OR "b c" -d source:"New York Times" site:x.test newer_than:3m`, `-OR "x" covid-19 (ai)`, "source:", `x OR -y z`]) {
      const once = parseNewsQuery(input).normalized;
      expect(parseNewsQuery(once).normalized).toBe(once);
    }
  });

  it("warns about invalid dates, domains, durations, unsupported negations and crossed dates", () => {
    expect(parseNewsQuery("ai after:2026-02-30").warnings).toEqual(["\u201cafter:2026-02-30\u201d isn\u2019t a valid date. Use YYYY-MM-DD."]);
    expect(parseNewsQuery("ai site:not_a_domain").warnings[0]).toContain("isn\u2019t a valid domain");
    expect(parseNewsQuery("ai newer_than:2y").warnings[0]).toContain("newer_than: works from 1 day to 12 months");
    expect(parseNewsQuery("ai newer_than:400d").newerThan).toBeNull();
    expect(parseNewsQuery("ai -after:2026-01-01").warnings).toEqual(["-after: isn\u2019t supported, so it was ignored."]);
    const crossed = parseNewsQuery("ai after:2026-05-01 before:2026-04-01");
    expect(crossed).toMatchObject({ after: null, before: null });
    expect(crossed.warnings[0]).toContain("both dates were ignored");
  });

  it("asks for a term when only exclusions or nothing usable remain", () => {
    expect(parseNewsQuery("-crypto").warnings).toEqual(["Add a word, a \u201cphrase\u201d or source: to search."]);
    expect(parseNewsQuery("").warnings).toEqual([]);
    expect(parseNewsQuery("source:Reuters").warnings).toEqual([]);
  });

  it("bounds length and term counts with a warning", () => {
    const long = parseNewsQuery("x".repeat(400));
    expect(long.groups[0][0].text).toHaveLength(100);
    expect(long.warnings).toEqual(["Your search was shortened to 300 characters."]);
    const many = parseNewsQuery(Array.from({ length: 15 }, (_, i) => `w${i}`).join(" "));
    expect(many.groups.flat()).toHaveLength(12);
    expect(many.warnings).toEqual(["Only the first 12 words and phrases are used."]);
    const excluded = parseNewsQuery(`ai ${Array.from({ length: 12 }, (_, i) => `-x${i}`).join(" ")}`);
    expect(excluded.exclude).toHaveLength(10);
    const sources = parseNewsQuery(Array.from({ length: 7 }, (_, i) => `source:s${i}`).join(" "));
    expect(sources.sources).toHaveLength(5);
  });

  it("dedupes repeated terms, exclusions and operators case-insensitively", () => {
    const parsed = parseNewsQuery("AI ai -x -X source:FT source:ft site:a.test site:A.test");
    expect(parsed.normalized).toBe("AI -x source:FT site:a.test");
  });

  it("ignores dangling OR and OR next to operators", () => {
    expect(parseNewsQuery("OR ai OR").groups).toEqual([[{ kind: "word", text: "ai" }]]);
    expect(parseNewsQuery("ai OR -x b").groups).toEqual([[{ kind: "word", text: "ai" }], [{ kind: "word", text: "b" }]]);
    expect(parseNewsQuery("a | b").groups).toEqual([[{ kind: "word", text: "a" }, { kind: "word", text: "b" }]]);
  });

  it("builds a provider query of at most 100 characters and reports when required terms did not fit", () => {
    const simple = parseNewsQuery(`ai "chip export" -rumor site:reuters.com after:2026-01-01`);
    expect(simple).toMatchObject({ providerQuery: `ai "chip export" site:reuters.com -rumor`, providerComplete: true });
    const two = parseNewsQuery("ai site:a.test site:b.test");
    expect(two.providerQuery).toBe("ai");
    const long = parseNewsQuery(`"${"a".repeat(60)}" "${"b".repeat(60)}"`);
    expect(long.providerQuery.length).toBeLessThanOrEqual(100);
    expect(long.providerComplete).toBe(false);
    expect(parseNewsQuery("source:Reuters").providerQuery).toBe("");
    expect(parseNewsQuery("site:reuters.com").providerQuery).toBe("site:reuters.com");
  });

  it("builds one websearch_to_tsquery input per required group and per exclusion, so OR stays inside its group", () => {
    expect(parseNewsQuery(`black or white "a b" x OR y -z -"p q" --w`)).toMatchObject({
      textGroups: ["black", `"or"`, "white", `"a b"`, "x or y"], textExclusions: ["z", `"p q"`, `"-w"`],
    });
    expect(parseNewsQuery("amazon OR walmart retail")).toMatchObject({ textGroups: ["amazon or walmart", "retail"], textExclusions: [] });
    expect(parseNewsQuery("source:Reuters -x")).toMatchObject({ textGroups: [], textExclusions: [] });
  });

  it("parenthesizes OR groups for providers and marks their results for re-checking", () => {
    expect(parseNewsQuery("amazon OR walmart retail")).toMatchObject({ providerQuery: "(amazon OR walmart) retail", providerComplete: false });
    expect(parseNewsQuery(`retail "big box" OR walmart -crypto`)).toMatchObject({ providerQuery: `retail ("big box" OR walmart) -crypto`, providerComplete: false });
    expect(parseNewsQuery("retail amazon").providerComplete).toBe(true);
  });
});

describe("dates and domains", () => {
  it("accepts only real calendar days", () => {
    expect(parseQueryDay("2026-2-3")).toBe("2026-02-03");
    expect(parseQueryDay("2026-02-29")).toBeNull();
    expect(parseQueryDay("26-02-01")).toBeNull();
  });

  it("normalizes site domains and rejects addresses and junk", () => {
    expect(normalizeSiteDomain("HTTPS://www.BBC.co.uk/news")).toBe("bbc.co.uk");
    expect(normalizeSiteDomain("10.0.0.1")).toBeNull();
    expect(normalizeSiteDomain("user@x.test")).toBeNull();
    expect(normalizeSiteDomain("localhost")).toBeNull();
  });

  it("defaults to the last 30 days and narrows with after:, before: and newer_than:", () => {
    expect(newsQueryWindow(parseNewsQuery("ai"), now)).toEqual({ from: new Date("2026-10-17T12:00:00Z"), to: null, explicit: false });
    expect(newsQueryWindow(parseNewsQuery("ai before:2026-01-01"), now)).toEqual({ from: null, to: new Date("2026-01-01T00:00:00Z"), explicit: true });
    expect(newsQueryWindow(parseNewsQuery("ai after:2026-11-01 newer_than:7d"), now).from).toEqual(new Date("2026-11-09T12:00:00Z"));
    expect(newsQueryWindow(parseNewsQuery("ai after:2026-11-12 newer_than:7d"), now).from).toEqual(new Date("2026-11-12T00:00:00Z"));
  });
});

describe("matchesNewsQuery", () => {
  it("requires every group, any term within a group, with light plural matching", () => {
    expect(matchesNewsQuery(article(), parseNewsQuery("retail network"), { now })).toBe(true);
    expect(matchesNewsQuery(article(), parseNewsQuery("retail tiktok"), { now })).toBe(false);
    expect(matchesNewsQuery(article(), parseNewsQuery("tiktok OR commerce"), { now })).toBe(true);
    expect(matchesNewsQuery(article(), parseNewsQuery("retail tiktok"), { now, requireTerms: false })).toBe(true);
  });

  it("matches phrases only as adjacent words", () => {
    expect(matchesNewsQuery(article(), parseNewsQuery(`"retail media"`), { now })).toBe(true);
    expect(matchesNewsQuery(article(), parseNewsQuery(`"media retail"`), { now })).toBe(false);
    expect(matchesNewsQuery(article({ title: "Covid-19 rules change" }), parseNewsQuery("covid-19"), { now })).toBe(true);
  });

  it("drops exclusions found in the title, snippet or source, even without required terms", () => {
    expect(matchesNewsQuery(article(), parseNewsQuery("retail -commerce"), { now })).toBe(false);
    expect(matchesNewsQuery(article(), parseNewsQuery(`retail -"ad brief"`), { now, requireTerms: false })).toBe(false);
    expect(matchesNewsQuery(article(), parseNewsQuery("retail -tiktok"), { now })).toBe(true);
  });

  it("filters by source name or host, and by site including subdomains", () => {
    expect(matchesNewsQuery(article(), parseNewsQuery("retail source:brief"), { now })).toBe(true);
    expect(matchesNewsQuery(article(), parseNewsQuery("retail source:adbrief"), { now })).toBe(true);
    expect(matchesNewsQuery(article(), parseNewsQuery("retail source:Reuters"), { now })).toBe(false);
    expect(matchesNewsQuery(article(), parseNewsQuery("retail -source:brief"), { now })).toBe(false);
    expect(matchesNewsQuery(article(), parseNewsQuery("retail site:adbrief.test"), { now })).toBe(true);
    expect(matchesNewsQuery(article({ url: "https://news.adbrief.test/x" }), parseNewsQuery("retail site:adbrief.test"), { now })).toBe(true);
    expect(matchesNewsQuery(article({ url: "https://notadbrief.test/x" }), parseNewsQuery("retail site:adbrief.test"), { now })).toBe(false);
    expect(matchesNewsQuery(article(), parseNewsQuery("retail -site:adbrief.test"), { now })).toBe(false);
  });

  it("keeps the publication window and needs a date only when dates were asked for", () => {
    expect(matchesNewsQuery(article({ publishedAt: "2026-09-01T00:00:00Z" }), parseNewsQuery("retail"), { now })).toBe(false);
    expect(matchesNewsQuery(article({ publishedAt: null }), parseNewsQuery("retail"), { now })).toBe(true);
    expect(matchesNewsQuery(article({ publishedAt: null }), parseNewsQuery("retail newer_than:7d"), { now })).toBe(false);
    expect(matchesNewsQuery(article({ publishedAt: "2026-11-01T00:00:00Z" }), parseNewsQuery("retail before:2026-11-01"), { now })).toBe(false);
    expect(matchesNewsQuery(article({ publishedAt: "2026-10-31T23:59:00Z" }), parseNewsQuery("retail before:2026-11-01"), { now })).toBe(true);
  });

  it("matches unspaced scripts by substring", () => {
    expect(matchesNewsQuery(article({ title: "小売メディアが成長" }), parseNewsQuery("メディア"), { now })).toBe(true);
  });

  it("rejects articles without a usable URL", () => {
    expect(matchesNewsQuery(article({ url: "not a url" }), parseNewsQuery("retail"), { now })).toBe(false);
  });
});

describe("helpers", () => {
  it("lists matched terms in query order", () => {
    expect(matchedNewsTerms(article(), parseNewsQuery(`budget "retail media" tiktok`))).toEqual(["budget", "retail media"]);
  });

  it("describes operators as chips", () => {
    expect(newsQueryChips(parseNewsQuery(`a OR b -c source:FT -site:x.test after:2026-01-01 newer_than:1d`)).map(chip => chip.label))
      .toEqual(["Any of: a, b", "Without c", "Source: FT", "Not on x.test", "On or after 2026-01-01", "Last day"]);
  });

  it("keys followed searches by normalized lower-case query", () => {
    expect(newsQueryKey("  AI   source:FT ")).toBe(newsQueryKey("ai source:ft"));
  });
});
