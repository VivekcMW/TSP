import { describe, expect, it } from "vitest";
import { sanitizeUrl } from "./analytics-consent";

describe("sanitizeUrl", () => {
  it("removes a reset token from the query", () => {
    expect(sanitizeUrl("https://www.thesocialpundit.com/reset-password?token=abc123"))
      .toBe("https://www.thesocialpundit.com/reset-password");
  });

  it("removes every sensitive parameter but keeps the harmless ones", () => {
    expect(sanitizeUrl("https://x.test/p?tab=drafts&token=t&code=c&state=s&email=a%40b.c&text=secret&draft=d1&utm_source=linkedin"))
      .toBe("https://x.test/p?tab=drafts&utm_source=linkedin");
  });

  it("keeps marketing and ad-click parameters untouched", () => {
    const url = "https://x.test/?utm_source=linkedin&utm_medium=social&utm_campaign=c&gclid=g1";
    expect(sanitizeUrl(url)).toBe(url);
  });

  it("cleans sensitive parameters nested inside returnTo", () => {
    const nested = encodeURIComponent("/dashboard/create?text=secret draft&tab=a");
    expect(sanitizeUrl(`https://x.test/sign-in?returnTo=${nested}`))
      .toBe(`https://x.test/sign-in?returnTo=${encodeURIComponent("/dashboard/create?tab=a")}`);
  });

  it("preserves the hash fragment", () => {
    expect(sanitizeUrl("https://x.test/docs?token=t#section-2")).toBe("https://x.test/docs#section-2");
  });

  it("returns an empty string for an empty or unparseable value", () => {
    expect(sanitizeUrl("")).toBe("");
    expect(sanitizeUrl("not a url")).toBe("");
  });
});
