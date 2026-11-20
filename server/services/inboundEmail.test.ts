import { describe, expect, it } from "vitest";
import {
  anchorsFromText, extractArticleLinks, forwardingConfirmation, generateAddressToken, inboundEmailConfig, inboundEmailDomain,
  inboundSecretFrom, inboundSecretMatches, isPublicLookingUrl, MAX_ARTICLE_LINKS, newsletterSender, newsletterSourceLabel,
  parsePostmarkInbound, recipientToken, titleFromUrl, unwrapRedirect,
} from "./inboundEmail";

// A typical editorial newsletter: header links, stories, a redirect-wrapped link, social footer and a pixel.
const RETAIL_BRIEF_HTML = `<!DOCTYPE html><html><head><title>The Retail Media Brief #42</title>
<style>a { color: #1a0dab; } .hidden { display:none }</style>
<script>var track = "https://brief.retailwire-news.com/p/should-not-appear";</script></head>
<body><table role="presentation" width="100%"><tr><td align="center">
  <a href="https://brief.retailwire-news.com/p/issue-42?utm_source=newsletter&amp;utm_medium=email">View this email in your browser</a>
</td></tr><tr><td>
  <a href="https://brief.retailwire-news.com/"><img src="https://cdn.retailwire-news.com/logo.png" alt="The Retail Media Brief" width="180"></a>
</td></tr><tr><td>
  <h2><a href="https://www.adweek.com/commerce/amazon-ads-sponsored-tv-2026/?utm_source=brief&amp;utm_medium=email&amp;utm_campaign=42">Amazon opens
    Sponsored&nbsp;TV to all sellers</a></h2>
  <p>Self-serve video comes to the long tail. <a href="https://www.adweek.com/commerce/amazon-ads-sponsored-tv-2026/#comments">Read more &rarr;</a></p>
  <p><a href="https://www.google.com/url?q=https://www.emarketer.com/content/retail-media-forecast-2026&amp;sa=D&amp;source=editors&amp;ust=1">Retail media will pass $60B, says new forecast</a></p>
  <p><a href="https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fdigiday.com%2Fmarketing%2Fwhy-walmart-connect-is-hiring%2F&amp;data=05%7C01%7Cx&amp;sdata=abc&amp;reserved=0">Why Walmart Connect is hiring</a></p>
  <p>Instacart rebrands its ad tools. <a href="https://www.theverge.com/2026/11/12/24123456/instacart-carrot-ads-retail-media-network">Click here</a></p>
  <p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Watch: our interview with the head of Kroger Precision Marketing</a></p>
</td></tr><tr><td>
  <a href="https://twitter.com/retailbrief">Twitter</a> |
  <a href="https://www.linkedin.com/company/retail-brief/">LinkedIn</a> |
  <a href="https://twitter.com/intent/tweet?url=https%3A%2F%2Fbrief.retailwire-news.com%2Fp%2Fissue-42&amp;text=Read">Share on X</a> |
  <a href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fbrief.retailwire-news.com%2Fp%2Fissue-42">Share</a>
  <p>Guest column: <a href="https://www.linkedin.com/pulse/retail-media-measurement-gap-jane-doe">The measurement gap, by Jane Doe</a></p>
  <p><a href="mailto:editor@retailwire-news.com">Reply to the editor</a> &middot;
    <a href="https://brief.retailwire-news.com/subscribe?ref=footer">Subscribe</a> &middot;
    <a href="https://brief.retailwire-news.com/account">Manage your subscription</a> &middot;
    <a href="https://brief.retailwire-news.com/action/disable_email?token=abc123">Unsubscribe</a> &middot;
    <a href="https://brief.retailwire-news.com/about">About us</a> &middot;
    <a href="https://apps.apple.com/app/retail-brief/id123456">Get the app</a></p>
  <img src="https://email.retailwire-news.com/o/eJyrVkrLz1eyUkpKLFKqBQAd" width="1" height="1" alt="" style="display:none">
</td></tr></table></body></html>`;

