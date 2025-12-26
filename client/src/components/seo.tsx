import { Helmet } from "react-helmet-async";

interface SEOProps {
  title?: string;
  description?: string;
  canonical?: string;
  type?: string;
}

const defaultTitle = "TheSocialPundit - Build Your Professional Authority on Social Media";
const defaultDescription = "TheSocialPundit helps professionals build authority on LinkedIn and Twitter/X by curating relevant industry content and turning news into opinionated social posts written in your voice.";
const siteUrl = "https://thesocialpundit.replit.app";

export function SEO({ 
  title, 
  description = defaultDescription,
  canonical,
  type = "website"
}: SEOProps) {
  const fullTitle = title ? `${title} | TheSocialPundit` : defaultTitle;
  const canonicalUrl = canonical ? `${siteUrl}${canonical}` : siteUrl;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={canonicalUrl} />
      
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
    </Helmet>
  );
}
