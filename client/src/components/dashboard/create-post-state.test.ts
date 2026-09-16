import { describe, expect, it } from "vitest";
import type { ReviewResponse } from "@/lib/editorial";
import { applyReview, emptyArticle, isEdited, isUnsaved, publicSourceUrl, sameDraftSource, versionKey } from "./create-post-state";

// Pure state tests need only the source and generated versions, not provider metadata.
function review(content = "Generated", url = "https://news.test/a", platform = "linkedin"): ReviewResponse {
  return {
    article: { title: "Title", content: "Source text", source: "Desk", url, domain: "news.test" },
    posts: { [platform]: { thoughtLeader: content, industryInsider: content, provocateur: content, dataDriven: content } },
  } as ReviewResponse;
}
const key = versionKey("linkedin", "thoughtLeader");

describe("creation session state", () => {
  it("creates independent empty manual sources", () => {
    const first = emptyArticle(); first.title = "Changed";
    expect(emptyArticle()).toEqual({ title: "", content: "", media: [] });
  });

  it.each(["", "not a URL", "javascript:alert(1)", "file:///tmp/a", "https://user:secret@news.test/a"])("rejects unsafe source URL %s", value => {
    expect(publicSourceUrl(value)).toBeUndefined();
  });

  it("normalizes HTTP(S) source links", () => {
    expect(publicSourceUrl("https://news.test")).toBe("https://news.test/");
    expect(publicSourceUrl("http://news.test/a")).toBe("http://news.test/a");
  });

  it("never erases an edited version with empty replacement text", () => {
    const previous = applyReview({}, review());
    previous[key] = { ...previous[key], content: "Reviewed by me" };
    const next = applyReview(previous, review(" "));
    expect(next[key]).toBe(previous[key]);
    expect(isEdited(next[key])).toBe(true);
    expect(isUnsaved(next[key])).toBe(true);
    expect(next[key].review).toBe(previous[key].review);
  });

  it("keeps other platforms and the saved identity for same-source regeneration", () => {
    const previous = applyReview(applyReview({}, review()), review("Twitter version", undefined, "twitter"));
    previous[key] = { ...previous[key], savedId: "draft-a", savedContent: "Generated", status: "saved" };
    const next = applyReview(previous, review("Revised"));
    expect(next[key]).toMatchObject({ savedId: "draft-a", savedContent: "Generated", content: "Revised", status: "unsaved" });
    expect(next[versionKey("twitter", "thoughtLeader")]).toBe(previous[versionKey("twitter", "thoughtLeader")]);
    expect(previous[key].content).toBe("Generated");
    expect(isUnsaved(previous[key])).toBe(false);
  });

  it("does not PATCH an old draft when source, inbox identity or attachments change", () => {
    const original = review();
    const previous = applyReview({}, original, "inbox-a");
    previous[key] = { ...previous[key], savedId: "draft-a", savedContent: "Generated" };
    expect(applyReview(previous, review("New", "https://news.test/b"), "inbox-a")[key].savedId).toBeUndefined();
    expect(applyReview(previous, review(), "inbox-b")[key].savedId).toBeUndefined();
    const media = review();
    media.article.media = [{ id: "00000000-0000-4000-8000-000000000001", type: "image", name: "Photo", url: "/uploads/photo.png" }];
    expect(sameDraftSource(original, media)).toBe(false);
    expect(applyReview(previous, media, "inbox-a")[key].savedId).toBeUndefined();
  });

  it("treats changed manual source content as a new source", () => {
    const first = review("Generated", "");
    const second = review("Generated", ""); second.article.content = "Changed manual evidence";
    expect(sameDraftSource(first, second)).toBe(false);
  });
});