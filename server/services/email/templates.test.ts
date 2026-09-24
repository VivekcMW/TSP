import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailTemplates } from "./templates";
import { PLATFORM_LABELS, platformLabel } from "@shared/platform-labels";

const APP = process.env.APP_URL ?? "https://www.thesocialpundit.com";

describe("email content customers receive", () => {
  it("welcomes by industry name and leads into setup, in today's product words", () => {
    const email = emailTemplates.welcome("Media & Advertising");
    expect(email.subject).toBe("Welcome to TheSocialPundit · Media & Advertising");
    expect(email.primaryCta).toEqual({ label: "Continue your setup", url: `${APP}/onboarding` });
    expect(email.html).toContain("Discover");
    expect(email.html).not.toMatch(/inbox/i);
    expect(emailTemplates.welcome(null).subject).toBe("Welcome to TheSocialPundit");
  });

  it("receipts name the plan, amount in the right currency, payment ID and date", () => {
    const email = emailTemplates.paymentSucceeded({ planName: "Pro monthly", amountMinor: 99900, currency: "INR", paymentId: "pay_Abc123", paidAt: new Date("2026-09-25T10:00:00Z") });
    expect(email.html).toContain("<strong>Pro monthly</strong>");
    expect(email.html).toContain("₹999.00");
    expect(email.html).toContain("pay_Abc123");
    expect(email.html).toContain("25 September 2026");
    expect(email.html).not.toContain("Your plan");
    expect(emailTemplates.paymentSucceeded({ planName: "Pro yearly", amountMinor: 20000, currency: "USD", paymentId: "pay_1", paidAt: null }).html).toContain("$200.00");
  });

  it("gives cancellation dates that read the same everywhere", () => {
    expect(emailTemplates.subscriptionCancelled(new Date("2026-10-25T00:00:00Z")).html).toContain("25 October 2026");
    expect(emailTemplates.subscriptionCancelled(null).html).toContain("the end of your current billing period");
  });

  it("names platforms properly in publishing emails", () => {
    expect(emailTemplates.postPublished("linkedin").subject).toBe("Published to LinkedIn");
    const failed = emailTemplates.postFailed("twitter", "X rejected the post: duplicate content.");
    expect(failed.subject).toBe("Publishing failed on Twitter/X");
    expect(failed.html).toContain("X rejected the post: duplicate content.");
    expect(failed.primaryCta?.url).toBe(`${APP}/dashboard/content`);
  });

  it("digests read cleanly: intro, no repeated source, summaries, and a way back to Discover", () => {
    const email = emailTemplates.dailyDigest([
      { source: "Cricinfo", headline: "BCCI opens a new centre of excellence - Cricinfo", summary: "The centre in Bengaluru hosts training for all age groups.", url: "https://news.test/a" },
      { source: "The Times of India", headline: "Muthoot Fincorp bags BCCI rights | The Times of India", summary: "", url: "https://news.test/b" },
    ]);
    expect(email.html).toContain("Your top stories today");
    expect(email.html).toContain(">BCCI opens a new centre of excellence</a>");
    expect(email.html).toContain(">Muthoot Fincorp bags BCCI rights</a>");
    expect(email.html).toContain("The centre in Bengaluru hosts training");
    expect(email.primaryCta).toEqual({ label: "Open Discover", url: `${APP}/dashboard/discover` });
    expect(email.text).toContain("BCCI opens a new centre of excellence\nhttps://news.test/a");
    const trailing = emailTemplates.dailyDigest([{ source: "Cricinfo", headline: "Binny and Shah open a centre, Bengaluru, September 29, 2024, - Cricinfo", summary: "", url: "https://news.test/c" }]);
    expect(trailing.html).toContain(">Binny and Shah open a centre, Bengaluru, September 29, 2024</a>");
  });

  it("tells people when their password changes", () => {
    const email = emailTemplates.passwordChanged();
    expect(email.subject).toBe("Your TheSocialPundit password was changed");
    expect(email.html).toMatch(/If you didn't make this change/);
    expect(email.primaryCta?.url).toBe(`${APP}/sign-in`);
  });

  it("escapes every customer-supplied value", () => {
    expect(emailTemplates.welcome("<b>Ad</b>").subject).toContain("<b>Ad</b>");
    expect(emailTemplates.postFailed("reddit", "<script>x</script>").html).not.toContain("<script>");
    expect(emailTemplates.paymentSucceeded({ planName: "<i>Pro</i>", amountMinor: 1, currency: "INR", paymentId: "<p>", paidAt: null }).html).not.toMatch(/<i>|<p>&/);
  });
});

describe("platform names", () => {
  it("match the names the app shows", () => {
    const client = readFileSync(new URL("../../../client/src/lib/platforms.ts", import.meta.url), "utf8");
    const pairs = [...client.matchAll(/value: "([a-z]+)",\s*label: "([^"]+)"/g)].map(([, value, label]) => [value, label]);
    expect(pairs.length).toBeGreaterThan(20);
    for (const [value, label] of pairs) expect(PLATFORM_LABELS[value], value).toBe(label);
    expect(platformLabel("unknown_platform")).toBe("unknown_platform");
  });
});
