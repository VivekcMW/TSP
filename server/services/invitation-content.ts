import { escapeHtml, type EmailContent } from "./email/templates";

// Shared by the preview and delivered message. Do not add pricing/trial or
// scarcity promises here until the billing catalog and checkout enforce them.
const paragraphs = [
  "What if researching content and drafting posts in your voice took less of your evening?",
  "That's TheSocialPundit.",
  "How it works:\n1. Tell it what you care about. It gathers stories from your sources and interests into one feed\n2. It drafts posts using your selected tone and, when you opt in, your approved writing samples\n3. Review every draft, then publish or schedule to supported connected platforms, or copy content formatted for other networks\n4. Use the calendar to plan what goes out, where and when",
  "What it's worth to you:\n- Less time spent researching and drafting\n- Content formatted for 20+ platforms, with direct publishing where supported\n- Drafts shaped by your perspective, with you in control of every post\n- Research, drafting and scheduling in one place",
  "Start with the free plan. You can review current subscription options and prices before upgrading.",
];

export const invitationPreview = {
  subject: "You're invited to try TheSocialPundit",
  body: ["Hi {FirstName},", "{InviterName} invited you to try TheSocialPundit.", ...paragraphs,
    "Start free: {link}", "Founding Team, TheSocialPundit",
    "This is a one-time invitation, not a newsletter subscription. The email includes a link to stop future invitations."].join("\n\n"),
};

export function invitationContent(inviterName: string, signupUrl: string): EmailContent {
  const content = [`${inviterName} invited you to try TheSocialPundit.`, ...paragraphs];
  return {
    subject: invitationPreview.subject,
    eyebrow: "A friend invited you",
    preheader: "Research, draft and plan your content in one place.",
    html: content.map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join(""),
    text: content.join("\n\n"),
    primaryCta: { label: "Start free", url: signupUrl },
    afterCta: "<p>Founding Team, TheSocialPundit</p><p>This is a one-time invitation, not a newsletter subscription. Use the link below to stop future invitations.</p>",
  };
}