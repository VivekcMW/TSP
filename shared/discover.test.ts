import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISCOVER_FILTERS, addedRelativeLabel, discoverFacets, filterDiscoverRows, hasActiveDiscoverFilters,
  isNew, sortDiscoverRows, type DiscoverRow,
} from "./discover";

const now = new Date("2025-06-15T12:00:00").getTime();
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
const row = (id: string, extra: Partial<DiscoverRow> = {}): DiscoverRow =>
  ({ id, headline: `Headline ${id}`, source: "Source A", matchedKeywords: [], ...extra });

describe("Discover filters", () => {
  const rows = [
    row("today", { discoveredAt: ago(0.01), matchedKeywords: ["AI"], source: "Wire" }),
    row("week", { discoveredAt: ago(3), matchedKeywords: ["Design"], readAt: ago(1) }),
    row("month", { createdAt: ago(20), headline: "Quantum chips" }),
    row("old", { discoveredAt: ago(60) }),
    row("undated"),
  ];
  const ids = (filters: Partial<typeof DEFAULT_DISCOVER_FILTERS>, locallyRead?: Set<string>) =>
    filterDiscoverRows(rows, { ...DEFAULT_DISCOVER_FILTERS, ...filters }, { now, locallyRead }).map(item => item.id);

  it("matches search against headline, source and keywords case-insensitively", () => {
    expect(ids({ search: "quantum" })).toEqual(["month"]);
    expect(ids({ search: "wire" })).toEqual(["today"]);
    expect(ids({ search: " design " })).toEqual(["week"]);
  });

  it("filters by added window using discoveredAt with createdAt fallback, excluding undated rows", () => {
    expect(ids({ added: "today" })).toEqual(["today"]);
    expect(ids({ added: "7d" })).toEqual(["today", "week"]);
    expect(ids({ added: "30d" })).toEqual(["today", "week", "month"]);
    expect(ids({ added: "any" })).toHaveLength(5);
  });

  it("filters by topic, source and reading state including local reads", () => {
    expect(ids({ topic: "AI" })).toEqual(["today"]);
    expect(ids({ source: "Wire" })).toEqual(["today"]);
    expect(ids({ reading: "read" })).toEqual(["week"]);
    expect(ids({ reading: "unread" }, new Set(["today"]))).toEqual(["month", "old", "undated"]);
  });

  it("reports whether any filter is active", () => {
    expect(hasActiveDiscoverFilters(DEFAULT_DISCOVER_FILTERS)).toBe(false);
    expect(hasActiveDiscoverFilters({ ...DEFAULT_DISCOVER_FILTERS, search: "  " })).toBe(false);
    expect(hasActiveDiscoverFilters({ ...DEFAULT_DISCOVER_FILTERS, reading: "unread" })).toBe(true);
  });
});

describe("Discover sort", () => {
  const rows = [
    row("a", { rankingScore: "0.2", publishedAt: null, discoveredAt: ago(2) }),
    row("b", { rankingScore: "0.9", publishedAt: ago(5), discoveredAt: ago(1) }),
    row("c", { relevanceScore: "0.5", publishedAt: ago(1), createdAt: ago(3) }),
    row("d", { rankingScore: "0.9" }),
  ];
  const order = (sort: Parameters<typeof sortDiscoverRows>[1]) => sortDiscoverRows(rows, sort).map(item => item.id);

  it("orders by recently added with missing dates last", () => expect(order("added")).toEqual(["b", "a", "c", "d"]));
  it("orders by relevance, keeping server order for ties", () => expect(order("relevance")).toEqual(["b", "d", "c", "a"]));
  it("orders by newest published with missing dates last", () => expect(order("published")).toEqual(["c", "b", "a", "d"]));
  it("does not mutate the input", () => { sortDiscoverRows(rows, "published"); expect(rows.map(item => item.id)).toEqual(["a", "b", "c", "d"]); });
});

describe("Discover New semantics", () => {
  const previous = ago(1);
  it("is New only when added after the previous visit and unopened", () => {
    expect(isNew(row("x", { discoveredAt: ago(0.5) }), previous)).toBe(true);
    expect(isNew(row("x", { discoveredAt: ago(2) }), previous)).toBe(false);
    expect(isNew(row("x", { discoveredAt: ago(0.5), readAt: ago(0.1) }), previous)).toBe(false);
    expect(isNew(row("x", { discoveredAt: ago(0.5) }), previous, new Set(["x"]))).toBe(false);
  });
  it("treats nothing as New without a visit marker", () => {
    expect(isNew(row("x", { discoveredAt: ago(0) }), null)).toBe(false);
    expect(isNew(row("x"), previous)).toBe(false);
  });
});

describe("Discover facets and labels", () => {
  it("returns sorted distinct topics and sources", () => {
    expect(discoverFacets([row("1", { matchedKeywords: ["b", "A"], source: "Zed" }), row("2", { matchedKeywords: ["A", ""], source: "alpha" })]))
      .toEqual({ topics: ["A", "b"], sources: ["alpha", "Zed"] });
  });
  it("labels added time separately from publication", () => {
    expect(addedRelativeLabel(row("x"), now)).toBeNull();
    expect(addedRelativeLabel(row("x", { discoveredAt: new Date(now - 10_000).toISOString() }), now)).toBe("Added just now");
    expect(addedRelativeLabel(row("x", { discoveredAt: new Date(now - 5 * 60_000).toISOString() }), now)).toBe("Added 5m ago");
    expect(addedRelativeLabel(row("x", { discoveredAt: ago(0.25) }), now)).toBe("Added 6h ago");
    expect(addedRelativeLabel(row("x", { createdAt: ago(3) }), now)).toBe("Added 3d ago");
  });
});
