import { BLOG_POSTS, blogPostJsonLd, blogPostSeoTitle } from "../client/src/lib/blog-posts";
import { USE_CASES } from "../shared/use-cases";
import { AUDIENCE_PAGES_UPDATED, AUDIENCE_SECTIONS, allAudiencePages, audienceHubJsonLd, audiencePageJsonLd } from "../shared/audience-pages";

import { pricingFaqJsonLd } from "../shared/pricing-faqs";
import { COMPARE_HUB, COMPARISONS, COMPARISONS_CHECKED, compareHubJsonLd, comparisonJsonLd, comparisonPath } from "../shared/comparisons";

/** Last content change of the use-case pages (shared/use-cases.ts). */
const USE_CASES_UPDATED = "2026-10-11";

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
  /**
   * When the page's content last changed (YYYY-MM-DD). A page listed here is public, indexable,
   * and belongs in sitemap.xml. Update it whenever the page's content changes: search engines
   * only trust lastmod when it is accurate, so it is never taken from the build clock.
   */
  lastmod: string;
  schema?: Record<string, unknown>;
  /** Replaces the default WebPage schema entirely, for pages that share their schema with the browser. */
  jsonLd?: PublicSeoMetadata["jsonLd"];
}

const pages: Record<string, PublicPage> = {
  "/": {
    title: "Professional Authority on Social Media | TheSocialPundit",
    description: "Turn relevant industry signals into professional posts in your voice. TheSocialPundit helps you discover, create, review, schedule, and publish with confidence.",
    lastmod: "2026-10-15",
  },
  "/how-it-works": {
    title: "How TheSocialPundit Works | TheSocialPundit",
    description: "See how TheSocialPundit finds relevant industry signals, helps shape your point of view, drafts in your voice, and keeps you in control before publishing.",
    lastmod: "2026-10-11",
  },
  "/use-cases": {
    title: "Use Cases | TheSocialPundit",
    description: "Explore how TheSocialPundit supports thought leadership, professional content creation, and multi-platform publishing—with you in control.",
    lastmod: "2026-10-11",
  },
  "/pricing": {
    title: "Pricing | TheSocialPundit",
    description: "Start building professional authority for free, then upgrade when you need the complete creation, scheduling, publishing, and performance workflow.",
    lastmod: "2026-10-15",
    schema: pricingFaqJsonLd(),
  },
  "/blog": {
    title: "TheSocialPundit Journal | TheSocialPundit",
    description: "Clear thinking on professional authority, content strategy, AI-assisted writing, and showing up with a point of view people remember.",
    lastmod: "2026-10-15",
  },
  "/about": {
    title: "About | TheSocialPundit",
    description: "Why we built TheSocialPundit and what we believe about useful AI, professional judgment, personal voice, and human-approved publishing.",
    lastmod: "2026-10-10",
  },
  "/contact": {
    title: "Contact | TheSocialPundit",
    description: "Contact TheSocialPundit for product, privacy, billing, partnership, or support questions.",
    lastmod: "2026-08-28",
  },
  "/newsletter": {
    title: "Newsletter | TheSocialPundit",
    description: "Join TheSocialPundit for practical ideas on professional authority, useful AI, editorial voice, and sustainable content strategy.",
    lastmod: "2026-10-11",
  },
  "/privacy": { title: "Privacy Policy | TheSocialPundit", description: "How TheSocialPundit collects, uses, protects, and deletes personal information.", lastmod: "2026-10-15" },
  "/terms": { title: "Terms of Service | TheSocialPundit", description: "The terms that govern use of TheSocialPundit.", lastmod: "2026-09-16" },
  "/refund-policy": { title: "Refund Policy | TheSocialPundit", description: "TheSocialPundit refund eligibility, process, and contact information.", lastmod: "2026-09-16" },
  "/subscription-cancellation": { title: "Subscription Cancellation | TheSocialPundit", description: "How to cancel a TheSocialPundit subscription and understand when access ends.", lastmod: "2026-09-16" },
  "/data-retention": { title: "Data Retention Policy | TheSocialPundit", description: "How long TheSocialPundit retains account, content, quality, billing, and audit records.", lastmod: "2026-10-11" },
  "/ai-data-processing": { title: "AI Data Processing | TheSocialPundit", description: "How TheSocialPundit uses AI providers, approved voice samples, content-free quality signals, and human review.", lastmod: "2026-10-11" },
  "/cookies": { title: "Cookie Policy | TheSocialPundit", description: "How TheSocialPundit uses essential, preference, and analytics cookies.", lastmod: "2026-10-15" },
  "/sitemap": { title: "Sitemap | TheSocialPundit", description: "Browse every public product, role, industry, comparison, company, policy, use-case, and journal page on TheSocialPundit.", lastmod: "2026-10-15" },
  ...Object.fromEntries(USE_CASES.map(useCase => [
    `/use-cases/${useCase.slug}`,
    {
      title: useCase.seoTitle,
      description: useCase.metaDescription,
      lastmod: USE_CASES_UPDATED,
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
  ...Object.fromEntries(Object.values(AUDIENCE_SECTIONS).map(section => [
    section.path,
    {
      title: section.seoTitle,
      description: section.metaDescription,
      lastmod: AUDIENCE_PAGES_UPDATED,
      jsonLd: audienceHubJsonLd(section.kind),
    },
  ])),
  ...Object.fromEntries(allAudiencePages().map(({ kind, path, page }) => [
    path,
    {
      title: page.seoTitle,
      description: page.metaDescription,
      lastmod: AUDIENCE_PAGES_UPDATED,
      jsonLd: audiencePageJsonLd(kind, page),
    },
  ])),
  [COMPARE_HUB.path]: {
    title: `${COMPARE_HUB.seoTitle} | ${BRAND}`,
    description: COMPARE_HUB.metaDescription,
    lastmod: COMPARISONS_CHECKED,
    jsonLd: compareHubJsonLd(),
  },
  ...Object.fromEntries(COMPARISONS.map(page => [
    comparisonPath(page),
    { title: page.seoTitle, description: page.metaDescription, lastmod: COMPARISONS_CHECKED, jsonLd: comparisonJsonLd(page) },
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
    if (page.jsonLd) metadata.jsonLd = page.jsonLd;
    else if (path !== "/") metadata.jsonLd = page.schema
      ? [webpageSchema(metadata), page.schema]
      : webpageSchema(metadata);
    return metadata;
  }

  const match = /^\/blog\/([^/]+)$/.exec(path);
  const post = match ? BLOG_POSTS.find(candidate => candidate.slug === match[1]) : undefined;
  if (!post) return undefined;
  const canonical = `${SITE_URL}/blog/${post.slug}`;
  const metadata: PublicSeoMetadata = {
    title: blogPostSeoTitle(post),
    description: post.excerpt,
    canonical,
    type: "article",
    image: DEFAULT_IMAGE,
  };
  metadata.jsonLd = blogPostJsonLd(post);
  return metadata;
}

export interface SitemapEntry {
  loc: string;
  /** Real date of the page's last content change. changefreq and priority are omitted: Google ignores both. */
  lastmod: string;
}

/**
 * Every public URL, derived from the same catalog that produces the page metadata, so a page
 * can never be listed in the sitemap without metadata (or indexed without being listed).
 */
export function sitemapEntries(): SitemapEntry[] {
  return [
    ...Object.entries(pages).map(([path, page]) => ({
      loc: `${SITE_URL}${path === "/" ? "/" : path}`,
      lastmod: page.lastmod,
    })),
    ...BLOG_POSTS.map(post => ({
      loc: `${SITE_URL}/blog/${post.slug}`,
      lastmod: post.updated ?? post.date,
    })),
  ];
}

export function generateSitemap(): string {
  const urls = sitemapEntries().map(entry =>
    `  <url>\n    <loc>${text(entry.loc)}</loc>\n    <lastmod>${text(entry.lastmod)}</lastmod>\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** The public page catalogue, for search and AI discovery files (llms.txt). */
export function publicPageCatalogue(): Array<{ url: string; title: string; description: string }> {
  return Object.entries(pages).map(([path, page]) => ({
    url: `${SITE_URL}${path === "/" ? "/" : path}`,
    title: page.title.replace(` | ${BRAND}`, ""),
    description: page.description,
  }));
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
