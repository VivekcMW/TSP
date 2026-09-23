import { describe, expect, it } from "vitest";
import { platformTextLength } from "./editorial";

describe("platform text length", () => {
  const link = `https://news.test/${"story-".repeat(15)}trial`;
  it("counts each link as 23 characters on X", () => {
    expect(platformTextLength(`${"a".repeat(250)} ${link}`, "twitter")).toBe(250 + 1 + 23);
    expect(platformTextLength(`${link} and ${link}`, "twitter")).toBe(23 + 5 + 23);
  });
  it("counts links at full length elsewhere", () => {
    expect(platformTextLength(`${"a".repeat(250)} ${link}`, "threads")).toBe(251 + link.length);
  });
});
