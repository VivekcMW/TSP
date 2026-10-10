import { describe, expect, it } from "vitest";
import type { ReviewResponse } from "@/lib/editorial";
import { applyReview, emptyArticle, isEdited, isSaved, isUnsaved, publicSourceUrl, sameDraftSource, saveLabel, versionCounts, versionKey } from "./create-post-state";
import { acknowledgeDraftSave, adoptDraftRevision, draftSaveBlocked, editDraftText, observeDraftRevision, parseDraftEditingSnapshot, type DraftEditingSnapshot } from "@shared/draft-revision";

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

  it("adds only the returned tone and keeps the others as they were", () => {
    const previous = applyReview({}, review("First"));
    const single = { ...review(), posts: { linkedin: { provocateur: "Bold take" } } } as unknown as ReviewResponse;
    const next = applyReview(previous, single);
    expect(next[versionKey("linkedin", "provocateur")]).toMatchObject({ content: "Bold take", tone: "provocateur" });
    expect(next[key]).toBe(previous[key]);
    const fresh = applyReview({}, single);
    expect(Object.keys(fresh)).toEqual([versionKey("linkedin", "provocateur")]);
  });

  it("keeps other platforms and the saved identity for same-source regeneration", () => {
    const previous = applyReview(applyReview({}, review()), review("Twitter version", undefined, "twitter"));
    previous[key] = { ...previous[key], savedId: "draft-a", savedContent: "Generated", savedUpdatedAt: null, status: "saved" };
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

  it("labels Save draft, Saving, Saved and Save changes without losing the draft identity", () => {
    const fresh = applyReview({}, review())[key];
    expect(saveLabel(fresh)).toBe("Save draft");
    expect(saveLabel({ ...fresh, status: "saving" })).toBe("Saving…");
    const saved = { ...fresh, savedId: "id/with ?characters", savedContent: fresh.content, status: "saved" as const };
    expect(isSaved(saved)).toBe(true);
    expect(saveLabel(saved)).toBe("Saved");
    const edited = editDraftText(saved, "Reviewed revision");
    expect(edited.savedId).toBe(saved.savedId);
    expect(saveLabel(edited)).toBe("Save changes");
    expect(saveLabel({ ...saved, content: "Out of sync" })).toBe("Save changes");
  });

  it.each(["checking", "conflict", "refresh-failed", "immutable", "failed", "saving", "unsaved"] as const)("counts matching text in %s as unconfirmed, not Saved", status => {
    const version = applyReview({}, review())[key];
    const state = { ...version, savedId: "saved-a", savedContent: version.content, status };
    expect(isSaved(state)).toBe(false);
    expect(versionCounts({ [key]: state })).toEqual({ total: 1, saved: 0, unsaved: 1 });
  });

  it("counts every platform/tone version, not only visible cards", () => {
    const versions = applyReview(applyReview({}, review()), review("X version", undefined, "twitter"));
    versions[key] = { ...versions[key], status: "saved", savedContent: versions[key].content, savedId: "saved-a" };
    expect(versionCounts(versions)).toEqual({ total: 8, saved: 1, unsaved: 7 });
    expect(versionCounts({})).toEqual({ total: 0, saved: 0, unsaved: 0 });
  });
});

describe("explicit three-way editing state", () => {
  const a: DraftEditingSnapshot = { id: "d", platform: "linkedin", tone: "professional", content: "A", updatedAt: "2030-01-01T00:00:00.000Z" };
  const b = { ...a, content: "B", updatedAt: "2030-01-01T00:00:01.000Z" };
  const initial = () => acknowledgeDraftSave(applyReview({}, review("A"))[key], "A", a);

  it("keeps baseline A, local C and remote B separate until an explicit choice", () => {
    const local = editDraftText(initial(), "C");
    const conflict = observeDraftRevision(local, b);
    expect(conflict).toMatchObject({ content: "C", savedContent: "A", savedUpdatedAt: a.updatedAt, latestRevision: b, status: "conflict" });
    expect(draftSaveBlocked(conflict)).toBe(true); expect(isUnsaved(conflict)).toBe(true);
    const adopted = adoptDraftRevision(conflict, false);
    expect(adopted).toMatchObject({ content: "C", savedContent: "B", savedUpdatedAt: b.updatedAt, status: "unsaved" });
    expect(draftSaveBlocked(adopted)).toBe(false);
    const loaded = adoptDraftRevision(conflict, true);
    expect(loaded).toMatchObject({ content: "B", original: "A", review: local.review, status: "saved" });
  });
  it("does not silently adopt even matching local and remote text on a new revision", () => {
    const state = observeDraftRevision(editDraftText(initial(), "B"), b);
    expect(state.status).toBe("conflict"); expect(state.savedContent).toBe("A");
    expect(adoptDraftRevision(state, false).status).toBe("saved");
  });
  it("requires review for timestamp-only changes, including null legacy revisions", () => {
    expect(observeDraftRevision(initial(), { ...a, updatedAt: b.updatedAt }).status).toBe("conflict");
    const legacy = acknowledgeDraftSave(initial(), "A", { ...a, updatedAt: null });
    expect(observeDraftRevision(legacy, { ...a, updatedAt: null }).status).toBe("saved");
    expect(observeDraftRevision(legacy, a).status).toBe("conflict");
    expect(observeDraftRevision(initial(), { ...a, updatedAt: "2030-01-01T01:00:00.000+01:00" }).status).toBe("saved");
  });
  it("adopts normalized submitted text but never marks a later local edit Saved", () => {
    expect(acknowledgeDraftSave(editDraftText(initial(), " B "), " B ", b)).toMatchObject({ content: "B", savedContent: "B", status: "saved" });
    expect(acknowledgeDraftSave(editDraftText(initial(), "C typed later"), " B ", b)).toMatchObject({ content: "C typed later", savedContent: "B", status: "unsaved" });
  });
  it.each(["conflict", "refresh-failed", "checking", "immutable", "failed"] as const)("typing the old baseline cannot clear %s", status => {
    const state = editDraftText({ ...initial(), status, latestRevision: b }, "A");
    expect(state.status).toBe(status);
    expect(adoptDraftRevision({ ...state, status: "refresh-failed" }, true).content).toBe("A");
  });
  it("a successful recheck preserves local work when the baseline did not change", () => {
    expect(observeDraftRevision({ ...editDraftText(initial(), "C"), status: "refresh-failed" }, a)).toMatchObject({ content: "C", savedContent: "A", status: "unsaved" });
  });
  it.each([null, { id: "d" }, { ...a, id: "other" }, { ...a, content: 5 }, { ...a, updatedAt: undefined }, { ...a, updatedAt: "bad" }, { ...a, platform: "twitter" }, { ...a, tone: "contrarian" }])("rejects malformed or mismatched canonical acknowledgement %j", value => {
    expect(() => parseDraftEditingSnapshot(value, a)).toThrow("could not be confirmed");
  });
  it("regeneration retains both baseline and unresolved conflict, never stale Saved", () => {
    const saved = observeDraftRevision(initial(), b);
    const next = applyReview({ [key]: saved }, review("A"))[key];
    expect(next).toMatchObject({ savedId: "d", savedContent: "A", savedUpdatedAt: a.updatedAt, latestRevision: b, status: "conflict" });
  });
});