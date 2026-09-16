interface PublishingRecord {
  publishStatus: string | null;
  publishedAt: string | Date | null;
  platform: string;
}

/** Local calendar days, including today up to now, shared by count and chart. */
export function buildPublishingActivity<T extends PublishingRecord>(records: T[], days: number, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const published = records.filter((record) => {
    if (record.publishStatus !== "published" || !record.publishedAt) return false;
    const date = new Date(record.publishedAt);
    return date >= start && date <= now;
  });
  const activity = Array.from({ length: days }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    return {
      day: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      published: published.filter((record) => {
        const date = new Date(record.publishedAt!);
        return date >= day && date < next;
      }).length,
    };
  });
  const counts = new Map<string, number>();
  published.forEach((record) => counts.set(record.platform, (counts.get(record.platform) ?? 0) + 1));
  const missingDates = records.filter((record) => record.publishStatus === "published" &&
    (!record.publishedAt || !Number.isFinite(new Date(record.publishedAt).getTime()))).length;
  return { start, published, activity, platforms: [...counts].map(([platform, posts]) => ({ platform, posts })), missingDates };
}