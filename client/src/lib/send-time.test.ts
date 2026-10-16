import { describe, expect, it } from "vitest";
import { distinctDaySendSlots, nextSendSlots } from "./send-time";

describe("send-time recommendations", () => {
  it("returns upcoming professional windows strictly after the given instant", () => {
    const from = new Date("2026-10-01T06:00:00.000Z"); // Thursday, before 09:00 UTC
    const slots = nextSendSlots(["linkedin"], "UTC", from, 3);
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ date: "2026-10-01", time: "09:00" });
    expect(slots.every(slot => slot.instant.getTime() > from.getTime())).toBe(true);
    // Strictly ascending
    for (let i = 1; i < slots.length; i++) expect(slots[i].instant.getTime()).toBeGreaterThan(slots[i - 1].instant.getTime());
  });

  it("skips a slot that has already passed today", () => {
    const from = new Date("2026-10-01T13:00:00.000Z"); // after 09:00 and 12:00 UTC on Thursday
    const slots = nextSendSlots(["linkedin"], "UTC", from, 1);
    expect(slots[0].date).not.toBe("2026-10-01");
  });

  it("merges windows across multiple platforms without duplicates", () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    const slots = nextSendSlots(["linkedin", "twitter"], "UTC", from, 10);
    const keys = slots.map(slot => `${slot.date}T${slot.time}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("falls back to a generic weekday morning window for unknown/empty platforms", () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    expect(nextSendSlots([], "UTC", from, 1)[0]).toMatchObject({ time: "09:00" });
    expect(nextSendSlots(["unknown-platform"], "UTC", from, 1)[0]).toMatchObject({ time: "09:00" });
  });

  it("uses weekend windows on Saturday/Sunday for casual-social platforms", () => {
    const saturday = new Date("2026-10-03T00:00:00.000Z");
    const slots = nextSendSlots(["facebook"], "UTC", saturday, 1);
    expect(slots[0]).toMatchObject({ date: "2026-10-03", time: "11:00" });
  });

  it("respects a non-UTC time zone", () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    const slots = nextSendSlots(["linkedin"], "Asia/Kolkata", from, 1);
    // 09:00 IST == 03:30 UTC
    expect(slots[0].instant.toISOString()).toBe("2026-10-01T03:30:00.000Z");
  });

  it("returns exactly one slot per distinct day for spreading drafts", () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    const slots = distinctDaySendSlots(["linkedin"], "UTC", from, 5);
    expect(slots).toHaveLength(5);
    const dates = slots.map(slot => slot.date);
    expect(new Set(dates).size).toBe(dates.length);
  });
});
