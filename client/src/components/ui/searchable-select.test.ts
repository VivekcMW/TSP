import { describe, expect, it } from "vitest";
import { matchScore } from "./searchable-select";

describe("searching a list by name", () => {
  it("matches the typed text inside the name, not scattered letters", () => {
    expect(matchScore("Singapore", "singa")).toBeGreaterThan(0);
    expect(matchScore("Bosnia and Herzegovina", "singa")).toBe(0);
  });

  it("ranks names that start with the text, then words that start with it, then the rest", () => {
    expect(matchScore("India", "ind")).toBe(1);
    expect(matchScore("United Kingdom", "king")).toBe(0.75);
    expect(matchScore("Czech Republic", "public")).toBe(0.5);
    expect(matchScore("Guinea-Bissau", "biss")).toBe(0.75);
  });

  it("shows everything before anything is typed, ignoring case and spaces", () => {
    expect(matchScore("Japan", "")).toBe(1);
    expect(matchScore("Japan", "  JAP ")).toBe(1);
  });
});
