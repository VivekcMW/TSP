import { LINKEDIN_POST_TOOL_PATH } from "./linkedin-post-tool";
import { LINKEDIN_HOOK_TOOL_PATH } from "./linkedin-hook-tool";
import { LINKEDIN_HASHTAG_TOOL_PATH } from "./linkedin-hashtag-tool";
import { LINKEDIN_FORMATTER_TOOL_PATH } from "./linkedin-formatter";

const SITE_URL = "https://www.thesocialpundit.com";

/** The hub listing every free tool. */
export const FREE_TOOLS_HUB_PATH = "/tools";

export interface FreeTool {
  path: string;
  name: string;
  summary: string;
}

/** Every free tool, in the order the hub and cross-links show them. */
export const FREE_TOOLS: readonly FreeTool[] = [
  { path: LINKEDIN_POST_TOOL_PATH, name: "LinkedIn post generator from news", summary: "Paste a news article and get a ready-to-edit LinkedIn post with a hook, your take and a question." },
  { path: LINKEDIN_HOOK_TOOL_PATH, name: "LinkedIn hook generator", summary: "Get five opening lines in different styles, so your post earns the \"see more\" click." },
  { path: LINKEDIN_HASHTAG_TOOL_PATH, name: "LinkedIn hashtag generator", summary: "Relevant hashtags for your post, split into broad tags for reach and niche tags to stand out." },
  { path: LINKEDIN_FORMATTER_TOOL_PATH, name: "LinkedIn post formatter & character counter", summary: "Bold and italic text, bullet lists, a 3,000-character counter and a \"see more\" preview." },
];

export const FREE_TOOLS_HUB_SEO = {
  title: "Free LinkedIn Tools: Posts, Hooks, Hashtags | TheSocialPundit",
  description: "Free LinkedIn writing tools with no sign-up: turn news into a post, generate hooks and hashtags, format text in bold and count characters.",
  lastmod: "2026-10-22",
} as const;

export function freeToolsHubJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Free LinkedIn tools",
    description: FREE_TOOLS_HUB_SEO.description,
    url: `${SITE_URL}${FREE_TOOLS_HUB_PATH}`,
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "TheSocialPundit", url: `${SITE_URL}/` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: FREE_TOOLS.map((tool, index) => ({ "@type": "ListItem", position: index + 1, name: tool.name, url: `${SITE_URL}${tool.path}` })),
    },
  };
}
