import { USE_CASES } from "./use-cases";
import { ROLES } from "./audience-roles";
import { INDUSTRIES } from "./audience-industries";
import { AUDIENCE_INDEX, type AudienceKind } from "./audience-index";

export type { AudienceKind };

export const SITE_URL = "https://www.thesocialpundit.com";
/** Last content change of the role and industry pages; update with any copy change. */
export const AUDIENCE_PAGES_UPDATED = "2026-10-15";
const BRAND = "TheSocialPundit";

/** A landing page for one role or industry. Each targets a distinct keyword cluster. */
export interface AudiencePage {
  slug: string;
  /** Short name used in links, breadcrumbs and the sitemap page. */
  label: string;
  /** Kept under about 60 characters so search results show it in full. */
  seoTitle: string;
  metaDescription: string;
  eyebrow: string;
  headline: string;
  introduction: string;
  challengeTitle: string;
  challenge: readonly string[];
  outcomes: ReadonlyArray<{ title: string; description: string }>;
  postIdeas: readonly string[];
  faqs: ReadonlyArray<{ question: string; answer: string }>;
  /** Paths of related role, industry or use-case pages. */
  related: readonly string[];
}

export interface AudienceSection {
  kind: AudienceKind;
  path: string;
  label: string;
  singular: string;
  plural: string;
  seoTitle: string;
  metaDescription: string;
  eyebrow: string;
  headline: string;
  introduction: string;
  pages: readonly AudiencePage[];
}

export const AUDIENCE_SECTIONS: Record<AudienceKind, AudienceSection> = {
  roles: {
    ...AUDIENCE_INDEX.roles,
    seoTitle: `Personal Branding by Role | ${BRAND}`,
    metaDescription: "Personal branding and LinkedIn thought leadership for executives, founders, consultants, sales, marketing, recruiters, agency leaders and analysts.",
    eyebrow: "Who it's for",
    headline: "Personal branding built around the work you do.",
    introduction: "Every role earns trust differently. Choose yours to see how TheSocialPundit helps you find relevant news, shape a point of view and publish in your own voice, with every post approved by you.",
    pages: ROLES,
  },
  industries: {
    ...AUDIENCE_INDEX.industries,
    seoTitle: `Thought Leadership by Industry | ${BRAND}`,
    metaDescription: "Industry thought leadership for advertising, technology, finance, healthcare, retail, consulting, legal, real estate, education, manufacturing and HR.",
    eyebrow: "Industries",
    headline: "Thought leadership for the industry you know best.",
    introduction: "Pundit builds your news brief from a sentence about what you do, so it works in any field. These are the industries professionals most often use it for, and what changes when you post with a clear point of view.",
    pages: INDUSTRIES,
  },
};

/** The same four steps on every audience page: what the product does, in order. */
export const AUDIENCE_WORKFLOW = [
  { title: "Describe what you do", description: "Tell Pundit your role, market and audience in a sentence. It builds your news brief in about a minute." },
  { title: "Review relevant stories", description: "Discover brings you current stories, each with a short reason it fits your brief." },
  { title: "Shape your point of view", description: "Pick an angle and a tone. Create drafts a post that takes a position, ready for you to edit." },
  { title: "Approve and publish", description: "Publish or schedule to connected networks, or copy a version for the rest. Nothing goes out without you." },
] as const;

export function getAudiencePage(kind: AudienceKind, slug: string): AudiencePage | undefined {
  return AUDIENCE_SECTIONS[kind].pages.find(page => page.slug === slug);
}

export function audiencePagePath(kind: AudienceKind, page: AudiencePage) {
  return `${AUDIENCE_SECTIONS[kind].path}/${page.slug}`;
}

/** Every role and industry page with its path, for the sitemap and page metadata. */
export function allAudiencePages(): Array<{ kind: AudienceKind; path: string; page: AudiencePage }> {
  return (Object.keys(AUDIENCE_SECTIONS) as AudienceKind[]).flatMap(kind =>
    AUDIENCE_SECTIONS[kind].pages.map(page => ({ kind, path: audiencePagePath(kind, page), page })));
}

/** Link label for a related path; undefined when the path is not a known page. */
export function relatedPageLabel(path: string): string | undefined {
  const audience = allAudiencePages().find(candidate => candidate.path === path);
  if (audience) return audience.page.label;
  const useCase = USE_CASES.find(candidate => `/use-cases/${candidate.slug}` === path);
  return useCase?.label;
}

/** Structured data for an audience page. Shared so the server and the browser agree. */
export function audiencePageJsonLd(kind: AudienceKind, page: AudiencePage) {
  const section = AUDIENCE_SECTIONS[kind];
  const url = `${SITE_URL}${audiencePagePath(kind, page)}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.seoTitle.replace(` | ${BRAND}`, ""),
      description: page.metaDescription,
      url,
      isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: BRAND, url: `${SITE_URL}/` },
      inLanguage: "en",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: section.label, item: `${SITE_URL}${section.path}` },
        { "@type": "ListItem", position: 3, name: page.label, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: page.faqs.map(faq => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ];
}

export function audienceHubJsonLd(kind: AudienceKind) {
  const section = AUDIENCE_SECTIONS[kind];
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: section.seoTitle.replace(` | ${BRAND}`, ""),
    description: section.metaDescription,
    url: `${SITE_URL}${section.path}`,
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: BRAND, url: `${SITE_URL}/` },
    hasPart: section.pages.map(page => ({
      "@type": "WebPage",
      name: page.label,
      url: `${SITE_URL}${audiencePagePath(kind, page)}`,
    })),
  };
}
