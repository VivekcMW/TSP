import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { AnnouncementBar } from "@/components/landing/announcement-bar";
import { Hero } from "@/components/landing/hero";
import { PlatformStrip } from "@/components/landing/platform-strip";
import { AuthorityLoop } from "@/components/landing/authority-loop";
import { ProductShowcase } from "@/components/landing/product-showcase";
import { Markets } from "@/components/landing/markets";
import { IndustriesShowcase } from "@/components/landing/industries-showcase";
import { UseCasesPreview } from "@/components/landing/use-cases-preview";
import { AudienceDirectory } from "@/components/landing/audience-directory";
import { Trust } from "@/components/landing/trust";
import { NewsletterBanner } from "@/components/landing/newsletter-banner";
import { FAQ } from "@/components/landing/faq";
import { FinalCTA } from "@/components/landing/final-cta";
import { StickyMobileCta } from "@/components/landing/sticky-mobile-cta";
import { SEO } from "@/components/seo";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO
        canonical="/"
        description="TheSocialPundit turns current news in your industry into LinkedIn and social posts written in your voice. You review and approve every post before it publishes."
      />
      <AnnouncementBar />
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <PlatformStrip />
        <AuthorityLoop />
        <ProductShowcase />
        <Markets />
        <UseCasesPreview />
        <AudienceDirectory />
        <IndustriesShowcase />
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
