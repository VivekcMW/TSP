import { describe, expect, it } from "vitest";
import { defaultSearchEdition, evidenceLabel, parseAgentEvent, parseOnboardingSuggestions, parsePreviewHeadlines, parseUnderstanding, previewTopics, readEventStream } from "./onboarding-suggestions";

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
    })).toEqual({ grounded: true, picks: [], note: "", items: [
      { kind: "source", name: "ExchangeWire", url: "https://www.exchangewire.com/", reason: "Programmatic coverage", evidence: { count: 4, headline: "DOOH spend rises" } },
      { kind: "source", name: "Script", reason: "Bad URL keeps the name" },
      { kind: "source", name: "No URL" },
      { kind: "source", name: "Bad evidence" },
    ] });
  });

  it("maps topic weights and people/company groups, deduplicating by name", () => {
    expect(parseOnboardingSuggestions("topics", { step: "topics", grounded: false, items: [
      { name: "Retail media", weight: 0.9 }, { name: "retail media", weight: 0.2 }, { name: "Heavy", weight: 4 },
    ] })).toEqual({ grounded: false, picks: [], note: "", items: [{ kind: "topic", name: "Retail media", weight: 0.9 }, { kind: "topic", name: "Heavy" }] });
    expect(parseOnboardingSuggestions("people", { step: "people", grounded: true,
      people: [{ name: "Ana Rao", reason: "CEO", evidence: { count: 2, headline: "Ana Rao on DOOH" } }],
      companies: [{ name: "Vistar Media", reason: "" }, { name: "ana rao" }],
    }).items).toEqual([
      { kind: "leader", name: "Ana Rao", reason: "CEO", evidence: { count: 2, headline: "Ana Rao on DOOH" } },
      { kind: "company", name: "Vistar Media" },
    ]);
  });

  it("marks people from the AI's general knowledge and never shows evidence for them", () => {
    expect(parseOnboardingSuggestions("people", { step: "people", grounded: true,
      people: [{ name: "Jane Leader", reason: "Founder", aiOnly: true, evidence: { count: 2, headline: "x" } }, { name: "Ana Rao", evidence: { count: 1, headline: "Ana Rao on DOOH" } }],
      companies: [{ name: "Acme", aiOnly: "yes" }],
    }).items).toEqual([
      { kind: "leader", name: "Jane Leader", reason: "Founder", aiOnly: true },
      { kind: "leader", name: "Ana Rao", evidence: { count: 1, headline: "Ana Rao on DOOH" } },
      { kind: "company", name: "Acme" },
    ]);
    expect(evidenceLabel({ kind: "leader", name: "Jane Leader", aiOnly: true })).toBe("AI suggestion");
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

describe("finish preview", () => {
  it("keeps safe headlines with Google News links and drops malformed ones", () => {
    expect(parsePreviewHeadlines({ step: "preview", grounded: true, headlines: [
      { title: " DOOH spend rises ", source: "ExchangeWire", link: "https://news.google.com/rss/articles/a", publishedAt: "2026-09-22T10:00:00.000Z", topic: "DOOH" },
      { title: "Unsafe link", source: "Desk", link: "javascript:alert(1)", publishedAt: null, topic: "DOOH" },
      { title: "", source: "Desk", link: null, topic: "DOOH" }, null,
    ] })).toEqual([
      { title: "DOOH spend rises", source: "ExchangeWire", link: "https://news.google.com/rss/articles/a", publishedAt: "2026-09-22T10:00:00.000Z", topic: "DOOH" },
      { title: "Unsafe link", source: "Desk", link: null, publishedAt: null, topic: "DOOH" },
    ]);
    expect(() => parsePreviewHeadlines({ step: "topics", grounded: true, items: [] })).toThrow();
  });

  it("previews the three highest-weighted topics, keeping the user's order for ties", () => {
    expect(previewTopics([{ keyword: "Low", weight: 0.2 }, { keyword: "First tie", weight: 0.7 }, { keyword: "Top", weight: 1 }, { keyword: "Second tie", weight: 0.7 }]))
      .toEqual(["Top", "First tie", "Second tie"]);
    expect(previewTopics([])).toEqual([]);
  });
});

describe("the agent's picks and note", () => {
  it("keeps only picks that name a returned item, using the item's spelling, and tidies the note", () => {
    expect(parseOnboardingSuggestions("people", { step: "people", grounded: true, note: "  People in this month's DOOH news.  ",
      picks: ["ana rao", "Invented Person", "Vistar Media", 42],
      people: [{ name: "Ana Rao" }], companies: [{ name: "Vistar Media" }],
    })).toMatchObject({ picks: ["Ana Rao", "Vistar Media"], note: "People in this month's DOOH news." });
  });
});

describe("understanding the user", () => {
  it("keeps a bounded summary and a usable follow-up question", () => {
    expect(parseUnderstanding({ role: " Head of Marketing ", industry: "OOH", focusAreas: ["DOOH", "", 5, "Measurement"], region: "India", audience: null,
      question: { text: "Which region do you cover?", options: ["India", "Global", ""] } })).toEqual({
      role: "Head of Marketing", industry: "OOH", focusAreas: ["DOOH", "Measurement"], region: "India", audience: null,
      question: { text: "Which region do you cover?", options: ["India", "Global"] },
    });
    expect(parseUnderstanding({ role: "Marketer", industry: "", focusAreas: [], question: { text: "Only one option?", options: ["A"] } }).question).toBeNull();
    expect(() => parseUnderstanding(null)).toThrow();
  });
});

describe("the agent's event stream", () => {
  const streamOf = (chunks: string[]) => new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }));

  it("delivers each event, even when one is split across chunks, and skips malformed blocks", async () => {
    const events: unknown[] = [];
    await readEventStream(streamOf(['data: {"type":"progress","step":"topics","message":"Sear', 'ching"}\n\ndata: not json\n\ndata: {"type":"done"}\n\n']), event => events.push(event));
    expect(events).toEqual([{ type: "progress", step: "topics", message: "Searching" }, { type: "done" }]);
  });

  it("parses progress, results, errors and done, and ignores anything else", () => {
    expect(parseAgentEvent({ type: "progress", step: "publications", message: "Found 57 recent articles" })).toEqual({ type: "progress", step: "publications", message: "Found 57 recent articles" });
    expect(parseAgentEvent({ type: "result", step: "topics", grounded: true, picks: ["DOOH"], note: "Core topics.", items: [{ name: "DOOH", weight: 1 }] }))
      .toEqual({ type: "result", step: "topics", result: { grounded: true, picks: ["DOOH"], note: "Core topics.", items: [{ kind: "topic", name: "DOOH", weight: 1 }] } });
    expect(parseAgentEvent({ type: "error", step: null, code: "ai_timeout" })).toEqual({ type: "error", step: null, code: "ai_timeout" });
    expect(parseAgentEvent({ type: "done" })).toEqual({ type: "done" });
    expect(parseAgentEvent({ type: "progress", step: "preview", message: "x" })).toBeNull();
    expect(parseAgentEvent({ type: "result", step: "topics" })).toBeNull();
    expect(parseAgentEvent("done")).toBeNull();
  });
});
