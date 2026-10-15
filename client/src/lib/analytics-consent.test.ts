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

  it("removes nested redirects rather than forwarding arbitrary URLs", () => {
    const nested = encodeURIComponent("/dashboard/create?text=secret draft&tab=a");
    expect(sanitizeUrl(`https://x.test/sign-in?returnTo=${nested}`))
      .toBe("https://x.test/sign-in");
  });

  it("removes fragments, unknown parameters and URL credentials", () => {
    expect(sanitizeUrl("https://name:secret@x.test/docs?access_token=t&custom=private#token=secret")).toBe("https://x.test/docs");
    expect(sanitizeUrl("https://x.test/?utm_campaign=a%40example.com")).toBe("https://x.test/");
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
  });

  it("returns an empty string for an empty or unparseable value", () => {
    expect(sanitizeUrl("")).toBe("");
    expect(sanitizeUrl("not a url")).toBe("");
  });
});