// Mailchimp-style: opaque click tracking (kept), archive and list-manage footer links (skipped).
const MAILCHIMP_HTML = `<html><body>
<p><a href="https://us5.campaign-archive.com/?u=abc123&amp;id=def456" target="_blank">View this email in your browser</a></p>
<h1><a href="https://acmeco.us5.list-manage.com/track/click?u=abc123&amp;id=111&amp;e=9f8e7d">Five lessons from our Q3 launch</a></h1>
<p><a href="https://acmeco.us5.list-manage.com/track/click?u=abc123&amp;id=222&amp;e=9f8e7d"><img src="https://mcusercontent.com/hero.jpg" alt="Hero image"></a></p>
<p><a href="https://acmeco.us5.list-manage.com/unsubscribe?u=abc123&amp;id=def456&amp;e=9f8e7d">unsubscribe from this list</a>
<a href="https://acmeco.us5.list-manage.com/profile?u=abc123&amp;id=def456">update subscription preferences</a>
<a href="https://acmeco.us5.list-manage.com/vcard?u=abc123">Add us to your address book</a></p>
<p><a href="http://localhost:3000/internal-preview">Preview</a> <a href="http://10.0.0.7/report">Internal report</a>
<a href="https://admin:secret@news.acmeco-blog.com/private-post">Private</a> <a href="https://www.example.com/story-about-things">Example story</a></p>
</body></html>`;

const MORNING_NOTES_TEXT = `Morning Notes — Issue 12
Good morning. Three things worth your time.

1. Shopify launches a retail media network
https://www.retaildive.com/news/shopify-retail-media-network/700001/?utm_source=morningnotes

2. The case for clean rooms (https://www.adexchanger.com/data-driven-thinking/the-case-for-clean-rooms/)

3. https://www.marketingweek.com/brand-building-in-a-recession-what-the-data-says/

Follow us https://twitter.com/morningnotes
Unsubscribe: https://morningnotes.co/unsubscribe?id=123
`;

const GMAIL_FORWARD_TEXT = `FYI, worth a read.

---------- Forwarded message ---------
From: Morning Brew <crew@morningbrew.com>
Date: Mon, Nov 16, 2026 at 6:02 AM
Subject: ☕ Ad money moves
To: <reader@gmail.com>

Today's top story https://www.morningbrew.com/daily/stories/2026/11/16/ad-money-moves
`;

const GMAIL_FORWARD_HTML = `<div dir="ltr">FYI<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>
From: <strong class="gmail_sendername" dir="auto">Morning Brew</strong> <span dir="auto">&lt;<a href="mailto:crew@morningbrew.com">crew@morningbrew.com</a>&gt;</span><br>
Date: Mon, Nov 16, 2026 at 6:02 AM<br>Subject: Ad money moves<br>To: &lt;<a href="mailto:reader@gmail.com">reader@gmail.com</a>&gt;<br></div><br>
<a href="https://www.morningbrew.com/daily">Morning Brew</a>
<a href="https://www.morningbrew.com/daily/stories/2026/11/16/ad-money-moves">Ad money moves to retail media</a>
</div></div>`;

const postmark = (overrides: Record<string, unknown> = {}) => ({
  From: "crew@morningbrew.com", FromName: "Morning Brew", FromFull: { Email: "crew@morningbrew.com", Name: "Morning Brew", MailboxHash: "" },
  To: "reader@gmail.com", ToFull: [{ Email: "reader@gmail.com", Name: "", MailboxHash: "" }], Cc: "", CcFull: [], BccFull: [],
  OriginalRecipient: "k3v9q2m8x7c4b1n6z5l0p2r8tw@in.thesocialpundit.com", Subject: "Ad money moves", MessageID: "0b1e2a7c-postmark-id",
  Date: "Mon, 16 Nov 2026 06:02:11 +0000", TextBody: "Hello", HtmlBody: "<p>Hello</p>", StrippedTextReply: "", Tag: "", Attachments: [],
  Headers: [{ Name: "Message-ID", Value: "<CAF=issue42@mail.morningbrew.com>" }, { Name: "X-Spam-Status", Value: "No" }],
  ...overrides,
});

