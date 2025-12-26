import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/landing/hero";
import { Comparison } from "@/components/landing/comparison";
import { AIPov } from "@/components/landing/ai-pov";
import { UseCases } from "@/components/landing/use-cases";
import { SEO } from "@/components/seo";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO 
        canonical="/"
        description="TheSocialPundit helps professionals build authority on LinkedIn and Twitter/X by curating relevant industry content and turning news into opinionated social posts written in your voice."
      />
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <Comparison />
        <AIPov />
        <UseCases />
      </main>
      <SiteFooter />
    </div>
  );
}
