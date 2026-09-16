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
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  const actual = partsFor(new Date(desired), timeZone);
  const offset = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second) - desired;
  return new Date(desired - offset);
}

export function dateKeyInTimeZone(value: Date | string, timeZone: string) {
  const parts = partsFor(typeof value === "string" ? new Date(value) : value, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function timeKeyInTimeZone(value: Date | string, timeZone: string) {
  const parts = partsFor(typeof value === "string" ? new Date(value) : value, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}
