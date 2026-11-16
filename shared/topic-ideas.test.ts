import { describe, expect, it } from "vitest";
import {
  buildPlan, contentStrategySchema, diversify, effectiveSlots, extraIdeaIdsSchema, generateIdeas, groupPlanByWeek, ideaId, mergeMomentIdeas, momentIdeaId, momentIdeas, parseMoments,
  placeMoments, rankIdeas, suggestStrategy, weekStartOf, zonedParts, zonedTimeToUtc,
  type ContentStrategy, type IdeaInputs, type RankedIdea, type TopicIdea,
} from "./topic-ideas";

const strategy = (overrides: Partial<ContentStrategy> = {}): ContentStrategy => ({
  audience: "D2C founders", goal: "build_authority", goalNote: "",
  pillars: [
    { name: "Retail media", expertise: 3, proof: "Cut CPA 30% for a beauty brand" },
    { name: "Pricing", expertise: 2, proof: "" },
    { name: "AI agents", expertise: 1, proof: "" },
  ],
  cadence: { postsPerWeek: 3, slots: [{ weekday: 1, time: "09:00" }, { weekday: 3, time: "09:00" }, { weekday: 5, time: "09:00" }] },
  ...overrides,
});
const NOW = new Date("2026-11-16T04:00:00Z"); // Monday 09:30 in Asia/Kolkata
const inputs = (overrides: Partial<IdeaInputs> = {}): IdeaInputs => ({
  strategy: strategy(), now: NOW, timeZone: "Asia/Kolkata",
  trends: [{ topic: "retail media", count: 6, previousCount: 2, label: "continuing" }, { topic: "clean rooms", count: 3, previousCount: 0, label: "new" }],
  stories: [
    { id: "s1", headline: "Retail media networks pass $60B", source: "Ad Brief", url: "https://news.test/s1", relevance: 0.9, matchedKeywords: ["Retail media"] },
    { id: "s2", headline: "Unrelated but very relevant", source: "Wire", url: "https://news.test/s2", relevance: 0.85, matchedKeywords: [] },
    { id: "s3", headline: "Low match", source: "Wire", url: "https://news.test/s3", relevance: 0.4, matchedKeywords: ["Pricing"] },
  ],
  checkins: [{ weekStart: "2026-11-09", answers: { win: "Closed a pricing workshop with a new client", lesson: "", question: "" } }],
  published: [{ id: "p1", content: "Why retail media needs incrementality\nMore text", publishedAt: "2026-11-01T05:00:00Z" }],
  ...overrides,
});

describe("strategy", () => {
  it("suggests the five heaviest distinct keywords as pillars and the preferred time as slots", () => {
    const suggested = suggestStrategy({
      preferredPublishTime: "08:30",
      keywords: [{ keyword: "A", weight: 0.2 }, { keyword: "B", weight: 0.9 }, { keyword: "b", weight: 1 }, { keyword: "C", weight: 0.5 },
        { keyword: "D", weight: 0.7 }, { keyword: " ", weight: 1 }, { keyword: "E", weight: 0.6 }, { keyword: "F", weight: 0.1 }],
    });
    expect(suggested.pillars.map(pillar => pillar.name)).toEqual(["B", "D", "E", "C", "A"]);
    expect(suggested.pillars.every(pillar => pillar.expertise === 2)).toBe(true);
    expect(suggested.cadence).toEqual({ postsPerWeek: 3, slots: [1, 3, 5].map(weekday => ({ weekday, time: "08:30" })) });
    expect(suggestStrategy({ preferredPublishTime: "25:00" }).cadence.slots[0].time).toBe("09:00");
    expect(contentStrategySchema.safeParse(suggested).success).toBe(true);
  });

  it("enforces limits and unique pillars and slots", () => {
    const pillar = (name: string) => ({ name, expertise: 2 as const, proof: "" });
    const bad: Array<Partial<ContentStrategy>> = [
      { audience: "x".repeat(201) }, { goalNote: "x".repeat(121) },
      { pillars: ["a", "b", "c", "d", "e", "f"].map(pillar) }, { pillars: [pillar("Same"), pillar("same")] }, { pillars: [pillar("x".repeat(61))] },
      { pillars: [{ name: "P", expertise: 4 as never, proof: "" }] }, { pillars: [{ name: "P", expertise: 2, proof: "x".repeat(201) }] },
      { cadence: { postsPerWeek: 8, slots: [] } }, { cadence: { postsPerWeek: 0, slots: [] } },
      { cadence: { postsPerWeek: 3, slots: Array.from({ length: 15 }, (_, i) => ({ weekday: i % 7, time: `0${Math.floor(i / 7)}:00` })) } },
      { cadence: { postsPerWeek: 3, slots: [{ weekday: 1, time: "09:00" }, { weekday: 1, time: "09:00" }] } },
      { cadence: { postsPerWeek: 3, slots: [{ weekday: 7, time: "09:00" }] } }, { cadence: { postsPerWeek: 3, slots: [{ weekday: 1, time: "9:00" }] } },
    ];
    for (const change of bad) expect(contentStrategySchema.safeParse(strategy(change)).success, JSON.stringify(change).slice(0, 80)).toBe(false);
    expect(contentStrategySchema.safeParse({ ...strategy(), extra: true }).success).toBe(false);
    expect(contentStrategySchema.parse({ ...strategy(), audience: "  Founders  " }).audience).toBe("Founders");
  });
});

