/**
 * Short labels for the free tools, for eagerly loaded UI such as the homepage. Plain paths rather
 * than shared/free-tools, which pulls zod into the bundle; a test keeps the two in sync.
 */
export const FREE_TOOL_LINKS = [
  { href: "/tools/linkedin-post-generator", label: "Post generator from news" },
  { href: "/tools/linkedin-hook-generator", label: "Hook generator" },
  { href: "/tools/linkedin-hashtag-generator", label: "Hashtag generator" },
  { href: "/tools/linkedin-post-formatter", label: "Post formatter" },
] as const;
