import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { COMPARE_HUB, COMPARISONS, compareHubJsonLd, comparisonPath } from "@shared/comparisons";

/** /compare — index of every comparison page. */
export default function CompareHubPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title={COMPARE_HUB.seoTitle} canonical={COMPARE_HUB.path} description={COMPARE_HUB.metaDescription} jsonLd={compareHubJsonLd()} />
      <SiteHeader />
      <main className="flex-1">
        <section className="border-b bg-card py-20 lg:py-24">
          <Reveal className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">Compare</p>
            <h1 className="mt-5 heading-display text-balance">{COMPARE_HUB.headline}</h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{COMPARE_HUB.introduction}</p>
          </Reveal>
        </section>
        <section className="py-20 lg:py-24" aria-labelledby="compare-grid-title">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 id="compare-grid-title" className="heading-section mb-10">Choose a comparison</h2>
            <StaggerGroup className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {COMPARISONS.map(page => (
                <StaggerItem key={page.slug} className="flex flex-col rounded-card border bg-card p-6">
                  <h3 className="font-heading text-xl font-semibold">{page.headline}</h3>
                  <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{page.competitorSummary}</p>
                  <Link href={comparisonPath(page)} className="mt-5 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
                    Compare with {page.competitor}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