describe("time zones", () => {
  it("handles DST gaps (move forward) and overlaps (first occurrence)", () => {
    expect(zonedTimeToUtc("2026-03-08", "02:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedParts(zonedTimeToUtc("2026-03-08", "02:30", "America/New_York"), "America/New_York").time).toBe("03:30");
    expect(zonedTimeToUtc("2026-11-01", "01:30", "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(zonedTimeToUtc("2026-11-16", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-11-16T03:30:00.000Z");
  });

  it("starts the week on Monday in the profile time zone", () => {
    // Sunday 20:00 UTC is already Monday in Kolkata, still Sunday in New York.
    const instant = new Date("2026-11-15T20:00:00Z");
    expect(weekStartOf(instant, "Asia/Kolkata")).toBe("2026-11-16");
    expect(weekStartOf(instant, "America/New_York")).toBe("2026-11-09");
  });
});

describe("idea generation", () => {
  it("is deterministic with stable ids built from kind, source and template", () => {
    const first = generateIdeas(inputs());
    expect(generateIdeas(inputs())).toEqual(first);
    expect(new Set(first.map(idea => idea.id)).size).toBe(first.length);
    expect(first.every(idea => /^[0-9a-f]{16}$/.test(idea.id))).toBe(true);
    expect(ideaId("pillar", "Retail media", "myth")).toBe(ideaId("pillar", " retail MEDIA ", "myth"));
    expect(ideaId("pillar", "Retail media", "myth")).not.toBe(ideaId("pillar", "Retail media", "mistakes"));
    expect(first.find(idea => idea.title === "Myth vs reality: Retail media")?.id).toBe(ideaId("pillar", "Retail media", "myth"));
  });

  it("covers every source with an explanation, matched to pillars and honest about expertise", () => {
    const ideas = generateIdeas(inputs());
    const kinds = new Set(ideas.map(idea => idea.kind));
    expect([...kinds].sort()).toEqual(["experience", "follow-up", "pillar", "signal", "story"]);
    expect(ideas.every(idea => idea.why.length > 10 && idea.angle.length <= 200 && idea.title.length <= 200)).toBe(true);
    const learning = ideas.filter(idea => idea.pillar === "AI agents").map(idea => idea.title);
    expect(learning).toContain("What I'm learning about AI agents");
    expect(learning).not.toContain("Myth vs reality: AI agents");
    expect(learning).not.toContain("A prediction for AI agents");
    expect(ideas.find(idea => idea.title === "The story behind a Retail media result")?.angle).toBe("Tell this story: Cut CPA 30% for a beauty brand");
    expect(ideas.some(idea => idea.title === "The story behind a Pricing result")).toBe(false);
    const story = ideas.find(idea => idea.kind === "story" && idea.sourceStory?.inboxItemId === "s1")!;
    expect(story).toMatchObject({ pillar: "Retail media", title: "My take on: Retail media networks pass $60B", sourceStory: { url: "https://news.test/s1", source: "Ad Brief" } });
    expect(ideas.some(idea => idea.sourceStory?.inboxItemId === "s2")).toBe(true);
    expect(ideas.some(idea => idea.sourceStory?.inboxItemId === "s3")).toBe(false);
    expect(ideas.find(idea => idea.kind === "signal" && idea.pillar === "Retail media")).toMatchObject({ title: "What the rise in Retail media means for D2C founders" });
    expect(ideas.find(idea => idea.kind === "signal" && idea.title.includes("clean rooms"))?.title).toBe("What the rise in clean rooms means for D2C founders");
    expect(ideas.find(idea => idea.kind === "experience")).toMatchObject({ pillar: "Pricing", title: "A recent win: Closed a pricing workshop with a new client" });
    expect(ideas.filter(idea => idea.kind === "follow-up").map(idea => idea.pillar)).toEqual(["Retail media", "Retail media"]);
  });

  it("skips posts older than 60 days and pillars with no proof for proof ideas", () => {
    const ideas = generateIdeas(inputs({ published: [{ id: "old", content: "Old post", publishedAt: "2026-08-01T00:00:00Z" }] }));
    expect(ideas.some(idea => idea.kind === "follow-up")).toBe(false);
  });
});

describe("ranking", () => {
  const ideas = generateIdeas(inputs());

  it("never returns dismissed ideas, pins saved ones first and keeps saved snapshots", () => {
    const dismissed = ideas[0].id;
    const saved = ideas[5].id;
    const snapshot: TopicIdea = { id: ideaId("story", "gone", "my-take"), title: "My take on: an old story", angle: "Angle", pillar: null, kind: "story", why: "Saved", score: 0.4 };
    const ranked = rankIdeas(ideas, [
      { ideaId: dismissed, state: "dismissed", idea: null }, { ideaId: saved, state: "saved", idea: null }, { ideaId: snapshot.id, state: "saved", idea: snapshot },
    ]);
    expect(ranked.some(idea => idea.id === dismissed)).toBe(false);
    expect(ranked.slice(0, 2).map(idea => idea.id).sort()).toEqual([saved, snapshot.id].sort());
    expect(ranked.slice(0, 2).every(idea => idea.state === "saved")).toBe(true);
    expect(ranked).toHaveLength(30);
  });

  it("demotes drafted ideas instead of hiding them", () => {
    const top = rankIdeas(ideas, [])[0];
    const ranked = rankIdeas(ideas, [{ ideaId: top.id, state: "used", idea: null }], 200);
    const used = ranked.find(idea => idea.id === top.id)!;
    expect(used.state).toBe("used");
    expect(used.score).toBeCloseTo(top.score / 2, 2);
    expect(ranked[0].id).not.toBe(top.id);
  });

  it("keeps drafted ideas (including formerly saved ones) from their snapshot after the source is gone", () => {
    const story = ideas.find(idea => idea.kind === "story")!;
    const withoutStory = ideas.filter(idea => idea.id !== story.id);
    const ranked = rankIdeas(withoutStory, [{ ideaId: story.id, state: "used", idea: story }], 200);
    expect(ranked.find(idea => idea.id === story.id)).toMatchObject({ state: "used", title: story.title, sourceStory: story.sourceStory, score: Math.round(story.score / 2 * 1000) / 1000 });
    expect(rankIdeas(withoutStory, [{ ideaId: story.id, state: "dismissed", idea: story }], 200).some(idea => idea.id === story.id)).toBe(false);
  });

  it("spreads the top of the list across pillars and kinds", () => {
    const top = rankIdeas(ideas, []).slice(0, 8);
    expect(new Set(top.map(idea => idea.pillar)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(top.map(idea => idea.kind)).size).toBeGreaterThanOrEqual(3);
    const same = Array.from({ length: 6 }, (_, index): TopicIdea => ({ id: `${index}`.padStart(16, "0"), title: "t", angle: "a", why: "w", kind: "pillar", pillar: "A", score: 0.9 }));
    const other: TopicIdea = { id: "f".repeat(16), title: "t", angle: "a", why: "w", kind: "signal", pillar: "B", score: 0.7 };
    expect(diversify([...same, other], 3).map(idea => idea.id)).toContain(other.id);
  });
});

describe("30-day plan", () => {
  const ranked = (list: TopicIdea[] = generateIdeas(inputs())): RankedIdea[] => rankIdeas(list, [], 200);
  const plan = (overrides: Partial<Parameters<typeof buildPlan>[0]> = {}) => buildPlan({
    now: NOW, days: 30, timeZone: "Asia/Kolkata", strategy: strategy(), fallbackTime: "09:00", hasStrategy: true, scheduled: [], ideas: ranked(), ...overrides,
  });

  it("creates future slots from the cadence in the profile time zone", () => {
    const result = plan();
    expect(result).toMatchObject({ from: "2026-11-16", to: "2026-12-16", timezone: "Asia/Kolkata", postsPerWeek: 3 });
    const slots = result.entries.filter(entry => entry.kind !== "moment");
    // Monday 09:00 IST (03:30Z) has already passed at 04:00Z.
    expect(slots[0]).toMatchObject({ date: "2026-11-18", time: "09:00", at: "2026-11-18T03:30:00.000Z" });
    expect(slots.every(entry => [1, 3, 5].includes(new Date(`${entry.date}T00:00:00Z`).getUTCDay()))).toBe(true);
    for (const week of groupPlanByWeek(result.entries)) expect(week.entries.length).toBeLessThanOrEqual(3);
    expect(slots).toHaveLength(12);
  });

  it("rotates pillars and never repeats an idea", () => {
    const suggestions = plan().entries.flatMap(entry => entry.kind === "suggestion" ? [entry.idea] : []);
    expect(new Set(suggestions.map(idea => idea.id)).size).toBe(suggestions.length);
    expect(suggestions.slice(0, 3).map(idea => idea.pillar)).toEqual(["Retail media", "Pricing", "AI agents"]);
  });

  it("shows scheduled posts as they are, in their slot, within the weekly cadence", () => {
    const result = plan({ scheduled: [
      { draftId: "d1", at: "2026-11-18T05:00:00Z", excerpt: "Scheduled post\nmore", status: "scheduled" },
      { draftId: "d2", at: "2026-11-19T05:00:00Z", excerpt: "Thursday post", status: "scheduled" },
      { draftId: "past", at: "2026-11-15T05:00:00Z", excerpt: "Past", status: "scheduled" },
    ] });
    const week = groupPlanByWeek(result.entries)[0];
    expect(week.entries.map(entry => entry.kind)).toEqual(["scheduled", "scheduled", "suggestion"]);
    expect(week.entries[0]).toMatchObject({ date: "2026-11-18", time: "10:30", post: { draftId: "d1", excerpt: "Scheduled post more" } });
    expect(result.entries.some(entry => entry.key === "post:past")).toBe(false);
  });

  it("keeps the wall-clock time across a DST change", () => {
    const result = plan({ timeZone: "America/New_York", now: new Date("2026-10-26T12:00:00Z"), days: 14,
      strategy: strategy({ cadence: { postsPerWeek: 1, slots: [{ weekday: 2, time: "09:00" }] } }) });
    expect(result.entries.map(entry => entry.at)).toEqual(["2026-10-27T13:00:00.000Z", "2026-11-03T14:00:00.000Z"]);
  });

  it("leaves open slots when ideas run out and fills cadence gaps with usual days", () => {
    const result = plan({ ideas: [], strategy: strategy({ cadence: { postsPerWeek: 2, slots: [] } }) });
    expect(result.entries.every(entry => entry.kind === "open")).toBe(true);
    expect(effectiveSlots({ postsPerWeek: 3, slots: [{ weekday: 4, time: "11:00" }] }, "08:00"))
      .toEqual([{ weekday: 1, time: "08:00" }, { weekday: 3, time: "08:00" }, { weekday: 4, time: "11:00" }]);
    expect(effectiveSlots({ postsPerWeek: 2, slots: [1, 2, 3, 4].map(weekday => ({ weekday, time: "09:00" })) }, "08:00").map(slot => slot.weekday)).toEqual([1, 3]);
  });

  it("skips drafted ideas and limits days to 60", () => {
    const list = ranked();
    const used = list.map(idea => ({ ...idea, state: "used" as const }));
    expect(plan({ ideas: used }).entries.every(entry => entry.kind === "open")).toBe(true);
    expect(plan({ days: 500 }).days).toBe(60);
  });
});

describe("extra idea ids", () => {
  it("accepts up to 50 distinct idea ids and rejects anything else", () => {
    const ids = Array.from({ length: 50 }, (_, index) => ideaId("moment", `m${index}`, "lead"));
    expect(extraIdeaIdsSchema.parse(undefined)).toEqual([]);
    expect(extraIdeaIdsSchema.parse(`${ids[0]},${ids[0]}`)).toEqual([ids[0]]);
    expect(extraIdeaIdsSchema.parse(ids.join(","))).toHaveLength(50);
    for (const bad of [[...ids, ideaId("moment", "x", "lead")].join(","), "not-an-id", `${ids[0]},`]) expect(extraIdeaIdsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("moments", () => {
  const moments = parseMoments([
    { id: "m1", title: "Retail media summit", date: "2026-11-27", endDate: null, leadDays: 7, category: "Event", url: null, description: null, suggestedAngle: "What I expect from the summit", inLeadWindow: false },
    { id: "bad", title: "", date: "nope" },
    { id: "m2", title: "Past moment", date: "2026-10-01", endDate: null, leadDays: 7, category: "", url: null, description: null, suggestedAngle: "", inLeadWindow: false },
  ]);

  it("parses only well-formed moments and places them at the start of their lead window", () => {
    expect(moments.map(moment => moment.id)).toEqual(["m1", "m2"]);
    const entries = placeMoments({ from: "2026-11-16", to: "2026-12-16", entries: [], states: {} }, moments, strategy());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "moment", date: "2026-11-20", idea: { angle: "What I expect from the summit", pillar: "Retail media", momentDate: "2026-11-27" } });
  });

  it("places lead-ups that start inside the plan for moments after it, and skips dismissed or drafted moments", () => {
    const [later] = parseMoments([{ id: "m3", title: "Year-end review", date: "2026-12-20", endDate: null, leadDays: 7, category: "", url: null, description: null, suggestedAngle: "", inLeadWindow: false }]);
    const plan = { from: "2026-11-16", to: "2026-12-16", entries: [] };
    expect(placeMoments({ ...plan, states: {} }, [later], strategy())).toMatchObject([{ kind: "moment", date: "2026-12-13", moment: { id: "m3" } }]);
    for (const state of ["dismissed", "used"] as const) {
      expect(placeMoments({ ...plan, states: { [momentIdeaId(later)]: state } }, [later, ...moments], strategy()).map(entry => entry.key)).toEqual(["moment:m1"]);
    }
  });

  it("merges moment ideas on the client, honouring dismissed and saved states", () => {
    const [idea] = momentIdeas(moments, strategy(), "2026-11-16");
    const base = rankIdeas(generateIdeas(inputs()), []);
    expect(mergeMomentIdeas({ ideas: base, states: {} }, [idea])[1].id).toBe(idea.id);
    expect(mergeMomentIdeas({ ideas: base, states: { [idea.id]: "dismissed" } }, [idea]).some(entry => entry.id === idea.id)).toBe(false);
    expect(mergeMomentIdeas({ ideas: base, states: { [idea.id]: "saved" } }, [idea])[0]).toMatchObject({ id: idea.id, state: "saved" });
  });
});
