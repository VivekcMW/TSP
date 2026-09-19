import { describe, expect, it } from "vitest";
import {
  focusDescriptionSchema, normalizeKeywords, profileFocusDescriptionSchema,
  profileKeywordsSchema, profileListSchema, reconcileKeywords, timezoneSchema,
  weightedKeywordSchema, type KeywordInput, type WeightedKeyword,
} from "./profile-preferences";

describe("normalizeKeywords", () => {
  it("accepts readonly legacy, weighted and mixed input without changing it", () => {
    const input = Object.freeze([
      " SaaS ",
      Object.freeze({ keyword: " AI ", weight: 0, category: "primary" as const }),
      Object.freeze({ keyword: "Cloud", weight: 1, category: "secondary" as const }),
      Object.freeze({ keyword: "Research", category: "related" as const }),
    ]);
    const result: WeightedKeyword[] = normalizeKeywords(input);
    expect(result).toEqual([
      { keyword: "SaaS", weight: 0.7 },
      { keyword: "AI", weight: 0, category: "primary" },
      { keyword: "Cloud", weight: 1, category: "secondary" },
      { keyword: "Research", weight: 0.7, category: "related" },
    ]);
    expect(input[0]).toBe(" SaaS ");
    expect(result[1]).not.toBe(input[1]);
    expect(normalizeKeywords(result)).toEqual(result);
  });

  it("deduplicates case-insensitively in first-seen order with first-seen metadata", () => {
    expect(normalizeKeywords([
      { keyword: " AI ", weight: 0.95, category: "primary" },
      "ai", " SaaS ", { keyword: "AI", weight: 0.1, category: "related" }, "saas",
    ])).toEqual([
      { keyword: "AI", weight: 0.95, category: "primary" },
      { keyword: "SaaS", weight: 0.7 },
    ]);
  });

  it("does not impose a request-specific list cap on service normalization", () => {
    expect(normalizeKeywords(Array.from({ length: 21 }, (_, i) => `Keyword ${i}`))).toHaveLength(21);
    expect(normalizeKeywords([])).toEqual([]);
  });

  it("validates duplicate entries too, rather than hiding malformed metadata", () => {
    expect(() => normalizeKeywords(["AI", { keyword: "ai", weight: -1 }])).toThrow();
  });
});

describe("reconcileKeywords", () => {
  it("preserves existing weights/categories while adding/removing/reordering selected keys", () => {
    const previous: readonly KeywordInput[] = Object.freeze([
      { keyword: " AI ", weight: 0, category: "primary" },
      { keyword: "Cloud", weight: 1, category: "secondary" },
      { keyword: "Removed", weight: 0.9, category: "related" },
      " Legacy ",
    ]);
    expect(reconcileKeywords(Object.freeze([" cloud ", "ai", "New", "Legacy", "AI"]), previous)).toEqual([
      { keyword: "cloud", weight: 1, category: "secondary" },
      { keyword: "ai", weight: 0, category: "primary" },
      { keyword: "New", weight: 0.7 },
      { keyword: "Legacy", weight: 0.7 },
    ]);
    expect(previous[0]).toEqual({ keyword: " AI ", weight: 0, category: "primary" });
    expect(reconcileKeywords([], previous)).toEqual([]);
    expect(reconcileKeywords([" New "], [])).toEqual([{ keyword: "New", weight: 0.7 }]);
  });
});

describe("keyword request validation", () => {
  it("preserves existing topical category labels", () => {
    expect(profileKeywordsSchema.parse([{ keyword: "Cloud", weight: 0, category: " Infrastructure " }]))
      .toEqual([{ keyword: "Cloud", weight: 0, category: "Infrastructure" }]);
  });

  it.each([
    null, {}, "AI", 42, [null], [42], [true], [[]], [{}], [" "], ["x".repeat(101)],
    [{ keyword: 42 }], [{ keyword: " " }], [{ keyword: "x".repeat(101) }],
    ...[null, "0.7", -0.1, 1.1, NaN, Infinity, -Infinity, false, {}]
      .map(weight => [{ keyword: "AI", weight }]),
    ...[null, 42, "", " ", "x".repeat(101), {}, []].map(category => [{ keyword: "AI", category }]),
  ])("rejects malformed keywords (%#)", input => {
    expect(profileKeywordsSchema.safeParse(input).success).toBe(false);
  });

  it("validates the raw list count before deduplication, without slicing", () => {
    expect(profileKeywordsSchema.safeParse(Array(21).fill("AI")).success).toBe(false);
    expect(profileKeywordsSchema.parse(Array(20).fill("AI"))).toEqual([{ keyword: "AI", weight: 0.7 }]);
    const twenty = Array.from({ length: 20 }, (_, i) => `Keyword ${i}`);
    expect(profileKeywordsSchema.parse(twenty)).toHaveLength(20);
    expect(profileKeywordsSchema.parse([])).toEqual([]);
    expect(weightedKeywordSchema.parse({ keyword: " AI " })).toEqual({ keyword: "AI", weight: 0.7 });
  });
});

describe("profile list validation", () => {
  it("trims and deduplicates without requiring any selection", () => {
    expect(profileListSchema.parse([" Lab ", "lab", " Research "])).toEqual(["Lab", "Research"]);
    expect(profileListSchema.parse([])).toEqual([]);
    expect(profileListSchema.parse(["x".repeat(100)])).toEqual(["x".repeat(100)]);
  });

  it.each([null, {}, "Lab", [null], [42], [{}], [" "], ["x".repeat(101)], Array(21).fill("Lab")])(
    "rejects invalid or oversized lists (%#)", input => {
      expect(profileListSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe("focus validation", () => {
  it.each([10, 500])("trims and accepts the %i-character boundary", length => {
    expect(focusDescriptionSchema.parse(` ${"x".repeat(length)} `)).toBe("x".repeat(length));
    expect(profileFocusDescriptionSchema.parse(` ${"x".repeat(length)} `)).toBe("x".repeat(length));
  });

  it.each([undefined, null, {}, [], 1234567890, true, "short", "x".repeat(501)])("rejects malformed/invalid focus (%#)", input => {
    expect(focusDescriptionSchema.safeParse(input).success).toBe(false);
    expect(profileFocusDescriptionSchema.safeParse(input).success).toBe(false);
  });

  it.each(["", " \t\n "])("allows clearing only in profile patches (%#)", input => {
    expect(focusDescriptionSchema.safeParse(input).success).toBe(false);
    expect(profileFocusDescriptionSchema.parse(input)).toBe("");
  });
});

describe("timezone validation", () => {
  it.each(["UTC", "America/New_York", "Asia/Kolkata"])("accepts %s via Intl", timezone => {
    expect(timezoneSchema.parse(` ${timezone} `)).toBe(timezone);
  });

  it.each([null, 42, {}, [], "", " ", "Not/A_Timezone", "x".repeat(101)])("rejects invalid timezone (%#)", timezone => {
    expect(timezoneSchema.safeParse(timezone).success).toBe(false);
  });
});