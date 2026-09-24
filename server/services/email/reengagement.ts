/**
 * "We miss you" reminders: after 7 quiet days (no sign-in, new draft or published post),
 * one email a week through a three-email series, then a monthly check-in. Any activity
 * restarts the series. Sent at the person's digest time; see jobs/email-reminders.ts.
 */
const DAY = 86_400_000;
export const QUIET_DAYS = 7;
const SERIES_LENGTH = 3;
const MONTHLY_DAYS = 30;

export type ReminderStep = 1 | 2 | 3 | "monthly";

export function reminderStep({ now, lastActivity, sent }: { now: Date; lastActivity: Date; sent: Date[] }): ReminderStep | null {
  if (now.getTime() - lastActivity.getTime() < QUIET_DAYS * DAY) return null;
  const series = sent.filter(date => date.getTime() > lastActivity.getTime()).sort((a, b) => a.getTime() - b.getTime());
  if (!series.length) return 1;
  const sinceLast = now.getTime() - series.at(-1)!.getTime();
  if (series.length < SERIES_LENGTH) return sinceLast >= QUIET_DAYS * DAY ? (series.length + 1) as 2 | 3 : null;
  return sinceLast >= MONTHLY_DAYS * DAY ? "monthly" : null;
}

/** Which of Email 1's approved subject lines this person gets this week. */
export function reminderSubjectVariant(userId: string, now: Date): 0 | 1 | 2 {
  const week = Math.floor(now.getTime() / (7 * DAY));
  let hash = week;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % 3) as 0 | 1 | 2;
}
