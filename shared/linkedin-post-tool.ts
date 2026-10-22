import { z } from "zod";

/** The free, no-login "news → LinkedIn post" tool at /tools/linkedin-post-generator. */
export const LINKEDIN_POST_TOOL_PATH = "/tools/linkedin-post-generator";
export const LINKEDIN_POST_TOOL_DAILY_LIMIT = 10;

export const LINKEDIN_POST_TOOL_TONES = [
  { value: "professional", label: "Professional", hint: "Clear, credible and measured." },
  { value: "insightful", label: "Insightful", hint: "Explains what the news means and why it matters." },
  { value: "conversational", label: "Conversational", hint: "Warm and plain-spoken, like talking to a colleague." },
  { value: "bold", label: "Bold", hint: "Takes a clear position and invites debate." },
] as const;

export type LinkedInPostToolTone = typeof LINKEDIN_POST_TOOL_TONES[number]["value"];

export const MIN_ARTICLE_TEXT = 200;
export const MAX_ARTICLE_TEXT = 12_000;

const tone = z.enum(LINKEDIN_POST_TOOL_TONES.map(item => item.value) as [LinkedInPostToolTone, ...LinkedInPostToolTone[]]);

const httpUrl = z.string().trim().max(2048).url().refine(value => /^https?:\/\//i.test(value), "Use an http or https link.");

/** Exactly one source: a public article link, or the article text itself. */
export const linkedInPostToolRequest = z.union([
  z.object({ url: httpUrl, tone }).strict(),
  z.object({ text: z.string().trim().min(MIN_ARTICLE_TEXT).max(MAX_ARTICLE_TEXT), tone }).strict(),
]);

export type LinkedInPostToolRequest = z.infer<typeof linkedInPostToolRequest>;

export interface LinkedInPostToolResponse {
  post: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
}

const SITE_URL = "https://www.thesocialpundit.com";

export const LINKEDIN_POST_TOOL_SEO = {
  title: "Free LinkedIn Post Generator From News | TheSocialPundit",
  description: "Paste a news article link or text and get a ready-to-edit LinkedIn post with a hook, your take and a question. Free, no sign-up, 10 posts a day.",
  lastmod: "2026-10-21",
} as const;

export const LINKEDIN_POST_TOOL_FAQS = [
  {
    question: "Is the LinkedIn post generator really free?",
    answer: `Yes. You can write up to ${LINKEDIN_POST_TOOL_DAILY_LIMIT} posts a day without an account or a card. A free TheSocialPundit account adds news discovery, your own writing voice, saved drafts and scheduling.`,
  },
  {
    question: "Which news articles can I use?",
    answer: "Any public article page. Some publishers block automated readers or put stories behind a paywall; if a link can't be read, paste the article text instead.",
  },
  {
    question: "Will the post make things up?",
    answer: "The generator is told to use only facts stated in the article and never to invent numbers, names or quotes. Always read the draft and check it against the source before you post.",
  },
  {
    question: "Do you store the article or the post?",
    answer: "No. The article and the generated post are not saved to any account or used to train models. They are sent to our AI provider only to write the draft.",
  },
  {
    question: "Does it post to LinkedIn for me?",
    answer: "No. You copy the draft, edit it and post it yourself. Nothing is published without you.",
  },
] as const;

/** Shared by the page and the server-rendered HTML so crawlers and the browser see the same schema. */
export function linkedInPostToolJsonLd(): Array<Record<string, unknown>> {
  const url = `${SITE_URL}${LINKEDIN_POST_TOOL_PATH}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Free LinkedIn Post Generator From News",
      url,
      description: LINKEDIN_POST_TOOL_SEO.description,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": `${SITE_URL}/#organization` },
      isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "TheSocialPundit", url: `${SITE_URL}/` },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: LINKEDIN_POST_TOOL_FAQS.map(faq => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
    },
  ];
}
