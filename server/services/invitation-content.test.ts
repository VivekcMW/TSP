import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => { throw new Error("Database imports forbidden in invitation content tests"); });
vi.mock("dotenv", () => { throw new Error("Environment file loads forbidden in invitation content tests"); });
vi.mock("dotenv/config", () => { throw new Error("Environment file loads forbidden in invitation content tests"); });
import { invitationContent, invitationPreview } from "./invitation-content";

// Pure rendering, no provider/store/auth/config initialization and no sockets at all.
beforeEach(() => {
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Fetch forbidden"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const signupUrl = "https://app.test/sign-up";
// Independent reviewed copy baseline: changing both preview and delivery must not
// silently reintroduce unsupported pricing, scarcity or automatic-publishing claims.
const baseline = [
  "What if researching content and drafting posts in your voice took less of your evening?",
  "That's TheSocialPundit.",
  "How it works:\n1. Tell it what you care about. It gathers stories from your sources and interests into one feed\n2. It drafts posts using your selected tone and, when you opt in, your approved writing samples\n3. Review every draft, then publish or schedule to supported connected platforms, or copy content formatted for other networks\n4. Use the calendar to plan what goes out, where and when",
  "What it's worth to you:\n- Less time spent researching and drafting\n- Content formatted for 20+ platforms, with direct publishing where supported\n- Drafts shaped by your perspective, with you in control of every post\n- Research, drafting and scheduling in one place",
  "Start with the free plan. You can review current subscription options and prices before upgrading.",
];
function htmlText(html: string) {
  return html.replace(/<\/p><p>/g, "\n\n").replace(/<br>/g, "\n").replace(/<\/?p>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

describe("invitation content and preview", () => {
  it("uses the same reviewed paragraph baseline in preview, plain text and HTML", () => {
    const content = invitationContent("Database Person", signupUrl);
    expect(invitationPreview.subject).toBe("You're invited to try TheSocialPundit");
    expect(content.subject).toBe(invitationPreview.subject);
    expect(content.text).toBe(["Database Person invited you to try TheSocialPundit.", ...baseline].join("\n\n"));
    expect(htmlText(content.html)).toBe(content.text);
    expect(invitationPreview.body).toBe([
      "Hi {FirstName},", "{InviterName} invited you to try TheSocialPundit.", ...baseline,
      "Start free: {link}", "Founding Team, TheSocialPundit",
      "This is a one-time invitation, not a newsletter subscription. The email includes a link to stop future invitations.",
    ].join("\n\n"));
    expect(invitationPreview.body.replace("{InviterName}", "Database Person")).toContain(content.text);
  });

  it.each(["preview", "text", "html"])("keeps %s truthful about optional voice, review and supported publishing", format => {
    const content = invitationContent("Sender", signupUrl);
    const copy = format === "preview" ? invitationPreview.body : format === "html" ? htmlText(content.html) : content.text!;
    expect(copy).toContain("when you opt in, your approved writing samples");
    expect(copy).toContain("Review every draft, then publish or schedule to supported connected platforms");
    expect(copy).toContain("or copy content formatted for other networks");
    expect(copy).toContain("Content formatted for 20+ platforms, with direct publishing where supported");
    expect(copy).toContain("with you in control of every post");
    expect(copy).toContain("review current subscription options and prices before upgrading");
    expect(copy).not.toMatch(/\b(?:automatic(?:ally)?|autopilot|auto[- ]?(?:post|publish)(?:ing)?)\b/i);
    expect(copy).not.toMatch(/\b(?:trial|discount|exclusive offer|limited[- ]time|first (?:\d|hundred|thousand)|lifetime|free forever)\b|[$£€₹]\s*\d|\d+\s*%\s*off/i);
    expect(copy).not.toMatch(/(?:publish|post)(?:ing)? (?:to|on|across) (?:all )?20\+/i);
  });

  it("escapes all five HTML-sensitive characters without altering plain-text identity or headers", () => {
    const name = `<img src=x onerror="alert('x')"> & O'Reilly`;
    const content = invitationContent(name, signupUrl);
    expect(content.html).toContain("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; O&#39;Reilly invited you");
    expect(content.html).not.toContain(name);
    expect(content.html).not.toMatch(/<img|<script/i);
    expect(content.text).toContain(`${name} invited you`);
    expect(htmlText(content.html)).toBe(content.text);
    expect(content.subject).toBe(invitationPreview.subject);
    expect(content.eyebrow).toBe("A friend invited you");
    expect(content.preheader).toBe("Research, draft and plan your content in one place.");
  });

  it("keeps the explicit CTA and one-time invitation/opt-out disclosure without newsletter enrollment", () => {
    const content = invitationContent("Sender", signupUrl);
    expect(content.primaryCta).toEqual({ label: "Start free", url: signupUrl });
    expect(content.secondaryCta).toBeUndefined();
    expect(content.afterCta).toBe("<p>Founding Team, TheSocialPundit</p><p>This is a one-time invitation, not a newsletter subscription. Use the link below to stop future invitations.</p>");
    expect(invitationPreview.body).toContain("link to stop future invitations");
    expect(content.html).not.toContain("Hi "); // Greeting/footer belong to the shared delivery wrapper.
    expect(content.text).not.toContain("Hi ");
  });

  it("does not mutate the preview or reuse another invitation's name or link", () => {
    const original = { ...invitationPreview };
    const first = invitationContent("First Sender", signupUrl);
    const second = invitationContent("Second Sender", "https://app.test/sign-up?from=second");
    expect(invitationPreview).toEqual(original);
    expect(second.text).not.toContain("First Sender");
    expect(second.primaryCta?.url).toBe("https://app.test/sign-up?from=second");
    expect(first.text).not.toContain("Second Sender");
    expect(first.primaryCta?.url).toBe(signupUrl);
  });
});