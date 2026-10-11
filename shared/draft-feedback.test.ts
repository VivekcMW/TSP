import { describe, expect, it } from "vitest";
import { draftChangeRatio } from "./draft-feedback";

describe("draftChangeRatio", () => {
  it("records no change without retaining content", () => {
    expect(draftChangeRatio("same", "same")).toBe(0);
  });

  it("measures bounded changes while preserving shared edges", () => {
    expect(draftChangeRatio("A clear point.", "A stronger point.")).toBe(0.4118);
    expect(draftChangeRatio("draft", "rewritten")).toBe(1);
  });

  it("handles insertions and empty input", () => {
    expect(draftChangeRatio("", "new")).toBe(1);
    expect(draftChangeRatio("post", "post today")).toBe(0.6);
  });
});
