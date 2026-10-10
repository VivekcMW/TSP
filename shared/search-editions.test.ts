import { describe, expect, it } from "vitest";
import { getSearchEdition, SEARCH_EDITIONS, searchEditionSchema } from "./search-editions";

const expected = [
  { id: "en-US", hl: "en-US", gl: "US", ceid: "US:en" },
  { id: "en-GB", hl: "en-GB", gl: "GB", ceid: "GB:en" },
  { id: "en-IN", hl: "en-IN", gl: "IN", ceid: "IN:en" },
  { id: "hi-IN", hl: "hi", gl: "IN", ceid: "IN:hi" },
  { id: "fr-FR", hl: "fr", gl: "FR", ceid: "FR:fr" },
  { id: "de-DE", hl: "de", gl: "DE", ceid: "DE:de" },
  { id: "es-ES", hl: "es", gl: "ES", ceid: "ES:es" },
  { id: "pt-BR", hl: "pt-419", gl: "BR", ceid: "BR:pt-419" },
  { id: "ja-JP", hl: "ja", gl: "JP", ceid: "JP:ja" },
  { id: "en-AU", hl: "en-AU", gl: "AU", ceid: "AU:en" },
  { id: "en-CA", hl: "en-CA", gl: "CA", ceid: "CA:en" },
];

describe("saved search editions", () => {
  it("offers exactly the eleven strict schema values with unique labels", () => {
    expect(searchEditionSchema.options).toEqual(expected.map(edition => edition.id));
    expect(SEARCH_EDITIONS.map(option => option.value)).toEqual(searchEditionSchema.options);
    expect(new Set(SEARCH_EDITIONS.map(option => option.label)).size).toBe(11);
    for (const option of SEARCH_EDITIONS) {
      expect(Object.keys(option).sort()).toEqual(["label", "value"]);
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(expected)("accepts $id and returns its exact provider parameters", edition => {
    expect(searchEditionSchema.parse(edition.id)).toBe(edition.id);
    expect(getSearchEdition(edition.id)).toEqual(edition);
    expect(getSearchEdition(edition.id)).toEqual(getSearchEdition(edition.id));
  });

  it.each([undefined, null, "", "en", "hi", "en-us", " en-US ", "en_US", "pt-419", "zh-CN",
    "en-US&gl=IN", "__proto__", "constructor", 0, true, [], ["en-IN"], {}, { id: "en-IN" }])(
    "rejects unsupported writes but safely falls back on reads (%#)", value => {
      expect(searchEditionSchema.safeParse(value).success).toBe(false);
      expect(getSearchEdition(value)).toEqual(expected[0]);
    },
  );

  it("defaults an omitted argument and does not share mutable parameter objects", () => {
    const result = getSearchEdition();
    result.hl = "changed";
    result.gl = "IN";
    result.ceid = "IN:hi";
    expect(getSearchEdition()).toEqual(expected[0]);
  });
});