import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { AnnouncementBar } from "@/components/landing/announcement-bar";
import { Hero } from "@/components/landing/hero";
import { IntentChips } from "@/components/landing/intent-chips";
import { PlatformStrip } from "@/components/landing/platform-strip";
import { ProductShowcase } from "@/components/landing/product-showcase";
import { Markets } from "@/components/landing/markets";
import { Facts } from "@/components/landing/facts";
import { IndustriesShowcase } from "@/components/landing/industries-showcase";
import { AIPov } from "@/components/landing/ai-pov";
import { Trust } from "@/components/landing/trust";
import { NewsletterBanner } from "@/components/landing/newsletter-banner";
import { FAQ } from "@/components/landing/faq";
import { FinalCTA } from "@/components/landing/final-cta";
import { StickyMobileCta } from "@/components/landing/sticky-mobile-cta";
import { NETWORK_COUNT, EDITION_COUNT } from "@/components/landing/landing-content";
import { SEO } from "@/components/seo";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO
        canonical="/"
        description={`TheSocialPundit reads today's news in your field and drafts posts in your voice for ${NETWORK_COUNT} networks, from LinkedIn and X to WeChat, Naver Blog and Xing, with news from ${EDITION_COUNT} regional editions. You approve every post.`}
      />
      <AnnouncementBar />
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <IntentChips />
        <PlatformStrip />
        <ProductShowcase />
        <Markets />
        <Facts />
        <IndustriesShowcase />
        <AIPov />
        <Trust />
        <NewsletterBanner />
        <FAQ />
        <FinalCTA />
      </main>
      <SiteFooter />
      <StickyMobileCta />
    </div>
  );
}
