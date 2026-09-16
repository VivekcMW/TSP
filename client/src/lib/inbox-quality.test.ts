import { describe, expect, it } from "vitest";
import { isUsableInboxArticle } from "./inbox-quality";

const article = (headline: string, summary: string | null = null, articleUrl = "https://news.test/article") => ({ headline, summary, articleUrl });

describe("isUsableInboxArticle", () => {
  it.each([
    "Log in to Zoho Learn and access your knowledge source.",
    "  SIGN  IN TO your account  ",
    "Login", "Login to Zoho Learn", "Login | Zoho Learn", "Login - Zoho Learn",
  ])("hides an obvious access prompt: %s", (headline) => {
    expect(isUsableInboxArticle(article(headline, "Access your workspace and sign in to read the knowledge shared by your team."))).toBe(false);
  });

  it.each([null, "", "   ", "littleblackbook.com", "Welcome to Little Black Book.", "https://littleblackbook.com/"])("hides a hostname fallback without substantive text (%s)", (summary) => {
    expect(isUsableInboxArticle(article("littleblackbook.com", summary, "https://littleblackbook.com/"))).toBe(false);
  });

  it.each([" LITTLEBLACKBOOK.COM ", "www.littleblackbook.com", "https://littleblackbook.com/", "littleblackbook.com."])("normalizes hostname fallback %s", (headline) => {
    expect(isUsableInboxArticle(article(headline, null, "https://www.littleblackbook.com/news/story"))).toBe(false);
  });

  it("retains a domain-only title with substantive article text", () => {
    expect(isUsableInboxArticle(article("littleblackbook.com", "The agency announced a new campaign that brings independent creators into its production team.", "https://littleblackbook.com/news/story"))).toBe(true);
  });

  it.each([
    "Login security best practices", "Login failures explained", "Authentication and DNS explained",
    "How to sign in to apps with passkeys", "Why ‘Log in to Zoho Learn’ appears on your screen",
    "DNS: why example.com stopped resolving", "littleblackbook.com changes its DNS provider",
    "A real headline with no extracted summary", "Loginless authentication is here",
  ])("does not suppress legitimate coverage: %s", (headline) => {
    expect(isUsableInboxArticle(article(headline, null, "https://news.test/login"))).toBe(true);
  });

  it("keeps uncertain URLs and domain references on another publisher", () => {
    for (const url of ["", "not a URL", "https://other.test/dns", "ftp://littleblackbook.com/"]) {
      expect(isUsableInboxArticle(article("littleblackbook.com", null, url))).toBe(true);
    }
  });

  it("filters without mutating records or reordering retained items", () => {
    const bad = Object.freeze(article("Login"));
    const good = Object.freeze(article("Authentication research"));
    const items = Object.freeze([bad, good]);
    expect(items.filter(isUsableInboxArticle)).toEqual([good]);
    expect(items).toEqual([bad, good]);
  });
});