export const CALENDAR_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

function partsFor(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

export function formatCalendarDate(value: Date | string, timeZone: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(typeof value === "string" ? new Date(value) : value);
}

export function formatCalendarTime(value: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: "2-digit", minute: "2-digit" }).format(typeof value === "string" ? new Date(value) : value);
}

export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Choose a valid date and time.");
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  if (hour > 23 || minute > 59 || new Date(desired).toISOString().slice(0, 10) !== dateKey) throw new Error("Choose a valid date and time.");
  // Sample both sides of a possible transition, then round-trip every candidate.
  // A one-pass offset correction is wrong on DST transition days. Never silently
  // shift a nonexistent time or choose one of two repeated wall-clock times.
  const offsets = new Set<number>();
  for (const hours of [-48, -24, 0, 24, 48]) {
    const instant = desired + hours * 3_600_000;
    const p = partsFor(new Date(instant), timeZone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant);
  }
  const candidates = [...offsets].map((offset) => new Date(desired - offset)).filter((candidate) =>
    dateKeyInTimeZone(candidate, timeZone) === dateKey && timeKeyInTimeZone(candidate, timeZone) === time);
  if (!candidates.length) throw new Error(`This time does not exist in ${timeZone} because the clocks change. Choose another time.`);
  if (candidates.length > 1) throw new Error(`This time occurs twice in ${timeZone} because the clocks change. Choose an unambiguous time.`);
  return candidates[0];
}

export function scheduleTimeValidation(date: string, time: string, timeZone: string, now = Date.now()) {
  try {
    const publishAt = zonedTimeToUtc(date, time, timeZone);
    return publishAt.getTime() > now ? { publishAt, error: null } : { publishAt: null, error: "Choose a future date and time." };
  } catch (error) {
    return { publishAt: null, error: error instanceof Error ? error.message : "Choose a valid timezone, date and time." };
  }
}

export function publishingDefaults(profile?: { timezone?: string | null; preferredPublishTime?: string | null } | null) {
  const requested = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let timeZone = requested;
  try { new Intl.DateTimeFormat(undefined, { timeZone }).format(); } catch { timeZone = "UTC"; }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(profile?.preferredPublishTime ?? "") ? profile!.preferredPublishTime! : "09:00";
  return { timeZone, time };
}

export function dateKeyInTimeZone(value: Date | string, timeZone: string) {
  const parts = partsFor(typeof value === "string" ? new Date(value) : value, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function timeKeyInTimeZone(value: Date | string, timeZone: string) {
  const parts = partsFor(typeof value === "string" ? new Date(value) : value, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}
