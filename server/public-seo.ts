import { BLOG_POSTS } from "../client/src/lib/blog-posts";
import { USE_CASES } from "../shared/use-cases";

const SITE_URL = "https://www.thesocialpundit.com";
const DEFAULT_IMAGE = `${SITE_URL}/og-image.jpg`;
const BRAND = "TheSocialPundit";

export interface PublicSeoMetadata {
  title: string;
  description: string;
  canonical: string;
  type: "website" | "article";
  image: string;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

interface PublicPage {
  title: string;
  description: string;
  /** Sitemap hints. A page listed here is public, indexable, and belongs in sitemap.xml. */
  changefreq: "weekly" | "monthly" | "yearly";
  priority: string;
  schema?: Record<string, unknown>;
}

const pages: Record<string, PublicPage> = {
  "/": {
    title: "TheSocialPundit - Build Your Professional Authority on Social Media",
    description: "Turn relevant industry signals into professional posts in your voice. TheSocialPundit helps you discover, create, review, schedule, and publish with confidence.",
    changefreq: "weekly",
    priority: "1.0",
  },
  "/how-it-works": {
    title: "How TheSocialPundit Works | TheSocialPundit",
    description: "See how TheSocialPundit finds relevant industry signals, helps shape your point of view, drafts in your voice, and keeps you in control before publishing.",
    changefreq: "monthly",
    priority: "0.9",
  },
  "/use-cases": {
    title: "Use Cases | TheSocialPundit",
    description: "Explore how TheSocialPundit supports thought leadership, professional content creation, and multi-platform publishing—with you in control.",
    changefreq: "monthly",
    priority: "0.9",
  },
  "/pricing": {
    title: "Pricing | TheSocialPundit",
    description: "Start building professional authority for free, then upgrade when you need the complete creation, scheduling, publishing, and performance workflow.",
    changefreq: "monthly",
    priority: "0.9",
  },
  "/blog": {
    title: "TheSocialPundit Journal | TheSocialPundit",
    description: "Clear thinking on professional authority, content strategy, AI-assisted writing, and showing up with a point of view people remember.",
    changefreq: "weekly",
    priority: "0.9",
  },
  "/about": {
    title: "About | TheSocialPundit",
    description: "Why we built TheSocialPundit and what we believe about useful AI, professional judgment, personal voice, and human-approved publishing.",
    changefreq: "monthly",
    priority: "0.7",
  },
  "/contact": {
    title: "Contact | TheSocialPundit",
    description: "Contact TheSocialPundit for product, privacy, billing, partnership, or support questions.",
    changefreq: "yearly",
    priority: "0.5",
  },
  "/newsletter": {
    title: "Newsletter | TheSocialPundit",
    description: "Join TheSocialPundit for practical ideas on professional authority, useful AI, editorial voice, and sustainable content strategy.",
    changefreq: "monthly",
    priority: "0.6",
  },
  "/privacy": { title: "Privacy Policy | TheSocialPundit", description: "How TheSocialPundit collects, uses, protects, and deletes personal information.", changefreq: "yearly", priority: "0.3" },
  "/terms": { title: "Terms of Service | TheSocialPundit", description: "The terms that govern use of TheSocialPundit.", changefreq: "yearly", priority: "0.3" },
  "/refund-policy": { title: "Refund Policy | TheSocialPundit", description: "TheSocialPundit refund eligibility, process, and contact information.", changefreq: "yearly", priority: "0.3" },
  "/subscription-cancellation": { title: "Subscription Cancellation | TheSocialPundit", description: "How to cancel a TheSocialPundit subscription and understand when access ends.", changefreq: "yearly", priority: "0.3" },
  "/data-retention": { title: "Data Retention Policy | TheSocialPundit", description: "How long TheSocialPundit retains account, content, quality, billing, and audit records.", changefreq: "yearly", priority: "0.3" },
  "/ai-data-processing": { title: "AI Data Processing | TheSocialPundit", description: "How TheSocialPundit uses AI providers, approved voice samples, content-free quality signals, and human review.", changefreq: "yearly", priority: "0.4" },
  "/cookies": { title: "Cookie Policy | TheSocialPundit", description: "How TheSocialPundit uses essential, preference, and analytics cookies.", changefreq: "yearly", priority: "0.3" },
  "/sitemap": { title: "Sitemap | TheSocialPundit", description: "Browse every public product, company, policy, use-case, and journal page on TheSocialPundit.", changefreq: "monthly", priority: "0.3" },
  ...Object.fromEntries(USE_CASES.map(useCase => [
    `/use-cases/${useCase.slug}`,
    {
      title: useCase.seoTitle,
      description: useCase.metaDescription,
      changefreq: "monthly" as const,
      priority: "0.8",
      schema: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: useCase.faqs.map(faq => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    },
  ])),
};

function normalizePath(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

function webpageSchema(metadata: PublicSeoMetadata) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: metadata.title.replace(` | ${BRAND}`, ""),
    description: metadata.description,
    url: metadata.canonical,
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: BRAND, url: `${SITE_URL}/` },
    inLanguage: "en",
  };
}

