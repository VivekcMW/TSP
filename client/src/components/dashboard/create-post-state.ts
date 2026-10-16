import type { ReviewResponse } from "@/lib/editorial";
import type { ArticleMedia } from "./rich-article-editor";
import type { DraftEditingState } from "@shared/draft-revision";

export const CREATE_TONES = [
  { key: "thoughtLeader", value: "professional", label: "Thought Leader" },
  { key: "industryInsider", value: "authoritative", label: "Industry Insider" },
  { key: "provocateur", value: "contrarian", label: "Provocateur" },
  { key: "dataDriven", value: "ai-recommended", label: "Data-Driven" },
] as const;
export type CreateTone = typeof CREATE_TONES[number]["key"];
export interface ManualArticle { title: string; content: string; media: ArticleMedia[] }
export const emptyArticle = (): ManualArticle => ({ title: "", content: "", media: [] });
export interface PostVersion extends DraftEditingState {
  mainRevision?: number;
  platform: string;
  tone: CreateTone;
  content: string;
  original: string;
  review: ReviewResponse;
  inboxItemId?: string;
}
export interface MainDraft {
  title: string;
  content: string;
  original: string;
  revision: number;
  formatJson?: string;
  review?: ReviewResponse;
}
export type PostVersions = Record<string, PostVersion>;
export const versionKey = (platform: string, tone: CreateTone) => `${platform}:${tone}`;
export const isEdited = (version: PostVersion) => version.content !== version.original;
export const isSaved = (version: PostVersion) => Boolean(version.savedId) && version.status === "saved" && version.content === version.savedContent;
export function saveLabel(version: PostVersion): string {
  if (version.status === "saving") return "Saving…";
  if (isSaved(version)) return "Saved";
  return version.savedId ? "Save changes" : "Save draft";
}
export function versionCounts(versions: PostVersions) {
  const all = Object.values(versions);
  const saved = all.filter(isSaved).length;
  return { total: all.length, saved, unsaved: all.length - saved };
}
export const isUnsaved = (version: PostVersion) => version.content !== (version.savedContent ?? "") ||
  ["conflict", "refresh-failed", "failed"].includes(version.status);
export function publicSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** PATCH supports text only. Never reuse an id for a different source/media set. */
export function sameDraftSource(a: ReviewResponse, b: ReviewResponse): boolean {
  const source = (review: ReviewResponse) => JSON.stringify([
    review.article.url || [review.article.title, review.article.content], review.article.media ?? [],
  ]);
  return source(a) === source(b);
}

/** Only called after successful generation and explicit overwrite approval. */
function regeneratedStatus(saved: PostVersion | undefined, content: string): PostVersion["status"] {
  if (!saved?.savedId) return "unsaved";
  if (saved.savedUpdatedAt === undefined || saved.status === "checking") return "refresh-failed";
  if (["conflict", "refresh-failed", "immutable", "failed"].includes(saved.status)) return saved.status;
  return content === saved.savedContent ? "saved" : "unsaved";
}

export function applyReview(previous: PostVersions, review: ReviewResponse, inboxItemId?: string): PostVersions {
  const next = { ...previous };
  for (const [platform, posts] of Object.entries(review.posts)) {
    for (const tone of CREATE_TONES) {
      // Requests may ask for a single tone; tones that were not returned stay as they were.
      const content = posts[tone.key];
      if (typeof content !== "string") continue;
      const key = versionKey(platform, tone.key);
      const old = previous[key];
      // A malformed/empty replacement must not erase useful work.
      if (!content.trim() && old?.content.trim()) continue;
      const saved = old && sameDraftSource(old.review, review) && old.inboxItemId === inboxItemId ? old : undefined;
      next[key] = { platform, tone: tone.key, content, original: content, review, inboxItemId,
        savedId: saved?.savedId, savedContent: saved?.savedContent, savedUpdatedAt: saved?.savedUpdatedAt,
        latestRevision: saved?.latestRevision, error: saved?.error,
        status: regeneratedStatus(saved, content) };
    }
  }
  return next;
}

export function ignoreDiscoverShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
  const target = event.target;
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable='false']), [role='button'], [role='combobox'], [role='textbox'], [role='menu'], [role='tab'], [role='dialog'], [role='alertdialog']",
  ));
}