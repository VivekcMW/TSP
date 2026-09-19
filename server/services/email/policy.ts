import { emailPreferenceDefaults, type EmailPreferenceValues } from "@shared/email-preferences";
import type { EmailType } from "./index";

export function isEssentialEmail(type: EmailType) {
  return ["verification", "password_reset", "password_changed", "payment_succeeded", "payment_failed", "subscription_cancelled", "token_expired"].includes(type);
}

export function preferenceEnabled(type: EmailType, preference: (EmailPreferenceValues & { unsubscribedAt?: unknown }) = emailPreferenceDefaults) {
  if (isEssentialEmail(type)) return true;
  if (preference.unsubscribedAt) return false;
  if (type === "daily_digest") return preference.dailyDigest;
  if (type === "weekly_summary") return preference.weeklySummary;
  if (type === "content_alert") return preference.contentAlerts;
  if (["product_update", "maintenance", "incident"].includes(type)) return preference.productUpdates;
  if (["draft_generated", "draft_failed", "post_scheduled", "post_published", "post_failed"].includes(type)) return preference.publishing;
  if (["oauth_connected", "usage_warning"].includes(type)) return preference.accountAlerts;
  return preference.marketing;
}

/** Local calendar date is the slot: folds cannot send twice; gaps catch up at
 * the first valid wall time after the requested time. No past-day backfill. */
export function digestSlot(now: Date, timezone: string, time: string): string | undefined {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isFinite(now.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
    return `${p.hour}:${p.minute}` >= time ? `${p.year}-${p.month}-${p.day}` : undefined;
  } catch { return undefined; }
}