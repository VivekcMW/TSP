import { describe, expect, it } from "vitest";
import { dateKeyInTimeZone, publishingDefaults, scheduleTimeValidation, timeKeyInTimeZone, zonedTimeToUtc } from "./calendar";

describe("publishing wall-clock conversion", () => {
  it.each([
    ["2026-09-20", "09:00", "Asia/Kolkata", "2026-09-20T03:30:00.000Z"],
    ["2026-09-20", "09:00", "America/Los_Angeles", "2026-09-20T16:00:00.000Z"],
    ["2026-03-08", "03:30", "America/New_York", "2026-03-08T07:30:00.000Z"],
    ["2026-11-01", "02:30", "America/New_York", "2026-11-01T07:30:00.000Z"],
    ["2026-03-29", "03:30", "Europe/Berlin", "2026-03-29T01:30:00.000Z"],
    ["2026-09-20", "00:15", "Pacific/Auckland", "2026-09-19T12:15:00.000Z"],
    ["2026-09-20", "09:00", "Asia/Kathmandu", "2026-09-20T03:15:00.000Z"],
  ])("converts %s %s in %s without browser-local setters", (date, time, zone, utc) => {
    const instant = zonedTimeToUtc(date, time, zone);
    expect(instant.toISOString()).toBe(utc);
    expect(dateKeyInTimeZone(instant, zone)).toBe(date);
    expect(timeKeyInTimeZone(instant, zone)).toBe(time);
  });
  it.each([
    ["2026-03-08", "02:30", "America/New_York", "does not exist"],
    ["2026-11-01", "01:30", "America/New_York", "occurs twice"],
    ["2026-03-29", "02:30", "Europe/Berlin", "does not exist"],
    ["2026-10-25", "02:30", "Europe/Berlin", "occurs twice"],
    ["2026-10-04", "02:15", "Australia/Lord_Howe", "does not exist"],
    ["2026-04-05", "01:45", "Australia/Lord_Howe", "occurs twice"],
  ])("rejects DST edge %s %s %s", (date, time, zone, reason) => {
    expect(() => zonedTimeToUtc(date, time, zone)).toThrow(reason);
  });
  it.each([["2026-02-30", "09:00"], ["2026-13-01", "09:00"], ["2026-01-01", "24:00"], ["", "09:00"], ["2026-01-01", ""]])("rejects invalid fields %s %s", (date, time) => {
    expect(scheduleTimeValidation(date, time, "UTC").publishAt).toBeNull();
  });
  it("validates future time and profile defaults", () => {
    const now = Date.parse("2026-09-20T03:30:00Z");
    expect(scheduleTimeValidation("2026-09-20", "09:00", "Asia/Kolkata", now).error).toContain("future");
    expect(publishingDefaults({ timezone: "Asia/Kolkata", preferredPublishTime: "18:45" })).toEqual({ timeZone: "Asia/Kolkata", time: "18:45" });
    expect(publishingDefaults({ timezone: "invalid-zone", preferredPublishTime: "99:99" })).toEqual({ timeZone: "UTC", time: "09:00" });
  });
});