import { Helmet } from "react-helmet-async";

interface SEOProps {
  title?: string;
  description?: string;
  canonical?: string;
  type?: string;
  image?: string;
  robots?: string;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

const defaultTitle = "TheSocialPundit - Build Your Professional Authority on Social Media";
const defaultDescription = "TheSocialPundit helps professionals discover relevant industry signals, shape a useful point of view, and approve social posts written in their own voice.";
const siteUrl = "https://www.thesocialpundit.com";
const shareImage = `${siteUrl}/og-image.jpg`;

export function SEO({ 
  title, 
  description = defaultDescription,
  canonical,
  type = "website",
  image = shareImage,
  robots = "index, follow",
  jsonLd,
}: SEOProps) {
  const fullTitle = title ? `${title} | TheSocialPundit` : defaultTitle;
  const canonicalUrl = canonical ? `${siteUrl}${canonical}` : siteUrl;
  const structuredData = jsonLd ?? (canonical === "/" ? {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${siteUrl}/#organization`, name: "TheSocialPundit", url: `${siteUrl}/`, logo: `${siteUrl}/favicon.png` },
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
