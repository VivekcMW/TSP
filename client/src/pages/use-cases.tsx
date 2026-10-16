import { Link } from "wouter";
import { ArrowRight, Compass, Layers3, PenLine } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Button } from "@/components/ui/button";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { USE_CASES } from "@shared/use-cases";

const icons = [Compass, PenLine, Layers3] as const;

export default function UseCasesPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO
        title="Use Cases"
        canonical="/use-cases"
        description="Explore how TheSocialPundit supports thought leadership, professional content creation, and multi-platform publishing—with you in control."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "TheSocialPundit use cases",
          url: "https://www.thesocialpundit.com/use-cases",
          hasPart: USE_CASES.map(useCase => ({
            "@type": "WebPage",
            name: useCase.label,
            url: `https://www.thesocialpundit.com/use-cases/${useCase.slug}`,
          })),
        }}
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="border-b bg-card py-20 lg:py-28">
          <Reveal className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">Use cases</p>
            <h1 className="mt-5 heading-display text-balance">Start with the outcome, not a feature list.</h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Whether you need a sharper point of view, a credible first draft, or a better way to show up across channels, the same rule applies: your expertise and approval stay at the centre.
            </p>
          </Reveal>
        </section>

        <section className="py-20 lg:py-28" aria-labelledby="use-case-grid-title">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal className="mb-10 max-w-2xl">
              <h2 id="use-case-grid-title" className="heading-section">Choose where the work feels hardest today.</h2>
            </Reveal>
            <StaggerGroup className="grid gap-5 lg:grid-cols-3">
              {USE_CASES.map((useCase, index) => {
                const Icon = icons[index];
                return (
                  <StaggerItem key={useCase.slug} className="flex flex-col rounded-card border bg-card p-7 shadow-sm">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-6 font-heading text-2xl font-semibold">{useCase.label}</h3>
                    <p className="mt-3 flex-1 leading-7 text-muted-foreground">{useCase.introduction}</p>
                    <Link href={`/use-cases/${useCase.slug}`} className="mt-6 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
                      Explore {useCase.label.toLowerCase()}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </StaggerItem>
                );
              })}
            </StaggerGroup>
          </div>
        </section>

        <section className="border-y bg-foreground py-16 text-white">
          <Reveal className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-7 px-4 sm:px-6 lg:flex-row lg:items-center lg:px-8">
            <div>
              <h2 className="font-heading text-3xl font-semibold">Not sure which path fits?</h2>
              <p className="mt-2 max-w-2xl text-white/65">Start with your role and topics. Pundit builds the workflow around the work you actually do.</p>
            </div>
            <Button asChild size="lg" className="shrink-0 bg-white text-foreground hover:bg-white/90">
              <Link href="/sign-up">Start free</Link>
            </Button>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
