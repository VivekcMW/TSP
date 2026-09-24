import { describe, expect, it } from "vitest";
import { emailPreferenceDefaults, emailPreferencePatch, legacyNotificationView } from "@shared/email-preferences";
import { digestSlot, preferenceEnabled } from "./policy";
import { guardNotificationsMediaNetwork } from "../../../test/notifications-media-network";
guardNotificationsMediaNetwork();
describe("authoritative notification contract", () => {
  it("marketing is not a master switch", () => {
    const preference = { ...emailPreferenceDefaults, marketing: false };
    for (const type of ["daily_digest", "post_published", "oauth_connected", "product_update"] as const) expect(preferenceEnabled(type, preference)).toBe(true);
    expect(preferenceEnabled("welcome", preference)).toBe(false);
    expect(preferenceEnabled("content_alert", preference)).toBe(false);
  });
  it("categories and legacy view are independent", () => {
    const preference = { ...emailPreferenceDefaults, dailyDigest: false, contentAlerts: true, publishing: false, weeklySummary: true };
    expect(preferenceEnabled("daily_digest", preference)).toBe(false);
    expect(preferenceEnabled("weekly_summary", preference)).toBe(true);
    expect(preferenceEnabled("post_failed", preference)).toBe(false);
    expect(legacyNotificationView(preference)).toEqual({ dailyDigest: false, contentAlerts: true, productUpdates: true });
  });
  it("only essential types bypass unsubscribe", () => {
    const preference = { ...emailPreferenceDefaults, unsubscribedAt: new Date() };
    expect(preferenceEnabled("post_published", preference)).toBe(false);
    expect(preferenceEnabled("payment_failed", preference)).toBe(true);
    expect(preferenceEnabled("password_reset", preference)).toBe(true);
  });
  it.each([{ marketing: "false" }, { unknown: true }, { userId: "other" }, { digestTime: "24:00" }, { digestTimezone: "invalid" }, { unsubscribeAll: true, dailyDigest: true }])("rejects invalid input %#", input => {
    expect(emailPreferencePatch.safeParse(input).success).toBe(false);
  });
  it("gives reminders their own switch: on by default, off when turned off or unsubscribed", () => {
    expect(emailPreferenceDefaults.reminders).toBe(true);
    expect(preferenceEnabled("re_engagement", emailPreferenceDefaults)).toBe(true);
    expect(preferenceEnabled("re_engagement", { ...emailPreferenceDefaults, reminders: false })).toBe(false);
    expect(preferenceEnabled("re_engagement", { ...emailPreferenceDefaults, marketing: false })).toBe(true);
    expect(preferenceEnabled("re_engagement", { ...emailPreferenceDefaults, unsubscribedAt: new Date() })).toBe(false);
  });
  it("accepts a reminder pause of up to a year, or clearing it", () => {
    const day = 86_400_000;
    expect(emailPreferencePatch.parse({ remindersPausedUntil: new Date(Date.now() + 30 * day).toISOString() }).remindersPausedUntil).toBeInstanceOf(Date);
    expect(emailPreferencePatch.safeParse({ remindersPausedUntil: null }).success).toBe(true);
    expect(emailPreferencePatch.safeParse({ reminders: false }).success).toBe(true);
    expect(emailPreferencePatch.safeParse({ remindersPausedUntil: new Date(Date.now() + 400 * day).toISOString() }).success).toBe(false);
    expect(emailPreferencePatch.safeParse({ remindersPausedUntil: "next month" }).success).toBe(false);
  });
  it("allows explicit category opt-in and all opt-out", () => {
    expect(emailPreferencePatch.safeParse({ marketing: false, dailyDigest: true }).success).toBe(true);
    expect(emailPreferencePatch.safeParse({ unsubscribeAll: true }).success).toBe(true);
  });
});
describe("DST local digest slots", () => {
  it("waits for the chosen time including fractional offsets", () => {
    expect(digestSlot(new Date("2026-09-19T03:29:00Z"), "Asia/Kolkata", "09:00")).toBeUndefined();
    expect(digestSlot(new Date("2026-09-19T03:30:00Z"), "Asia/Kolkata", "09:00")).toBe("2026-09-19");
  });
  it("spring-forward gap catches up at first valid time", () => {
    expect(digestSlot(new Date("2026-03-08T06:59:00Z"), "America/New_York", "02:30")).toBeUndefined();
    expect(digestSlot(new Date("2026-03-08T07:00:00Z"), "America/New_York", "02:30")).toBe("2026-03-08");
  });
  it("fall-back repeated hour maps to the same durable day", () => {
    expect(digestSlot(new Date("2026-11-01T05:30:00Z"), "America/New_York", "01:30")).toBe("2026-11-01");
    expect(digestSlot(new Date("2026-11-01T06:30:00Z"), "America/New_York", "01:30")).toBe("2026-11-01");
  });
  it("uses local date, not UTC date, and rejects invalid historical config", () => {
    expect(digestSlot(new Date("2026-09-19T01:00:00Z"), "America/Los_Angeles", "09:00")).toBe("2026-09-18");
    expect(digestSlot(new Date(), "garbage", "09:00")).toBeUndefined();
    expect(digestSlot(new Date(), "UTC", "9am")).toBeUndefined();
  });
});