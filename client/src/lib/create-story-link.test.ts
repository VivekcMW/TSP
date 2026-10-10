import { describe, expect, it } from "vitest";
import { storyLinkFromSearch, storyLinkFromState, withoutArticleParam, withoutStoryLink } from "./create-story-link";

describe("opening Create with a story link", () => {
  it("accepts only an https link passed in navigation state", () => {
    expect(storyLinkFromState({ createFromUrl: "https://news.google.com/rss/articles/abc?oc=5" })).toBe("https://news.google.com/rss/articles/abc?oc=5");
    for (const state of [null, undefined, "https://x.test", {}, { createFromUrl: "javascript:alert(1)" }, { createFromUrl: "http://plain.test/" },
      { createFromUrl: 42 }, { createFromUrl: `https://long.test/${"x".repeat(2100)}` }]) {
      expect(storyLinkFromState(state)).toBeUndefined();
    }
  });

  it("removes the link from the state so a reload does not reopen it", () => {
    expect(withoutStoryLink({ createFromUrl: "https://a.test/", other: 1 })).toEqual({ other: 1 });
    expect(withoutStoryLink(null)).toBeNull();
  });

  it("accepts an https story link from a reminder email's ?article= parameter", () => {
    expect(storyLinkFromSearch(`?article=${encodeURIComponent("https://news.test/a?b=1&c=2")}`)).toBe("https://news.test/a?b=1&c=2");
    for (const search of ["", "?article=", `?article=${encodeURIComponent("javascript:alert(1)")}`, `?article=${encodeURIComponent("http://plain.test/")}`]) {
      expect(storyLinkFromSearch(search)).toBeUndefined();
    }
  });

  it("drops the article parameter from the address and keeps the rest", () => {
    expect(withoutArticleParam("/dashboard/create", "?article=x&ref=email")).toBe("/dashboard/create?ref=email");
    expect(withoutArticleParam("/dashboard/create", "?article=x")).toBe("/dashboard/create");
  });
});
