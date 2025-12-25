import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/landing/hero";
import { Comparison } from "@/components/landing/comparison";
import { AIPov } from "@/components/landing/ai-pov";
import { UseCases } from "@/components/landing/use-cases";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
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
