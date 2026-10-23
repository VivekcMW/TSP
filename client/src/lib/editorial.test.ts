import { describe, expect, it } from "vitest";
import { usablePost } from "./editorial";
import { platformTextValidation } from "@shared/editorial";

describe("Create pure count consumer", () => {
  it.each(["", " \n", "😀".repeat(140), "😀".repeat(141), "https://a.test/" + "x".repeat(600), "https://a.test/" + "x".repeat(5000), "https://a.test/a https://b.test/b!"])("shares platform and raw-cap decisions for %j", content => {
    expect(usablePost(content, 280, "twitter")).toBe(platformTextValidation(content, "twitter", 280).error === null);
  });
  it("keeps the raw cap even with a larger requested platform limit", () => {
    expect(usablePost("a".repeat(5000), 10_000)).toBe(true);
    expect(usablePost("a".repeat(5001), 10_000)).toBe(false);
  });
});