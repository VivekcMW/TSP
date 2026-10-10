import { describe, expect, it } from "vitest";
import { rememberReturnTo, takeReturnTo } from "./return-to";

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) };
};
const story = `/dashboard/create?article=${encodeURIComponent("https://news.test/a")}`;

describe("returning to an emailed link after signing in", () => {
  it("brings someone back to the app page they were sent to, once", () => {
    const storage = memory();
    rememberReturnTo(story, storage, 1_000);
    expect(takeReturnTo(storage, 2_000)).toBe(story);
    expect(takeReturnTo(storage, 2_000)).toBeNull();
  });

  it("only returns to app pages", () => {
    const storage = memory();
    for (const path of ["https://evil.test/dashboard", "//evil.test/dashboard", "/\\evil.test", "/sign-in", "/dashboardx", `/dashboard/${"x".repeat(2400)}`]) {
      rememberReturnTo(path, storage);
      expect(takeReturnTo(storage), path).toBeNull();
    }
    rememberReturnTo("/dashboard/settings?tab=notifications&pause=reminders", storage);
    expect(takeReturnTo(storage)).toBe("/dashboard/settings?tab=notifications&pause=reminders");
  });

  it("forgets the page after half an hour", () => {
    const storage = memory();
    rememberReturnTo(story, storage, 0);
    expect(takeReturnTo(storage, 31 * 60_000)).toBeNull();
  });

  it("carries on when browser storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => rememberReturnTo(story, blocked)).not.toThrow();
    expect(takeReturnTo(blocked)).toBeNull();
    expect(takeReturnTo(undefined)).toBeNull();
  });
});
