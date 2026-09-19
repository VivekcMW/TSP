import { z } from "zod";
import { timezoneSchema } from "./profile-preferences";

export const emailPreferencePatch = z.object({
  marketing: z.boolean().optional(), productUpdates: z.boolean().optional(),
  dailyDigest: z.boolean().optional(), contentAlerts: z.boolean().optional(),
  publishing: z.boolean().optional(), accountAlerts: z.boolean().optional(),
  weeklySummary: z.boolean().optional(), digestTimezone: timezoneSchema.optional(),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  unsubscribeAll: z.literal(true).optional(),
}).strict().refine(value => !value.unsubscribeAll || !Object.entries(value).some(([key, v]) => key !== "unsubscribeAll" && v === true),
  "Unsubscribe-all cannot enable a category");
export type EmailPreferencePatch = z.infer<typeof emailPreferencePatch>;
export const emailPreferenceDefaults = {
  marketing: true, productUpdates: true, dailyDigest: true, contentAlerts: false,
  publishing: true, accountAlerts: true, weeklySummary: false,
  digestTimezone: "UTC", digestTime: "09:00",
};
export type EmailPreferenceValues = typeof emailPreferenceDefaults;
export const emailCategoryKeys = ["marketing", "productUpdates", "dailyDigest", "contentAlerts", "publishing", "accountAlerts", "weeklySummary"] as const;
export function legacyNotificationView(prefs: EmailPreferenceValues) {
  return { dailyDigest: prefs.dailyDigest, contentAlerts: prefs.contentAlerts, productUpdates: prefs.productUpdates };
}