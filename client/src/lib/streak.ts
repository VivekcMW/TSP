import { dateKeyInTimeZone } from "./calendar";

export interface StreakSummary {
  /** Consecutive days with a published post, counted back from today (or yesterday, if nothing is published yet today). */
  current: number;
  /** The longest such run across all published history. */
  longest: number;
  postedToday: boolean;
}

function addDaysToKey(dateKey: string, days: number): string {
  return new Date(new Date(`${dateKey}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Computes a real posting streak from actual published timestamps — no
 * fabricated or estimated activity. A streak started yesterday stays "alive"
 * (not reset to 0) until a full day passes with nothing published, so the
 * UI can encourage posting today to extend it.
 */
export function computeStreak(publishedAt: Array<string | Date | null | undefined>, timeZone: string, now = new Date()): StreakSummary {
  const dateKeys = new Set(publishedAt.filter((value): value is string | Date => Boolean(value)).map(value => dateKeyInTimeZone(value, timeZone)));
  if (!dateKeys.size) return { current: 0, longest: 0, postedToday: false };
  const todayKey = dateKeyInTimeZone(now, timeZone);
  const postedToday = dateKeys.has(todayKey);

  let current = 0;
  let cursor = postedToday ? todayKey : addDaysToKey(todayKey, -1);
  while (dateKeys.has(cursor)) { current++; cursor = addDaysToKey(cursor, -1); }

  const sorted = [...dateKeys].sort((a, b) => a.localeCompare(b));
  let longest = 0, run = 0, previous: string | null = null;
  for (const key of sorted) {
    run = previous && addDaysToKey(previous, 1) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  return { current, longest, postedToday };
}
