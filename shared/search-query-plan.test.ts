import { describe, expect, it, vi } from "vitest";
import { planSearchQueries, SEARCH_QUERY_LIMITS, type SearchQueryProfile, type SearchQueryState } from "./search-query-plan";
import { scoreArticleRelevance } from "../server/services/articleRelevance";
import { mapCrawlSettled } from "../server/services/crawlerFetch";

const labels = (prefix: string, count = 20) => Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(2, "0")}`);
const full = () => ({ keywords: labels("k").map((keyword, i) => ({ keyword, weight: 1 - i / 20 })), companies: labels("c"), influencers: labels("i") });
const key = (label: string) => label.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

describe("search query planning", () => {
  it("caps unique queries at eight and gives topics half of them", () => {
    let state: unknown = {};
    const counts: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const plan = planSearchQueries(full(), state);
      expect(plan.queries).toHaveLength(SEARCH_QUERY_LIMITS.queries);
      expect(new Set(plan.queries.map(key)).size).toBe(8);
      counts.push(["k", "c", "i"].map(prefix => plan.queries.filter(query => query.startsWith(prefix)).length));
      state = plan.state;
    }
    expect(counts).toEqual([[4, 2, 2], [4, 2, 2], [4, 2, 2]]);
  });

  it("visits all twenty selections per group within sixty refreshes", () => {
    let state: unknown = {};
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const plan = planSearchQueries(full(), state);
      plan.queries.forEach(query => seen.add(query));
      state = plan.state;
    }
    expect([...seen].sort()).toEqual([...labels("k"), ...labels("c"), ...labels("i")].sort());
  });

  it("prioritizes weight then canonical label, never rounds tiny positive weights to zero", () => {
    const keywords = [{ keyword: "Z", weight: 0.8 }, { keyword: "A", weight: 0.8 }, { keyword: "first", weight: 1 },
      { keyword: "tiny", weight: Number.MIN_VALUE }, { keyword: "off", weight: 0 }, "legacy"];
    expect(planSearchQueries({ keywords }).queries).toEqual(["first", "A", "Z", "legacy", "tiny"]);
  });

  it("uses weights for cycle ordering, not more frequent sampling", () => {
    const keywords = labels("k", 10).map((keyword, i) => ({ keyword, weight: i === 9 ? Number.MIN_VALUE : 1 - i / 10 }));
    let state: unknown = {};
    const frequency = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      const plan = planSearchQueries({ keywords }, state);
      plan.queries.forEach(query => frequency.set(query, (frequency.get(query) ?? 0) + 1));
      state = plan.state;
    }
    expect([...frequency.values()]).toEqual(Array(10).fill(8));
  });

  it.each(["keywords", "companies", "influencers"] as const)("redistributes empty-group slots to %s", group => {
    const plan = planSearchQueries({ [group]: labels("only") });
    expect(plan.queries).toEqual(labels("only").slice(0, 8));
  });

  it("redistributes sparse-group slots without repeating the small groups", () => {
    const plan = planSearchQueries({ keywords: labels("k"), companies: ["company"], influencers: ["person"] });
    expect(plan.queries).toEqual(["k00", "company", "k01", "person", "k02", "k03", "k04", "k05"]);
    expect(plan.state.cursors).toEqual([1, 0, 0]);
  });

  it("wraps local selection cursors without advancing other persisted window starts", () => {
    const profile = { keywords: labels("k", 9), companies: labels("c", 2), influencers: ["i"] };
    const first = planSearchQueries(profile);
    const next = planSearchQueries(profile, { ...first.state, cursors: [8, 1, 0] });
    expect(next.queries).toEqual(["c01", "k08", "i", "k00", "c00", "k01", "k02", "k03"]);
    expect(next.state.cursors).toEqual([8, 0, 0]);
    expect(next.state.groupStart).toBe(2);
    expect(new Set(next.queries).size).toBe(8);
  });

  it("deduplicates canonical labels across groups with relevance-compatible precedence", () => {
    const profile = { keywords: [{ keyword: " ＡＩ\tpolicy ", weight: 0.2 }, "ai POLICY", { keyword: "Meta", weight: 0 }],
      companies: ["AI policy", "META", "Other"], influencers: ["meta", "Other", "Ada"] };
    const plan = planSearchQueries(profile);
    expect(plan.queries).toEqual(["AI policy", "META", "Ada", "Other"]);
    const evidence = scoreArticleRelevance({ title: "AI policy META Other Ada", content: "" }, profile).evidence;
    expect(plan.queries.map(key).sort()).toEqual(evidence.map(item => key(item.label)).sort());
    expect(JSON.parse(plan.state.signature)[0]).toEqual([["ai policy", 0.2], ["meta", 0]]);
  });

  it("keeps first-seen zero keyword metadata, but allows the independent same-label company", () => {
    const keywords = [{ keyword: "AI", weight: 0 }, { keyword: "ai", weight: 1 }];
    expect(planSearchQueries({ keywords }).queries).toEqual([]);
    expect(planSearchQueries({ keywords, companies: ["ＡＩ"] }).queries).toEqual(["AI"]);
  });

  it("continues the same state across reordered canonical lists and category/display edits", () => {
    const profile = full();
    const previous = planSearchQueries(profile).state;
    const reordered = { keywords: [...profile.keywords].reverse().map(term => ({ ...term, category: "Updated" })),
      companies: [...profile.companies].reverse(), influencers: [...profile.influencers].reverse() };
    expect(planSearchQueries(reordered, previous)).toEqual(planSearchQueries(profile, previous));
    const displayOnly = { ...profile, companies: profile.companies.map(label => ` ${label.toUpperCase()} `) };
    const actual = planSearchQueries(displayOnly, previous);
    const expected = planSearchQueries(profile, previous);
    expect(actual.state).toEqual(expected.state);
    expect(actual.queries.map(key)).toEqual(expected.queries.map(key));
  });

  it.each(["selection", "weight", "zero", "company", "influencer"])("resets safely after a substantive %s edit", edit => {
    const profile = full();
    const previous = planSearchQueries(profile).state;
    if (edit === "selection") profile.keywords.pop();
    if (edit === "weight") profile.keywords[19].weight = 1;
    if (edit === "zero") profile.keywords[0].weight = 0;
    if (edit === "company") profile.companies.push("new company");
    if (edit === "influencer") profile.influencers = [];
    expect(planSearchQueries(profile, previous)).toEqual(planSearchQueries(profile));
  });

  it("handles empty/nullable legacy lists and never mutates profile or state", () => {
    expect(planSearchQueries({}).queries).toEqual([]);
    expect(planSearchQueries({ keywords: null, companies: null, influencers: null }).queries).toEqual([]);
    const profile = Object.freeze({ keywords: Object.freeze([Object.freeze({ keyword: "AI", weight: 0.7 })]) });
    const state = planSearchQueries(profile).state;
    Object.freeze(state.cursors); Object.freeze(state);
    expect(planSearchQueries(profile, state).queries).toEqual(["AI"]);
    expect(state.groupStart).toBe(1);
  });

  it("supports the full bounded legacy limit without truncation/starvation", () => {
    const profile = { keywords: labels("k", 100), companies: labels("c", 100), influencers: labels("i", 100) };
    let state: unknown = {};
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const plan = planSearchQueries(profile, state);
      plan.queries.forEach(query => seen.add(query));
      state = plan.state;
    }
    expect(seen.size).toBe(300);
    expect(planSearchQueries({ keywords: ["x".repeat(100)] }).queries).toEqual(["x".repeat(100)]);
  });

  it("bounds coverage for varied sparse, overlapping and wraparound list sizes", () => {
    for (let length = 1; length <= 20; length++) {
      const profile = { keywords: labels("k", length), companies: [...labels("k", length), ...labels("c", 21 - length)], influencers: labels("i", length % 7) };
      const eligible = new Set([...profile.keywords, ...profile.companies, ...profile.influencers]);
      const seen = new Set<string>();
      let state: unknown = {};
      for (let refresh = 0; refresh < 60; refresh++) {
        const plan = planSearchQueries(profile, state);
        expect(plan.queries).toHaveLength(Math.min(8, eligible.size));
        expect(new Set(plan.queries).size).toBe(plan.queries.length);
        plan.queries.forEach(query => seen.add(query));
        state = plan.state;
      }
      expect(seen).toEqual(eligible);
    }
  });

  it.each([8, 16, 20].flatMap(count => [1, 3].map(groups => ({ count, groups }))))
    ("measures first 1/2/4/6 coverage on the same reservations: $count terms x $groups groups", ({ count, groups }) => {
      const profile = { keywords: labels("k", count).map((keyword, i) => ({ keyword, weight: 1 - i / count })),
        companies: groups === 3 ? labels("c", count) : [], influencers: groups === 3 ? labels("i", count) : [] };
      const eligible = new Set([...labels("k", count), ...profile.companies, ...profile.influencers]);
      const prefixes = [1, 2, 4, 6].map(size => ({ size, attempted: new Set<string>(), refreshes: 0 }));
      let state: unknown = {};
      for (let run = 1; run <= eligible.size; run++) {
        const plan = planSearchQueries(profile, state);
        expect(plan.queries).toHaveLength(8);
        expect(new Set(plan.queries).size).toBe(8);
        if (groups === 3) {
          expect(["k", "c", "i"].map(prefix => plan.queries.filter(query => query.startsWith(prefix)).length)).toEqual([4, 2, 2]);
        }
        for (const prefix of prefixes) {
          plan.queries.slice(0, prefix.size).forEach(query => prefix.attempted.add(query));
          if (!prefix.refreshes && prefix.attempted.size === eligible.size) prefix.refreshes = run;
        }
        state = JSON.parse(JSON.stringify(plan.state));
      }
      for (const prefix of prefixes) {
        expect(prefix.attempted).toEqual(eligible);
        expect(prefix.refreshes).toBeGreaterThan(0);
        expect(prefix.refreshes).toBeLessThanOrEqual(eligible.size);
      }
      console.info(`Planner coverage ${count} x ${groups}; first 1/2/4/6: ${prefixes.map(prefix => prefix.refreshes).join("/")}`);
    });

  it.each([8, 16, 20].flatMap(count => [1, 3].flatMap(groups => [1, 2, 4, 6].map(started => ({ count, groups, started })))))
    ("dispatches every term after repeated failures: $count terms x $groups groups, first $started calls", async ({ count, groups, started }) => {
      vi.useFakeTimers();
      try {
        const profile = { keywords: labels("k", count).map((keyword, i) => ({ keyword, weight: 1 - i / count })),
          companies: groups === 3 ? labels("c", count) : [], influencers: groups === 3 ? labels("i", count) : [] };
        const eligible = new Set([...labels("k", count), ...profile.companies, ...profile.influencers]);
        const attempted = new Set<string>();
        let state: unknown = {};
        // One worker for first-1, otherwise two; seven-second failures with
        // 6/13/20 seconds of budget yield exactly 1/2/4/6 starts, not eight
        // "visited" reservations. No success or
        // fetch completion acknowledgement is fed back to the planner.
        const workers = Math.min(started, 2);
        const budget = started / workers * 7000 - 1000;
        for (let run = 0; run < eligible.size && attempted.size < eligible.size; run++) {
          const plan = planSearchQueries(profile, state);
          expect(plan.queries).toHaveLength(8);
          expect(new Set(plan.queries).size).toBe(8);
          if (groups === 3) {
            expect(["k", "c", "i"].map(prefix => plan.queries.filter(query => query.startsWith(prefix)).length)).toEqual([4, 2, 2]);
          }
          if (run === 0) expect(plan.queries).toEqual(groups === 1 ? labels("k", count).slice(0, 8)
            : ["k00", "c00", "k01", "i00", "k02", "c01", "k03", "i01"]);
          // Simulates a durable reservation surviving failure/process restart.
          state = JSON.parse(JSON.stringify(plan.state));
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), budget);
          const calls: string[] = [];
          let active = 0;
          let peak = 0;
          const batch = mapCrawlSettled(plan.queries, workers, async query => {
            controller.signal.throwIfAborted();
            calls.push(query); attempted.add(query);
            active++; peak = Math.max(peak, active);
            try {
              await new Promise<void>((_resolve, reject) => {
                const fail = () => {
                  clearTimeout(callTimer);
                  controller.signal.removeEventListener("abort", fail);
                  reject(new Error("Simulated failed search"));
                };
                const callTimer = setTimeout(fail, 7000);
                controller.signal.addEventListener("abort", fail, { once: true });
              });
            } finally { active--; }
          });
          await vi.advanceTimersByTimeAsync(budget);
          expect((await batch).every(result => result.status === "rejected")).toBe(true);
          clearTimeout(timer);
          expect(calls).toEqual(plan.queries.slice(0, started));
          expect(active).toBe(0); expect(peak).toBe(workers);
          expect(vi.getTimerCount()).toBe(0);
        }
        expect(attempted).toEqual(eligible);
      } finally { vi.useRealTimers(); }
    });

  it("bounds even single-start coverage from arbitrary valid sparse/overlapping/wrapped states", () => {
    for (let length = 1; length <= 20; length++) {
      const profile = { keywords: labels("k", length), companies: [...labels("k", length), ...labels("c", 21 - length)], influencers: labels("i", length % 7) };
      const eligible = new Set([...profile.keywords, ...profile.companies, ...profile.influencers]);
      const attempted = new Set<string>();
      let state: unknown = { ...planSearchQueries(profile).state, cursors: [length - 1, 20 - length, Math.max(0, length % 7 - 1)],
        groupStart: length % 3 };
      const bound = (length % 7 ? 3 : 2) * Math.max(length, 21 - length, length % 7);
      for (let run = 0; run < bound && attempted.size < eligible.size; run++) {
        const plan = planSearchQueries(profile, state);
        attempted.add(plan.queries[0]);
        state = JSON.parse(JSON.stringify(plan.state));
      }
      expect(attempted).toEqual(eligible);
    }
  });

  it("advances only the first served group by one, independently of its slot count", () => {
    const first = planSearchQueries(full());
    expect(first.state.cursors).toEqual([1, 0, 0]);
    const second = planSearchQueries(full(), first.state);
    expect(first.queries).toEqual(["k00", "c00", "k01", "i00", "k02", "c01", "k03", "i01"]);
    expect(second.queries).toEqual(["c00", "k01", "i00", "k02", "c01", "k03", "i01", "k04"]);
    expect(second.state.cursors).toEqual([1, 1, 0]);
    const third = planSearchQueries(full(), second.state);
    expect(third.queries).toEqual(["i00", "k01", "c01", "k02", "i01", "k03", "c02", "k04"]);
    expect(third.state.cursors).toEqual([1, 1, 1]);
    expect([first, second, third].map(plan => plan.state.groupStart)).toEqual([1, 2, 0]);
  });

  it.each([1, 2])("resets version %i even with valid signature and cursors", version => {
    const old = { ...planSearchQueries(full()).state, version, cursors: [19, 10, 5], groupStart: 2 };
    expect(planSearchQueries(full(), version === 2 ? { ...old, dispatchOffset: 59 } : old)).toEqual(planSearchQueries(full()));
  });

  it("avoids phase-lock for multiples of three and skips every combination of empty groups", () => {
    for (const count of [3, 6, 9, 12, 15, 18, 20]) {
      for (let mask = 1; mask < 8; mask++) {
        const lists = ["k", "c", "i"].map((prefix, i) => mask & (1 << i) ? labels(prefix, count) : []);
        const profile = { keywords: lists[0], companies: lists[1], influencers: lists[2] };
        const eligible = new Set(lists.flat());
        for (let groupStart = 0; groupStart < 3; groupStart++) {
          let state = { ...planSearchQueries(profile).state, groupStart,
            cursors: lists.map((list, i) => list.length ? (count - 1 + i) % count : 0) as SearchQueryState["cursors"] };
          const attempted = new Set<string>();
          for (let run = 0; run < eligible.size; run++) {
            const plan = planSearchQueries(profile, state);
            attempted.add(plan.queries[0]);
            expect(plan.queries).toHaveLength(Math.min(8, eligible.size));
            expect(new Set(plan.queries).size).toBe(plan.queries.length);
            state = JSON.parse(JSON.stringify(plan.state));
          }
          expect(attempted).toEqual(eligible);
        }
      }
    }
  });

  it.each([
    null, [], 12, "AI", { keywords: "AI" }, { companies: {} }, { influencers: [12] }, { keywords: [null] },
    { keywords: [{}] }, { keywords: [[]] }, { keywords: [" "] }, { keywords: ["x".repeat(101)] },
    { keywords: ["\uFDFA".repeat(10)] }, { companies: ["x".repeat(101)] }, { influencers: ["x".repeat(101)] },
    { keywords: Array(101).fill("AI") }, { companies: Array(101).fill("AI") }, { influencers: Array(101).fill("AI") },
    { companies: [{ keyword: "AI", weight: 1 }] }, { keywords: [{ keyword: "AI", category: "x".repeat(101) }] },
    { keywords: ["AI", { keyword: "ai", weight: NaN }] },
    ...[NaN, Infinity, -Infinity, -1, 1.1, "0.5", null, {}].map(weight => ({ keywords: [{ keyword: "AI", weight }] })),
  ])("fails closed for malformed/oversized signals (%#)", profile => {
    const plan = planSearchQueries(profile as SearchQueryProfile, planSearchQueries(full()).state);
    expect(plan).toEqual({ queries: [], state: { version: 3, signature: "", cursors: [0, 0, 0], groupStart: 0 } });
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it.each([
    null, [], "state", 7, {}, { version: 1 }, { version: 2 }, { version: 4 }, { signature: "stale" },
    ...[NaN, Infinity, -1, 0.5, 3, "1", null].map(groupStart => ({ groupStart })),
    ...[null, [], [0, 0], [0, 0, 0, 0], [NaN, 0, 0], [Infinity, 0, 0], [-1, 0, 0], [0.5, 0, 0], [20, 0, 0], ["1", 0, 0], Array(3), {}].map(cursors => ({ cursors })),
  ])("resets malformed persisted state without NaN or loops (%#)", malformed => {
    const initial = planSearchQueries(full());
    const previous = malformed && typeof malformed === "object" && !Array.isArray(malformed)
      ? { ...initial.state, ...malformed } : malformed;
    // An empty object overlay is a valid state; every other case must restart.
    const expected = malformed && typeof malformed === "object" && !Array.isArray(malformed) && Object.keys(malformed).length === 0
      ? planSearchQueries(full(), initial.state) : initial;
    const plan = planSearchQueries(full(), previous);
    expect(plan).toEqual(expected);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it("drops unknown persisted fields and keeps only validated bounded cursors", () => {
    const state: SearchQueryState = planSearchQueries(full()).state;
    expect(planSearchQueries(full(), { ...state, dispatchOffset: NaN, extra: { poison: NaN } })).toEqual(planSearchQueries(full(), state));
  });
});