export function publicSeoForPath(pathname: string): PublicSeoMetadata | undefined {
  const path = normalizePath(pathname);
  const page = pages[path];
  if (page) {
    const metadata: PublicSeoMetadata = {
      title: page.title,
      description: page.description,
      canonical: `${SITE_URL}${path === "/" ? "/" : path}`,
      type: "website",
      image: DEFAULT_IMAGE,
    };
    if (path !== "/") metadata.jsonLd = page.schema
      ? [webpageSchema(metadata), page.schema]
      : webpageSchema(metadata);
    return metadata;
  }

  const match = /^\/blog\/([^/]+)$/.exec(path);
  const post = match ? BLOG_POSTS.find(candidate => candidate.slug === match[1]) : undefined;
  if (!post) return undefined;
  const canonical = `${SITE_URL}/blog/${post.slug}`;
  const metadata: PublicSeoMetadata = {
    title: `${post.title} | ${BRAND}`,
    description: post.excerpt,
    canonical,
    type: "article",
    image: DEFAULT_IMAGE,
  };
  metadata.jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      description: post.excerpt,
      datePublished: post.date,
      dateModified: post.date,
      mainEntityOfPage: canonical,
      author: { "@type": "Organization", name: post.author, url: `${SITE_URL}/about` },
      publisher: {
        "@type": "Organization",
        name: BRAND,
        url: SITE_URL,
        logo: { "@type": "ImageObject", url: `${SITE_URL}/favicon.png` },
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Journal", item: `${SITE_URL}/blog` },
        { "@type": "ListItem", position: 3, name: post.title, item: canonical },
      ],
    },
  ];
  return metadata;
}

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq: string;
  priority: string;
}

/**
 * Every public URL, derived from the same catalog that produces the page metadata, so a page
 * can never be listed in the sitemap without metadata (or indexed without being listed).
 * `lastmod` is only emitted where a real date exists — Google ignores the hint when it is
 * generated from the build clock, so static pages deliberately omit it.
 */
export function sitemapEntries(): SitemapEntry[] {
  return [
    ...Object.entries(pages).map(([path, page]) => ({
      loc: `${SITE_URL}${path === "/" ? "/" : path}`,
      changefreq: page.changefreq,
      priority: page.priority,
    })),
    ...BLOG_POSTS.map(post => ({
      loc: `${SITE_URL}/blog/${post.slug}`,
      lastmod: post.date,
      changefreq: "yearly",
      priority: "0.7",
    })),
  ];
}

export function generateSitemap(): string {
  const urls = sitemapEntries().map(entry =>
    [
      "  <url>",
      `    <loc>${text(entry.loc)}</loc>`,
      ...(entry.lastmod ? [`    <lastmod>${text(entry.lastmod)}</lastmod>`] : []),
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      "  </url>",
    ].join("\n"),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

function attribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function text(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function replaceMeta(html: string, selector: "name" | "property", key: string, value: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta(?=[^>]*\\b${selector}="${escaped}")(?=[^>]*\\bcontent=")[^>]*>`, "i");
  return html.replace(pattern, `<meta ${selector}="${key}" content="${attribute(value)}" data-rh="true" />`);
}

export function renderInitialSeo(html: string, pathname: string): { html: string; indexable: boolean } {
  const metadata = publicSeoForPath(pathname);
  if (!metadata) return { html, indexable: false };
  let rendered = html.replace(/<title(?:\s[^>]*)?>[\s\S]*?<\/title>/i, `<title data-rh="true">${text(metadata.title)}</title>`);
  rendered = replaceMeta(rendered, "name", "description", metadata.description);
  rendered = rendered.replace(/<link(?=[^>]*\brel="canonical")(?=[^>]*\bhref=")[^>]*>/i, `<link rel="canonical" href="${attribute(metadata.canonical)}" data-rh="true" />`);
  rendered = replaceMeta(rendered, "property", "og:title", metadata.title);
  rendered = replaceMeta(rendered, "property", "og:description", metadata.description);
  rendered = replaceMeta(rendered, "property", "og:type", metadata.type);
  rendered = replaceMeta(rendered, "property", "og:url", metadata.canonical);
  rendered = replaceMeta(rendered, "property", "og:image", metadata.image);
  rendered = replaceMeta(rendered, "name", "twitter:title", metadata.title);
  rendered = replaceMeta(rendered, "name", "twitter:description", metadata.description);
  rendered = replaceMeta(rendered, "name", "twitter:image", metadata.image);
  if (metadata.jsonLd) {
    const json = JSON.stringify(metadata.jsonLd).replaceAll("<", "\\u003c");
    rendered = rendered.replace(/<script(?=[^>]*\btype="application\/ld\+json")[^>]*>[\s\S]*?<\/script>/i, `<script type="application/ld+json" data-rh="true">${json}</script>`);
  }
  return { html: rendered, indexable: true };
}
