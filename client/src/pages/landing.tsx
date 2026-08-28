import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/landing/hero";
import { PlatformStrip } from "@/components/landing/platform-strip";
import { Comparison } from "@/components/landing/comparison";
import { HowItWorksPreview } from "@/components/landing/how-it-works-preview";
import { AIPov } from "@/components/landing/ai-pov";
import { UseCases } from "@/components/landing/use-cases";
import { FAQ } from "@/components/landing/faq";
import { FinalCTA } from "@/components/landing/final-cta";
import { SEO } from "@/components/seo";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO 
        canonical="/"
        description="TheSocialPundit helps professionals build authority across 23 platforms — LinkedIn, Twitter/X, Threads, Bluesky, Reddit, Mastodon, Weibo, WeChat, Quora, Facebook, Telegram, and more — by curating relevant industry content and turning news into opinionated posts written in your voice."
      />
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <PlatformStrip />
        <Comparison />
        <HowItWorksPreview />
        <AIPov />
        <UseCases />
        <FAQ />
        <FinalCTA />
      </main>
      <SiteFooter />
    </div>
  );
}
