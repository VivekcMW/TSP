import type { DetailedPostResult, DetailedReviewResult, EditorialArticle } from "../../../server/services/punditBrain";
import type { FetchedArticle } from "../../../server/services/urlFetcher";
import type { ArticleMedia } from "@/components/dashboard/rich-article-editor";
import type { EditorialFormat } from "@shared/editorial";

export type { DetailedPostResult };
export type ReviewResponse = DetailedReviewResult & {
  article: FetchedArticle & { media?: ArticleMedia[] };
  format: EditorialFormat;
};
export type PostResponse = DetailedPostResult & { article: EditorialArticle; format: EditorialFormat };
export type ReviewSnapshots = Record<string, ReviewResponse>;

/** Keep each platform's evidence snapshot with its text, even if the URL changes later. */
export function mergeReviewSnapshots(previous: ReviewSnapshots, next: ReviewResponse): ReviewSnapshots {
  const snapshots = { ...previous };
  for (const platform of Object.keys(next.posts)) snapshots[platform] = next;
  return snapshots;
}

export function usablePost(content: string, limit = 5000): boolean {
  return Boolean(content.trim()) && content.length <= limit;
}