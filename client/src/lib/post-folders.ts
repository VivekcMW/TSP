import type { Draft } from "@shared/schema";
import type { PostFolder } from "@shared/inbox-view";
import { contentStatusGroup, publicationOutcome, type PublishingSchedule } from "@/lib/publishing";

/** Same query keys and fetchers as the Content page, so both views share one cache. */
export const DRAFTS_KEY = ["/api/drafts"] as const;
export const SCHEDULES_KEY = ["/api/drafts/scheduled-info"] as const;

export interface PostRow { draft: Draft; schedule?: PublishingSchedule; folder: PostFolder; at: number }

const time = (value: unknown) => {
  const parsed = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Gmail folders over the Content page's status groups. Anything unresolved goes to Outbox, never to
 * Posted: only a confirmed publication or an explicit demo ("simulated") outcome counts as posted.
 */
export function postFolderOf(draft: Pick<Draft, "publishStatus">, schedule?: PublishingSchedule): PostFolder {
  const group = contentStatusGroup(draft.publishStatus, schedule);
  if (group === "ready") return "drafts";
  if (group === "scheduled") return "scheduled";
  if (group === "published") return "posted";
  return publicationOutcome(schedule) === "simulated" ? "posted" : "outbox";
}

/** A draft has at most one schedule (uniq_draft_schedules_draft_id), which may be cancelled history. */
export function postRows(drafts: readonly Draft[], schedules: readonly PublishingSchedule[]): PostRow[] {
  const byDraft = new Map(schedules.map(schedule => [schedule.draftId, schedule]));
  return drafts.map(draft => {
    const schedule = byDraft.get(draft.id);
    const folder = postFolderOf(draft, schedule);
    const at = folder === "scheduled" && schedule ? time(schedule.scheduledPublishAt)
      : folder === "posted" ? time(draft.publishedAt) || time(schedule?.updatedAt) || time(draft.updatedAt)
      : time(folder === "outbox" ? schedule?.updatedAt ?? draft.updatedAt : draft.updatedAt ?? draft.createdAt);
    return { draft, schedule, folder, at };
  });
}

/** Scheduled shows the next send first; every other folder shows the newest first. */
export function postsIn(rows: readonly PostRow[], folder: PostFolder, search = ""): PostRow[] {
  const needle = search.trim().toLocaleLowerCase();
  return rows
    .filter(row => row.folder === folder && (!needle || row.draft.content.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => folder === "scheduled" ? a.at - b.at : b.at - a.at);
}

export function postCounts(rows: readonly PostRow[]): Record<PostFolder, number> {
  const counts: Record<PostFolder, number> = { drafts: 0, scheduled: 0, posted: 0, outbox: 0 };
  for (const row of rows) counts[row.folder] += 1;
  return counts;
}
