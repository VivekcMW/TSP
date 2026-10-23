/**
 * Names and URLs of the role and industry pages, without their copy. Pages that only link to
 * them (such as the homepage) import this instead of the full content. A test keeps it in step
 * with audience-roles.ts and audience-industries.ts.
 */
export type AudienceKind = "roles" | "industries";

export interface AudienceSectionIndex {
  kind: AudienceKind;
  path: string;
  label: string;
  /** Used inside sentences, e.g. "Browse by role" and "Explore other roles". */
  singular: string;
  plural: string;
  pages: ReadonlyArray<{ slug: string; label: string }>;
}

export const AUDIENCE_INDEX: Record<AudienceKind, AudienceSectionIndex> = {
  roles: {
    kind: "roles",
    path: "/roles",
    label: "Roles",
    singular: "role",
    plural: "roles",
    pages: [
      { slug: "executives", label: "Executives & CEOs" },
      { slug: "founders", label: "Founders & entrepreneurs" },
      { slug: "consultants", label: "Consultants & advisors" },
      { slug: "sales-professionals", label: "Sales professionals" },
      { slug: "marketing-professionals", label: "Marketing professionals" },
      { slug: "recruiters", label: "Recruiters & talent acquisition" },
      { slug: "agency-leaders", label: "Agency owners & leaders" },
      { slug: "analysts-investors", label: "Analysts & investment professionals" },
    ],
  },
  industries: {
    kind: "industries",
    path: "/industries",
    label: "Industries",
    singular: "industry",
    plural: "industries",
    pages: [
      { slug: "advertising-media", label: "Advertising, media & adtech" },
      { slug: "technology-saas", label: "Technology, AI & SaaS" },
      { slug: "financial-services", label: "Fintech & financial services" },
      { slug: "healthcare-life-sciences", label: "Healthcare & life sciences" },
      { slug: "retail-ecommerce", label: "Retail & e-commerce" },
      { slug: "marketing-technology", label: "Marketing technology" },
      { slug: "consulting-professional-services", label: "Consulting & professional services" },
      { slug: "legal-services", label: "Legal services" },
      { slug: "hospitality-travel", label: "Hospitality & travel" },
      { slug: "real-estate", label: "Real estate & property" },
      { slug: "education-edtech", label: "Education & edtech" },
      { slug: "manufacturing-supply-chain", label: "Manufacturing & supply chain" },
      { slug: "hr-future-of-work", label: "HR & the future of work" },
    ],
  },
};
