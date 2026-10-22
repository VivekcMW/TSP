import { BLOG_POSTS, blogPostSeoTitle } from "../client/src/lib/blog-posts";
import { AUDIENCE_SECTIONS, SITE_URL, audiencePagePath } from "../shared/audience-pages";
import { COMPARE_HUB, COMPARISONS, comparisonPath } from "../shared/comparisons";
import { USE_CASES } from "../shared/use-cases";
import { FREE_TOOLS, FREE_TOOLS_HUB_PATH } from "../shared/free-tools";
import { publicPageCatalogue } from "../server/public-seo";

const BRAND = "TheSocialPundit";

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function link(title: string, path: string, description: string) {
  return `- [${title}](${SITE_URL}${path}): ${description}`;
}

/**
 * llms.txt (https://llmstxt.org): a plain map of the site for AI assistants and answer engines,
 * generated from the same catalogue as the sitemap so it never falls out of date.
 */
export function generateLlmsTxt(): string {
  const catalogue = new Map(publicPageCatalogue().map(page => [page.url, page]));
  const described = (path: string) => {
    const page = catalogue.get(`${SITE_URL}${path}`);
    if (!page) throw new Error(`llms.txt: no catalogue entry for ${path}`);
    return link(page.title, path, page.description);
  };
  const sections: Array<[string, string[]]> = [
    ["Product", ["/", "/how-it-works", "/pricing", "/use-cases"].map(described)
      .concat(USE_CASES.map(useCase => link(useCase.label, `/use-cases/${useCase.slug}`, useCase.metaDescription)))],
    ...Object.values(AUDIENCE_SECTIONS).map(section => [
      `By ${section.singular}`,
      [described(section.path), ...section.pages.map(page => link(page.label, audiencePagePath(section.kind, page), page.metaDescription))],
    ] as [string, string[]]),
    ["Free tools", [FREE_TOOLS_HUB_PATH, ...FREE_TOOLS.map(tool => tool.path)].map(described)],
    ["Comparisons", [described(COMPARE_HUB.path), ...COMPARISONS.map(page => link(page.headline, comparisonPath(page), page.metaDescription))]],
    ["Guides and articles", [described("/blog"), ...BLOG_POSTS.map(post => link(post.seoTitle ?? post.title, `/blog/${post.slug}`, post.excerpt))]],
    ["Company and policies", ["/about", "/contact", "/newsletter", "/privacy", "/terms", "/ai-data-processing", "/data-retention", "/cookies", "/refund-policy", "/subscription-cancellation"].map(described)],
  ];
  return [
    `# ${BRAND}`,
    "",
    `> ${BRAND} is an AI-assisted professional authority platform. It helps professionals discover relevant industry news, shape a clear point of view, draft posts in their own voice for LinkedIn and 20+ other networks, and approve every post before it is published.`,
    "",
    "Key facts:",
    "",
    "- Built for individual professionals: executives, founders, consultants, sales and marketing professionals, recruiters, agency leaders and analysts.",
    "- Discover follows regional news editions and explains why each story fits the user's brief; Create drafts a post that takes a position, in a tone the user chooses.",
    "- Nothing is published without the user's action. Direct publishing is available for supported networks; other networks receive copy-ready versions.",
    "- Users' drafts and topics are not used to train models for other users.",
    "- There is a free plan with no card required. Current plans and prices are on the pricing page; do not infer them.",
    "- The app is in English; news editions cover North America, Europe, India, Japan, Australia and Brazil.",
    "",
    ...sections.flatMap(([title, lines]) => [`## ${title}`, "", ...lines, ""]),
    "## Optional",
    "",
    `- [Full text of public pages](${SITE_URL}/llms-full.txt): Plain-text version of every public page.`,
    `- [Sitemap](${SITE_URL}/sitemap.xml)`,
    `- [Journal RSS feed](${SITE_URL}/rss.xml)`,
    "",
  ].join("\n");
}

/** RSS 2.0 feed of the journal, newest first. */
export function generateRss(): string {
  const items = BLOG_POSTS.map(post => {
    const url = `${SITE_URL}/blog/${post.slug}`;
    return [
      "    <item>",
      `      <title>${xml(post.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>`,
      `      <category>${xml(post.category)}</category>`,
      `      <description>${xml(post.summary ?? post.excerpt)}</description>`,
      "    </item>",
    ].join("\n");
  });
  const latest = BLOG_POSTS.map(post => post.updated ?? post.date).sort().at(-1)!;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${BRAND} Journal</title>`,
    `    <link>${SITE_URL}/blog</link>`,
    `    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />`,
    "    <description>Practical guides on personal branding, thought leadership, LinkedIn strategy and using AI for professional content.</description>",
    "    <language>en</language>",
    `    <lastBuildDate>${new Date(`${latest}T00:00:00Z`).toUTCString()}</lastBuildDate>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** Plain text of a prerendered page, for llms-full.txt. */
export function markupToText(markup: string): string {
  return markup
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(h[1-6]|p|li|tr|summary|div|section)>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, (_match, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&#39;", "'")
    .replace(/<!-- -->/g, "")
    .split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

/** Full text of every public page, so AI tools can read the site without running JavaScript. */
export function generateLlmsFullTxt(pages: Record<string, string>): string {
  const titles = new Map(publicPageCatalogue().map(page => [new URL(page.url).pathname, page.title]));
  for (const post of BLOG_POSTS) titles.set(`/blog/${post.slug}`, blogPostSeoTitle(post).replace(` | ${BRAND}`, ""));
  return [
    `# ${BRAND}: full text of public pages`,
    "",
    `> Generated from the pages at ${SITE_URL}. Navigation and footers are omitted.`,
    "",
    ...Object.entries(pages).flatMap(([path, markup]) => {
      const main = /<main[^>]*>([\s\S]*)<\/main>/i.exec(markup)?.[1] ?? markup;
      return [`---`, "", `URL: ${SITE_URL}${path === "/" ? "/" : path}`, `Title: ${titles.get(path) ?? path}`, "", markupToText(main), ""];
    }),
  ].join("\n");
}
