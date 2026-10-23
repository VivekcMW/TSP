import type { Draft } from "@shared/schema";
import { dateKeyInTimeZone } from "./calendar";
import { contentStatusGroup, publishingStatus, type PublishingSchedule } from "./publishing";
import { computeStreak } from "./streak";

type MetricDraft = Pick<Draft, "id" | "publishStatus" | "publishedAt" | "createdAt" | "platform">;

function shiftDate(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildOverviewMetrics(drafts: MetricDraft[], schedules: PublishingSchedule[], timeZone: string, now = new Date()) {
  const today = dateKeyInTimeZone(now, timeZone);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = shiftDate(today, -((weekday + 6) % 7));
  const priorWeekStart = shiftDate(weekStart, -7);
  const monthStart = shiftDate(today, -29);
  const published = drafts.filter(draft => draft.publishStatus === "published" && draft.publishedAt &&
    Number.isFinite(new Date(draft.publishedAt).getTime()) && new Date(draft.publishedAt) <= now);
  const publishedThisWeek = published.filter(draft => dateKeyInTimeZone(draft.publishedAt!, timeZone) >= weekStart);
  const publishedLastWeek = published.filter(draft => {
    const day = dateKeyInTimeZone(draft.publishedAt!, timeZone);
    return day >= priorWeekStart && day < weekStart;
  });
  const published30 = published.filter(draft => dateKeyInTimeZone(draft.publishedAt!, timeZone) >= monthStart);
  const durations = published30.flatMap(draft => {
    if (!draft.createdAt) return [];
    const duration = new Date(draft.publishedAt!).getTime() - new Date(draft.createdAt).getTime();
    return Number.isFinite(duration) && duration >= 0 ? [duration] : [];
  });
  const scheduleByDraft = new Map(schedules.map(schedule => [schedule.draftId, schedule]));
  const groupFor = (draft: MetricDraft) => contentStatusGroup(draft.publishStatus, scheduleByDraft.get(draft.id));
  const attention = new Set(drafts.filter(draft => groupFor(draft) === "attention").map(draft => draft.id));
  const pending = new Set(drafts.filter(draft => groupFor(draft) === "scheduled").map(draft => draft.id));
  for (const schedule of schedules) {
    const status = publishingStatus(schedule).key;
    if (status === "attention") attention.add(schedule.draftId);
    if (status === "pending") pending.add(schedule.draftId);
  }
  for (const id of attention) pending.delete(id);
  const platforms = new Map<string, number>();
  for (const draft of published30) platforms.set(draft.platform, (platforms.get(draft.platform) ?? 0) + 1);
  return {
    streak: computeStreak(published.map(draft => draft.publishedAt), timeZone, now),
    readyDrafts: drafts.filter(draft => groupFor(draft) === "ready"),
    scheduledCount: pending.size,
    attentionCount: attention.size,
    publishedThisWeek: publishedThisWeek.length,
    weekDelta: publishedThisWeek.length - publishedLastWeek.length,
    published30: published30.length,
    avgPublishHours: durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length / 3_600_000 : null,
    platforms: [...platforms].map(([platform, posts]) => ({ platform, posts })),
  };
}
