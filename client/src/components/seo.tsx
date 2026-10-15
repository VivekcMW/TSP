import { Helmet } from "react-helmet-async";

interface SEOProps {
  title?: string;
  /** The title already names the brand, so it is used as-is. */
  rawTitle?: boolean;
  description?: string;
  canonical?: string;
  type?: string;
  image?: string;
  robots?: string;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

const defaultTitle = "Professional Authority on Social Media | TheSocialPundit";
const defaultDescription = "TheSocialPundit helps professionals discover relevant industry signals, shape a useful point of view, and approve social posts written in their own voice.";
const siteUrl = "https://www.thesocialpundit.com";
const shareImage = `${siteUrl}/og-image.jpg`;

/** Must match the Organization in client/index.html, which crawlers read before JavaScript runs. */
const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${siteUrl}/#organization`,
  name: "TheSocialPundit",
  alternateName: "The Social Pundit",
  url: `${siteUrl}/`,
  logo: { "@type": "ImageObject", url: `${siteUrl}/favicon.png`, width: 1024, height: 1024 },
  description: "AI-assisted professional authority platform that turns relevant industry news into posts in the user's own voice, with human approval before publishing.",
  email: "hello@thesocialpundit.com",
  contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "hello@thesocialpundit.com", availableLanguage: "English" },
};

export function SEO({ 
  title, 
  rawTitle = false,
  description = defaultDescription,
  canonical,
  type = "website",
  image = shareImage,
  robots = "index, follow",
  jsonLd,
}: SEOProps) {
  const fullTitle = title ? (rawTitle ? title : `${title} | TheSocialPundit`) : defaultTitle;
  const canonicalUrl = canonical ? `${siteUrl}${canonical}` : siteUrl;
  const structuredData = jsonLd ?? (canonical === "/" ? {
    "@context": "https://schema.org",
    "@graph": [
      ORGANIZATION,
      { "@type": "WebSite", "@id": `${siteUrl}/#website`, name: "TheSocialPundit", url: `${siteUrl}/`, publisher: { "@id": `${siteUrl}/#organization` }, inLanguage: "en" },
      {
        "@type": "SoftwareApplication",
        name: "TheSocialPundit",
        url: `${siteUrl}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: defaultDescription,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": `${siteUrl}/#organization` },
      },
    ],
  } : canonical ? {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: fullTitle.replace(" | TheSocialPundit", ""),
    description,
    url: canonicalUrl,
    isPartOf: { "@type": "WebSite", "@id": `${siteUrl}/#website`, name: "TheSocialPundit", url: `${siteUrl}/` },
    inLanguage: "en",
  } : undefined);

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={robots} />
      <link rel="canonical" href={canonicalUrl} />
      
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={image} />
      <meta property="og:site_name" content="TheSocialPundit" />
      
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      {structuredData && <script type="application/ld+json">{JSON.stringify(structuredData)}</script>}
    </Helmet>
  );
}
