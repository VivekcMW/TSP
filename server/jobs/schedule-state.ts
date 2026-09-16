/** Pending siblings take precedence over terminal outcomes. Never hide a failure. */
export function aggregateScheduleStatus(statuses: string[]): string {
  if (!statuses.length) return "cancelled";
  if (statuses.includes("publishing")) return "publishing";
  if (statuses.includes("scheduled")) return "scheduled";
  if (statuses.includes("queued")) return "queued";
  if (statuses.includes("unknown")) return "unknown";
  if (statuses.includes("failed")) return "failed";
  if (statuses.every((status) => status === "published")) return "published";
  if (statuses.includes("published")) return "partial";
  return "cancelled";
}