describe("extractArticleLinks", () => {
  it("keeps story links, unwraps plain redirects and skips footer, social, homepage, mailto and pixels", () => {
    const { links, found } = extractArticleLinks({ html: RETAIL_BRIEF_HTML, senderDomains: ["retailwire-news.com"] });
    expect(links).toEqual([
      { url: "https://www.adweek.com/commerce/amazon-ads-sponsored-tv-2026/", title: "Amazon opens Sponsored TV to all sellers" },
      { url: "https://www.emarketer.com/content/retail-media-forecast-2026", title: "Retail media will pass $60B, says new forecast" },
      { url: "https://digiday.com/marketing/why-walmart-connect-is-hiring/", title: "Why Walmart Connect is hiring" },
      { url: "https://www.theverge.com/2026/11/12/24123456/instacart-carrot-ads-retail-media-network", title: "Instacart carrot ads retail media network" },
      { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Watch: our interview with the head of Kroger Precision Marketing" },
      { url: "https://www.linkedin.com/pulse/retail-media-measurement-gap-jane-doe", title: "The measurement gap, by Jane Doe" },
    ]);
    expect(found).toBe(6);
  });

  it("keeps opaque click-tracking links but drops archive, list-manage footer, private and blocked hosts", () => {
    expect(extractArticleLinks({ html: MAILCHIMP_HTML }).links).toEqual([
      { url: "https://acmeco.us5.list-manage.com/track/click?u=abc123&id=111&e=9f8e7d", title: "Five lessons from our Q3 launch" },
      // Image-only anchors use the image's alt text.
      { url: "https://acmeco.us5.list-manage.com/track/click?u=abc123&id=222&e=9f8e7d", title: "Hero image" },
    ]);
  });

  it("deduplicates after normalization and caps the result at ten while counting every link found", () => {
    const stories = Array.from({ length: 14 }, (_, i) => `<p><a href="https://www.ft.com/content/story-number-${i}-about-retail?utm_campaign=x">Story ${i}</a>
      <a href="https://www.ft.com/content/story-number-${i}-about-retail#top">Read more</a></p>`).join("");
    const { links, found } = extractArticleLinks({ html: `<html><body>${stories}</body></html>` });
    expect(found).toBe(14);
    expect(links).toHaveLength(MAX_ARTICLE_LINKS);
    expect(links[0]).toEqual({ url: "https://www.ft.com/content/story-number-0-about-retail", title: "Story 0" });
    expect(new Set(links.map(link => link.url)).size).toBe(MAX_ARTICLE_LINKS);
  });

  it("prefers a later descriptive anchor over an earlier image or generic one for the same URL", () => {
    const html = `<a href="https://www.wsj.com/business/retail/target-roundel-growth-3a1b"><img src="x.png" alt=""></a>
      <a href="https://www.wsj.com/business/retail/target-roundel-growth-3a1b">Target's Roundel keeps growing</a>`;
    expect(extractArticleLinks({ html }).links).toEqual([{ url: "https://www.wsj.com/business/retail/target-roundel-growth-3a1b", title: "Target's Roundel keeps growing" }]);
  });

  it("reads plain-text newsletters when there is no HTML, titling links from their line or the line above", () => {
    expect(extractArticleLinks({ text: MORNING_NOTES_TEXT, senderDomains: ["morningnotes.co"] }).links).toEqual([
      { url: "https://www.retaildive.com/news/shopify-retail-media-network/700001/", title: "Shopify launches a retail media network" },
      { url: "https://www.adexchanger.com/data-driven-thinking/the-case-for-clean-rooms/", title: "The case for clean rooms" },
      { url: "https://www.marketingweek.com/brand-building-in-a-recession-what-the-data-says/", title: "Brand building in a recession what the data says" },
    ]);
  });

  it("skips the original sender's own section pages in a hand-forwarded newsletter but keeps its stories", () => {
    const email = parsePostmarkInbound(postmark({ From: "reader@gmail.com", FromName: "Reader", FromFull: { Email: "reader@gmail.com", Name: "Reader" }, HtmlBody: GMAIL_FORWARD_HTML, TextBody: "" }))!;
    const sender = newsletterSender(email, GMAIL_FORWARD_TEXT);
    expect(extractArticleLinks({ html: email.html, senderDomains: sender.domains }).links)
      .toEqual([{ url: "https://www.morningbrew.com/daily/stories/2026/11/16/ad-money-moves", title: "Ad money moves to retail media" }]);
  });

  it("returns nothing for an empty message", () => {
    expect(extractArticleLinks({ html: "", text: "" })).toEqual({ links: [], found: 0 });
  });
});

describe("link helpers", () => {
  it.each([
    ["https://www.google.com/url?q=https://news.site.com/a-story&sa=D", "https://news.site.com/a-story"],
    ["https://l.facebook.com/l.php?u=https%3A%2F%2Fnews.site.com%2Fb-story&h=AT0", "https://news.site.com/b-story"],
    ["https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fnews.site.com%2Fc&data=1", "https://news.site.com/c"],
    ["https://click.mailer.site.com/redirect?target=https%3A%2F%2Fnews.site.com%2Fd", "https://news.site.com/d"],
  ])("unwraps %s", (wrapped, target) => {
    expect(unwrapRedirect(new URL(wrapped))?.href).toBe(target);
  });

  it.each([
    "https://news.site.com/articles/embed-tool?url=https://other.site.com/x",
    "https://www.google.com/url?q=javascript:alert(1)",
    "https://click.mailer.site.com/redirect?target=not-a-url",
  ])("does not unwrap %s", url => {
    expect(unwrapRedirect(new URL(url))).toBeNull();
  });

  it.each(["http://localhost/a", "http://127.0.0.1/a", "http://[::1]/a", "https://wiki.corp.internal/a", "https://printer.local/a",
    "https://user:pass@news.site.com/a", "ftp://news.site.com/a", "https://intranet/a", "https://www.example.com/a"])("rejects %s as non-public", url => {
    expect(isPublicLookingUrl(new URL(url))).toBe(false);
  });

  it("derives a readable title from an article slug, else the host", () => {
    expect(titleFromUrl("https://www.cnbc.com/2026/11/16/why-retail-media-grew-faster-than-search.html")).toBe("Why retail media grew faster than search");
    expect(titleFromUrl("https://www.bbc.co.uk/news/12345678")).toBe("bbc.co.uk");
  });

  it("uses the line's own words before a URL in text, not an earlier URL on the same line", () => {
    expect(anchorsFromText("Story A https://a.site.com/x | Story B https://b.site.com/y").map(candidate => candidate.text)).toEqual(["Story A", "Story B"]);
  });
});

describe("Postmark inbound adapter", () => {
  it("normalizes recipients, sender, subject and prefers the Message-ID header", () => {
    expect(parsePostmarkInbound(postmark())).toMatchObject({
      recipients: ["k3v9q2m8x7c4b1n6z5l0p2r8tw@in.thesocialpundit.com", "reader@gmail.com"],
      from: { address: "crew@morningbrew.com", name: "Morning Brew" },
      subject: "Ad money moves", messageId: "CAF=issue42@mail.morningbrew.com", html: "<p>Hello</p>", text: "Hello",
    });
  });

  it("falls back to the provider ID, then a content hash, for the Message-ID", () => {
    expect(parsePostmarkInbound(postmark({ Headers: [] }))!.messageId).toBe("0b1e2a7c-postmark-id");
    const hashed = parsePostmarkInbound(postmark({ Headers: [], MessageID: "" }))!.messageId;
    expect(hashed).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parsePostmarkInbound(postmark({ Headers: [], MessageID: "" }))!.messageId).toBe(hashed);
  });

  it.each([["a string", "hello"], ["null", null], ["no recipients", postmark({ To: "", ToFull: [], OriginalRecipient: "" })], ["a non-string subject", postmark({ Subject: 42 })]])(
    "rejects %s", (_label, body) => { expect(parsePostmarkInbound(body)).toBeNull(); });

  it("labels hand-forwarded newsletters with the original sender", () => {
    const email = parsePostmarkInbound(postmark({ From: "reader@gmail.com", FromName: "Reader", FromFull: { Email: "reader@gmail.com", Name: "Reader" }, TextBody: GMAIL_FORWARD_TEXT }))!;
    const sender = newsletterSender(email);
    expect(sender).toMatchObject({ address: "crew@morningbrew.com", name: "Morning Brew", label: "Morning Brew" });
    expect(sender.domains).toEqual(["morningbrew.com", "gmail.com"]);
    expect(newsletterSourceLabel(sender)).toBe("Newsletter: Morning Brew");
  });

  it("recognizes Gmail's forwarding confirmation and its code, only from Google", () => {
    const subject = "(#482913507) Gmail Forwarding Confirmation - Receive Mail from reader@gmail.com";
    expect(forwardingConfirmation({ from: { address: "forwarding-noreply@google.com", name: "Gmail Team" }, subject })).toEqual({ code: "482913507" });
    expect(forwardingConfirmation({ from: { address: "spoof@phish.site.com", name: null }, subject })).toBeNull();
  });
});

