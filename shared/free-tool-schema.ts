const SITE_URL = "https://www.thesocialpundit.com";

export interface FreeToolFaq {
  readonly question: string;
  readonly answer: string;
}

/**
 * WebApplication + FAQPage schema for a free tool page. Shared by the page and the
 * server-rendered HTML so crawlers and the browser see the same schema.
 */
export function freeToolJsonLd(tool: { name: string; path: string; description: string; faqs: readonly FreeToolFaq[] }): Array<Record<string, unknown>> {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: tool.name,
      url: `${SITE_URL}${tool.path}`,
      description: tool.description,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": `${SITE_URL}/#organization` },
      isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "TheSocialPundit", url: `${SITE_URL}/` },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: tool.faqs.map(faq => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
    },
  ];
}
