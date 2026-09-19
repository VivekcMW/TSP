import type { InboxItem } from "@shared/schema";

export function articleDateLabel(item: Pick<InboxItem, "publishedAt" | "discoveredAt" | "createdAt" | "qualityMetadata">): string {
  const date = item.qualityMetadata?.date;
  if (date?.quality === "valid" && date.precision === "day" && date.day) return `Published ${date.day} (date only)`;
  const valid = (value: Date | string | null | undefined) => {
    const time = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(time) && time <= Date.now() ? new Date(time).toLocaleDateString() : null;
  };
  const published = date?.quality === "valid" && date.precision === "instant" ? valid(item.publishedAt) : null;
  if (published) return `Published ${published}`;
  const discovered = valid(item.discoveredAt);
  if (discovered) return `Discovered ${discovered} · Publication date unknown`;
  const added = valid(item.createdAt);
  return added ? `Added ${added} · Publication date unknown` : "Publication date unknown";
}