describe("forwarding addresses and webhook secrets", () => {
  it("generates 26 lowercase url-safe characters", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateAddressToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[a-z0-9]{26}$/);
  });

  it("finds the token in plain, plus-addressed and upper-cased recipients on the configured domain only", () => {
    const token = "k3v9q2m8x7c4b1n6z5l0p2r8tw";
    expect(recipientToken(`${token}@in.thesocialpundit.com`, "in.thesocialpundit.com")).toBe(token);
    expect(recipientToken(`${token.toUpperCase()}+news@IN.thesocialpundit.com`, "in.thesocialpundit.com")).toBe(token);
    expect(recipientToken(`${token}@other.com`, "in.thesocialpundit.com")).toBeNull();
    expect(recipientToken("short@in.thesocialpundit.com", "in.thesocialpundit.com")).toBeNull();
  });

  it("is configured only with a valid domain and a secret of at least 32 characters", () => {
    const secret = "s".repeat(32);
    expect(inboundEmailConfig({ INBOUND_EMAIL_DOMAIN: " In.TheSocialPundit.com ", INBOUND_EMAIL_SECRET: secret })).toEqual({ domain: "in.thesocialpundit.com", secret });
    expect(inboundEmailConfig({ INBOUND_EMAIL_DOMAIN: "in.thesocialpundit.com", INBOUND_EMAIL_SECRET: "short" })).toBeNull();
    expect(inboundEmailConfig({ INBOUND_EMAIL_SECRET: secret })).toBeNull();
    expect(inboundEmailDomain({ INBOUND_EMAIL_DOMAIN: "not a domain" })).toBeNull();
  });

  it("reads the secret from HTTP Basic or the X-Inbound-Secret header and compares it exactly", () => {
    const secret = "inbound-secret-for-tests-0123456789";
    const basic = `Basic ${Buffer.from(`postmark:${secret}`).toString("base64")}`;
    const request = (headers: Record<string, string>) => ({ get: (name: string) => headers[name.toLowerCase()] }) as never;
    expect(inboundSecretFrom(request({ authorization: basic }))).toBe(secret);
    expect(inboundSecretFrom(request({ "x-inbound-secret": secret }))).toBe(secret);
    expect(inboundSecretFrom(request({}))).toBeNull();
    expect(inboundSecretMatches(secret, secret)).toBe(true);
    expect(inboundSecretMatches(`${secret}x`, secret)).toBe(false);
    expect(inboundSecretMatches(null, secret)).toBe(false);
  });
});
