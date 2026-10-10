import { z } from "zod";
import { timezoneSchema } from "./profile-preferences";

export const emailPreferencePatch = z.object({
  marketing: z.boolean().optional(), productUpdates: z.boolean().optional(),
  dailyDigest: z.boolean().optional(), contentAlerts: z.boolean().optional(),
  publishing: z.boolean().optional(), accountAlerts: z.boolean().optional(),
  weeklySummary: z.boolean().optional(), reminders: z.boolean().optional(),
  // "Pause for a month": at most a year ahead; null resumes.
  remindersPausedUntil: z.string().datetime({ offset: true }).transform(value => new Date(value))
    .refine(date => date.getTime() <= Date.now() + 366 * 86_400_000, "A pause can last at most a year").nullable().optional(),
  digestTimezone: timezoneSchema.optional(),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  unsubscribeAll: z.literal(true).optional(),
}).strict().refine(value => !value.unsubscribeAll || !Object.entries(value).some(([key, v]) => key !== "unsubscribeAll" && v === true),
  "Unsubscribe-all cannot enable a category");
/** What clients send (dates as ISO strings); updateEmailPreferences validates it. */
export type EmailPreferencePatch = z.input<typeof emailPreferencePatch>;
export const emailPreferenceDefaults = {
  marketing: true, productUpdates: true, dailyDigest: true, contentAlerts: false,
  publishing: true, accountAlerts: true, weeklySummary: false, reminders: true,
  remindersPausedUntil: null as Date | null,
  digestTimezone: "UTC", digestTime: "09:00",
};
export type EmailPreferenceValues = typeof emailPreferenceDefaults;
export const emailCategoryKeys = ["marketing", "productUpdates", "dailyDigest", "contentAlerts", "publishing", "accountAlerts", "weeklySummary", "reminders"] as const;
export function legacyNotificationView(prefs: EmailPreferenceValues) {
  return { dailyDigest: prefs.dailyDigest, contentAlerts: prefs.contentAlerts, productUpdates: prefs.productUpdates };
}