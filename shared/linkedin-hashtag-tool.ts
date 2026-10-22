import { z } from "zod";
import { freeToolJsonLd } from "./free-tool-schema";

/** The free, no-login LinkedIn hashtag generator at /tools/linkedin-hashtag-generator. */
export const LINKEDIN_HASHTAG_TOOL_PATH = "/tools/linkedin-hashtag-generator";
export const LINKEDIN_HASHTAG_TOOL_DAILY_LIMIT = 10;

export const MIN_HASHTAG_TEXT = 20;
export const MAX_HASHTAG_TEXT = 3_000;
export const MAX_BROAD_HASHTAGS = 5;
export const MAX_NICHE_HASHTAGS = 7;

export const linkedInHashtagToolRequest = z.object({
  text: z.string().trim().min(MIN_HASHTAG_TEXT).max(MAX_HASHTAG_TEXT),
}).strict();

export type LinkedInHashtagToolRequest = z.infer<typeof linkedInHashtagToolRequest>;

export interface LinkedInHashtagToolResponse {
  /** Widely followed tags that put the post in front of a large audience. */
  broad: string[];
  /** Specific tags where the post can stand out among fewer, more relevant posts. */
  niche: string[];
}

export const LINKEDIN_HASHTAG_TOOL_SEO = {
  title: "Free LinkedIn Hashtag Generator for Posts | TheSocialPundit",
  description: "Paste your LinkedIn post or topic and get relevant hashtags, split into broad tags for reach and niche tags where you can stand out. Free, no sign-up.",
  lastmod: "2026-10-22",
} as const;

export const LINKEDIN_HASHTAG_TOOL_FAQS = [
  {
    question: "How many hashtags should a LinkedIn post have?",
    answer: "Three to five is a good range. Pick one or two broad tags and two or three niche ones. Long blocks of hashtags look like spam and don't add reach.",
  },
  {
    question: "What is the difference between broad and niche hashtags?",
    answer: "Broad tags such as #Leadership are followed by millions, so your post competes with a huge volume of others. Niche tags are followed by fewer people, but they are the right people, and your post stays visible for longer.",
  },
  {
    question: "Is the hashtag generator free?",
    answer: `Yes. You can generate hashtags ${LINKEDIN_HASHTAG_TOOL_DAILY_LIMIT} times a day without an account.`,
  },
  {
    question: "Are these the most popular hashtags?",
    answer: "They are suggestions chosen for relevance to your text, not a live ranking. LinkedIn shows follower counts when you search a hashtag, so check any tag you are unsure about before you post.",
  },
  {
    question: "Do you store what I paste?",
    answer: "No. Your text and the suggestions are not saved or used to train models. They are sent to our AI provider only to suggest hashtags.",
  },
] as const;

export function linkedInHashtagToolJsonLd() {
  return freeToolJsonLd({ name: "Free LinkedIn Hashtag Generator", path: LINKEDIN_HASHTAG_TOOL_PATH, description: LINKEDIN_HASHTAG_TOOL_SEO.description, faqs: LINKEDIN_HASHTAG_TOOL_FAQS });
}
