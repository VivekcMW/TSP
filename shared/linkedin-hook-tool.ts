import { z } from "zod";
import { freeToolJsonLd } from "./free-tool-schema";

/** The free, no-login LinkedIn hook generator at /tools/linkedin-hook-generator. */
export const LINKEDIN_HOOK_TOOL_PATH = "/tools/linkedin-hook-generator";
export const LINKEDIN_HOOK_TOOL_DAILY_LIMIT = 10;

/** One hook per style, so visitors get genuinely different openings to choose from. */
export const LINKEDIN_HOOK_STYLES = ["Question", "Bold claim", "Number", "Story", "Contrarian"] as const;
export type LinkedInHookStyle = typeof LINKEDIN_HOOK_STYLES[number];

export const MIN_HOOK_TOPIC = 20;
export const MAX_HOOK_TOPIC = 3_000;

export const linkedInHookToolRequest = z.object({
  topic: z.string().trim().min(MIN_HOOK_TOPIC).max(MAX_HOOK_TOPIC),
}).strict();

export type LinkedInHookToolRequest = z.infer<typeof linkedInHookToolRequest>;

export interface LinkedInHook {
  style: LinkedInHookStyle;
  text: string;
}

export interface LinkedInHookToolResponse {
  hooks: LinkedInHook[];
}

export const LINKEDIN_HOOK_TOOL_SEO = {
  title: "Free LinkedIn Hook Generator: 5 Opening Lines | TheSocialPundit",
  description: "Describe your post or paste a draft and get five LinkedIn opening lines in different styles: question, bold claim, number, story and contrarian. Free, no sign-up.",
  lastmod: "2026-10-22",
} as const;

export const LINKEDIN_HOOK_TOOL_FAQS = [
  {
    question: "What is a LinkedIn hook?",
    answer: "The hook is the first line or two of your post: the only part people see before \"…see more\". If it doesn't earn the click, the rest of the post isn't read, however good it is.",
  },
  {
    question: "Is the hook generator free?",
    answer: `Yes. You can generate hooks ${LINKEDIN_HOOK_TOOL_DAILY_LIMIT} times a day without an account. Each run gives you five hooks in different styles.`,
  },
  {
    question: "What should I paste in?",
    answer: "Either a sentence or two about what your post is about, or your whole draft. The more specific you are about the point you want to make, the sharper the hooks.",
  },
  {
    question: "Will the hooks make claims I can't back up?",
    answer: "The generator is told not to invent numbers or facts that aren't in your text. A \"Number\" hook only uses figures you supplied. Always check a hook says what your post actually says.",
  },
  {
    question: "Do you store what I paste?",
    answer: "No. Your text and the hooks are not saved or used to train models. They are sent to our AI provider only to write the hooks.",
  },
] as const;

export function linkedInHookToolJsonLd() {
  return freeToolJsonLd({ name: "Free LinkedIn Hook Generator", path: LINKEDIN_HOOK_TOOL_PATH, description: LINKEDIN_HOOK_TOOL_SEO.description, faqs: LINKEDIN_HOOK_TOOL_FAQS });
}
