import { freeToolJsonLd } from "./free-tool-schema";

/** The free, no-login LinkedIn post formatter at /tools/linkedin-post-formatter. Runs entirely in the browser. */
export const LINKEDIN_FORMATTER_TOOL_PATH = "/tools/linkedin-post-formatter";

/** LinkedIn's limit for a post. */
export const LINKEDIN_POST_MAX_CHARACTERS = 3_000;
/** Roughly where LinkedIn cuts a post with "…see more": about 210 characters or 3 lines, whichever comes first. */
export const LINKEDIN_PREVIEW_CHARACTERS = 210;
export const LINKEDIN_PREVIEW_LINES = 3;

export type UnicodeStyle = "bold" | "italic" | "boldItalic";

// LinkedIn has no rich text, so "bold" posts use the Mathematical Sans-Serif letters, which look
// like bold or italic text in any font. Sans-serif ranges have no reserved gaps, unlike the serif ones.
const STYLE_START: Record<UnicodeStyle, { upper: number; lower: number; digit?: number }> = {
  bold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  italic: { upper: 0x1d608, lower: 0x1d622 },
  boldItalic: { upper: 0x1d63c, lower: 0x1d656 },
};

const A = 0x41, Z = 0x5a, a = 0x61, z = 0x7a, ZERO = 0x30, NINE = 0x39;

const plainByStyled = new Map<number, number>();
for (const start of Object.values(STYLE_START)) {
  for (let i = 0; i < 26; i++) {
    plainByStyled.set(start.upper + i, A + i);
    plainByStyled.set(start.lower + i, a + i);
  }
  if (start.digit) for (let i = 0; i < 10; i++) plainByStyled.set(start.digit + i, ZERO + i);
}

/** Returns the plain letter or digit for a styled one, and anything else unchanged. */
function plainCodePoint(code: number): number {
  return plainByStyled.get(code) ?? code;
}

/** Re-styles text, replacing any existing bold/italic first so styles never stack. */
export function applyUnicodeStyle(text: string, style: UnicodeStyle): string {
  const start = STYLE_START[style];
  let output = "";
  for (const char of text) {
    const code = plainCodePoint(char.codePointAt(0)!);
    if (code >= A && code <= Z) output += String.fromCodePoint(start.upper + code - A);
    else if (code >= a && code <= z) output += String.fromCodePoint(start.lower + code - a);
    else if (start.digit !== undefined && code >= ZERO && code <= NINE) output += String.fromCodePoint(start.digit + code - ZERO);
    else output += String.fromCodePoint(code);
  }
  return output;
}

/** Turns styled letters and digits back into plain text, which screen readers and search can read. */
export function clearUnicodeStyles(text: string): string {
  let output = "";
  for (const char of text) output += String.fromCodePoint(plainCodePoint(char.codePointAt(0)!));
  return output;
}

export type ListStyle = "bullet" | "arrow" | "check" | "number";

const LIST_MARKER = /^\s*(?:[•→✅▪️-]|\d+[.)])\s+/u;

/** Turns each non-empty line into a list item, replacing any existing marker. */
export function formatAsList(text: string, style: ListStyle): string {
  let index = 0;
  return text.split("\n").map(line => {
    if (!line.trim()) return line;
    const content = line.replace(LIST_MARKER, "").trim();
    index++;
    const marker = style === "bullet" ? "•" : style === "arrow" ? "→" : style === "check" ? "✅" : `${index}.`;
    return `${marker} ${content}`;
  }).join("\n");
}

/** Collapses runs of blank lines and trims trailing spaces, so the post reads cleanly on a phone. */
export function tidySpacing(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

export interface PostStats {
  characters: number;
  remaining: number;
  words: number;
  hashtags: number;
  /** Minutes, rounded up, at 230 words a minute. */
  readingMinutes: number;
  /** What shows before "…see more". */
  preview: string;
  truncated: boolean;
}

/** Characters are counted as code points, so one emoji or styled letter counts once. */
export function postStats(text: string): PostStats {
  const characters = [...text].length;
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const hashtags = (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
  const lines = text.split("\n");
  let preview = lines.slice(0, LINKEDIN_PREVIEW_LINES).join("\n");
  let truncated = lines.length > LINKEDIN_PREVIEW_LINES;
  const previewChars = [...preview];
  if (previewChars.length > LINKEDIN_PREVIEW_CHARACTERS) {
    const cut = previewChars.slice(0, LINKEDIN_PREVIEW_CHARACTERS).join("");
    const lastSpace = cut.lastIndexOf(" ");
    preview = lastSpace > LINKEDIN_PREVIEW_CHARACTERS / 2 ? cut.slice(0, lastSpace) : cut;
    truncated = true;
  }
  return {
    characters,
    remaining: LINKEDIN_POST_MAX_CHARACTERS - characters,
    words,
    hashtags,
    readingMinutes: words ? Math.max(1, Math.ceil(words / 230)) : 0,
    preview: preview.trimEnd(),
    truncated: truncated && preview.trimEnd().length < text.trimEnd().length,
  };
}

export const LINKEDIN_FORMATTER_TOOL_SEO = {
  title: "Free LinkedIn Post Formatter & Character Counter | TheSocialPundit",
  description: "Format LinkedIn posts with bold and italic text, bullet lists and clean spacing, count characters against the 3,000 limit, and preview the \"see more\" cut. Free.",
  lastmod: "2026-10-22",
} as const;

export const LINKEDIN_FORMATTER_TOOL_FAQS = [
  {
    question: "How do you make text bold on LinkedIn?",
    answer: "LinkedIn posts don't support bold or italic. This formatter swaps your letters for Unicode characters that look bold or italic, so they keep their style when you paste them into LinkedIn.",
  },
  {
    question: "Should I use bold text in every post?",
    answer: "Use it sparingly, for one key line at most. Screen readers can read styled letters one by one or skip them, and LinkedIn search may not match them, so never style names, keywords or whole paragraphs.",
  },
  {
    question: "What is the LinkedIn post character limit?",
    answer: `A LinkedIn post can be up to ${LINKEDIN_POST_MAX_CHARACTERS.toLocaleString("en-US")} characters. Only the first ${LINKEDIN_PREVIEW_CHARACTERS} characters or so (or ${LINKEDIN_PREVIEW_LINES} lines) show before "…see more", so the opening has to earn the click.`,
  },
  {
    question: "Is my post sent anywhere?",
    answer: "No. The formatter runs entirely in your browser. Nothing you type is sent to our servers.",
  },
  {
    question: "Is the formatter free?",
    answer: "Yes, with no limits and no account.",
  },
] as const;

export function linkedInFormatterToolJsonLd() {
  return freeToolJsonLd({ name: "Free LinkedIn Post Formatter", path: LINKEDIN_FORMATTER_TOOL_PATH, description: LINKEDIN_FORMATTER_TOOL_SEO.description, faqs: LINKEDIN_FORMATTER_TOOL_FAQS });
}
