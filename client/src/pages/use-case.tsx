import { Link, useParams } from "wouter";
import { ArrowRight, Check, ChevronRight, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Button } from "@/components/ui/button";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import NotFound from "@/pages/not-found";
import { getUseCase, USE_CASES } from "@shared/use-cases";

export default function UseCasePage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const useCase = getUseCase(slug);
  if (!useCase) return <NotFound />;

  const canonical = `https://www.thesocialpundit.com/use-cases/${useCase.slug}`;
  const related = USE_CASES.filter(candidate => candidate.slug !== useCase.slug);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO
        title={useCase.seoTitle.replace(" | TheSocialPundit", "")}
        canonical={`/use-cases/${useCase.slug}`}
        description={useCase.metaDescription}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: "https://www.thesocialpundit.com/" },
              { "@type": "ListItem", position: 2, name: "Use cases", item: "https://www.thesocialpundit.com/use-cases" },
              { "@type": "ListItem", position: 3, name: useCase.label, item: canonical },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: useCase.faqs.map(faq => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: { "@type": "Answer", text: faq.answer },
            })),
          },
        ]}
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b bg-card py-20 lg:py-28">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,hsl(var(--primary)/0.12),transparent_38%)]" aria-hidden="true" />
          <Reveal className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground">Home</Link>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <Link href="/use-cases" className="hover:text-foreground">Use cases</Link>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <span aria-current="page">{useCase.label}</span>
            </nav>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">{useCase.eyebrow}</p>
            <h1 className="mt-5 max-w-4xl heading-display text-balance">{useCase.headline}</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">{useCase.introduction}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link href="/sign-up">Start free<ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link></Button>
              <Button asChild size="lg" variant="outline"><Link href="/how-it-works">See how it works</Link></Button>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />Nothing publishes without your approval.
            </p>
          </Reveal>
        </section>

        <section className="py-20 lg:py-28" aria-labelledby="outcomes-title">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal className="mb-10 max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">What changes</p>
              <h2 id="outcomes-title" className="mt-4 heading-section">A better process creates better work.</h2>
            </Reveal>
            <StaggerGroup className="grid gap-5 md:grid-cols-3">
              {useCase.outcomes.map(outcome => (
                <StaggerItem key={outcome.title} className="rounded-card border bg-card p-7">
                  <Check className="h-5 w-5 text-success" aria-hidden="true" />
                  <h3 className="mt-5 text-xl font-semibold">{outcome.title}</h3>
                  <p className="mt-3 leading-7 text-muted-foreground">{outcome.description}</p>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>

        <section className="border-y bg-card py-20 lg:py-28" aria-labelledby="workflow-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <Reveal className="mb-12 max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">The workflow</p>
              <h2 id="workflow-title" className="mt-4 heading-section">From signal to approved post.</h2>
            </Reveal>
            <ol className="grid gap-px overflow-hidden rounded-card border bg-border md:grid-cols-4">
              {useCase.workflow.map((step, index) => (
                <li key={step.title} className="bg-background p-6">
                  <span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span>
                  <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="py-20 lg:py-28" aria-labelledby="faq-title">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
            <Reveal>
              <h2 id="faq-title" className="heading-section">Questions before you begin</h2>
              <p className="mt-4 text-muted-foreground">Clear answers about what the workflow does—and what remains yours.</p>
            </Reveal>
            <div className="divide-y border-y">
              {useCase.faqs.map(faq => (
                <details key={faq.question} className="group py-5">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                    {faq.question}<span className="text-primary transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="max-w-2xl pb-2 pr-8 leading-7 text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/40 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 className="font-heading text-2xl font-semibold">Explore another starting point</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {related.map(candidate => (
                <Link key={candidate.slug} href={`/use-cases/${candidate.slug}`} className="group rounded-card border bg-card p-5 hover:border-primary/40">
                  <span className="font-semibold">{candidate.label}</span>
                  <ArrowRight className="mt-4 h-4 w-4 text-primary transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
