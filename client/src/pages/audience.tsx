import { Link } from "wouter";
import { ArrowRight, Check, ChevronRight, Lightbulb, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Button } from "@/components/ui/button";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import NotFound from "@/pages/not-found";
import {
  AUDIENCE_SECTIONS, AUDIENCE_WORKFLOW, audiencePageJsonLd, audiencePagePath, getAudiencePage, relatedPageLabel,
  type AudienceKind,
} from "@shared/audience-pages";

/** A role or industry landing page: /roles/:slug and /industries/:slug. */
export default function AudiencePage({ kind, slug }: { kind: AudienceKind; slug: string }) {
  const page = getAudiencePage(kind, slug);
  if (!page) return <NotFound />;
  const section = AUDIENCE_SECTIONS[kind];
  const related = page.related.flatMap(path => {
    const label = relatedPageLabel(path);
    return label ? [{ path, label }] : [];
  });
  const siblings = section.pages.filter(candidate => candidate.slug !== page.slug);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO
        title={page.seoTitle.replace(" | TheSocialPundit", "")}
        canonical={audiencePagePath(kind, page)}
        description={page.metaDescription}
        jsonLd={audiencePageJsonLd(kind, page)}
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b bg-card py-20 lg:py-28">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,hsl(var(--primary)/0.12),transparent_38%)]" aria-hidden="true" />
          <Reveal className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground">Home</Link>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <Link href={section.path} className="hover:text-foreground">{section.label}</Link>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <span aria-current="page">{page.label}</span>
            </nav>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">{page.eyebrow}</p>
            <h1 className="mt-5 max-w-4xl heading-display text-balance">{page.headline}</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">{page.introduction}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link href="/sign-up">Start free<ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link></Button>
              <Button asChild size="lg" variant="outline"><Link href="/how-it-works">See how it works</Link></Button>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />Nothing publishes without your approval.
            </p>
          </Reveal>
        </section>

        <section className="py-20 lg:py-24" aria-labelledby="challenge-title">
          <Reveal className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 id="challenge-title" className="heading-section">{page.challengeTitle}</h2>
            {page.challenge.map(paragraph => (
              <p key={paragraph.slice(0, 32)} className="mt-5 text-lg leading-8 text-muted-foreground">{paragraph}</p>
            ))}
          </Reveal>
        </section>

        <section className="border-y bg-card py-20 lg:py-24" aria-labelledby="outcomes-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <Reveal className="mb-10 max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">What changes</p>
              <h2 id="outcomes-title" className="mt-4 heading-section">How TheSocialPundit helps</h2>
            </Reveal>
            <StaggerGroup className="grid gap-5 md:grid-cols-3">
              {page.outcomes.map(outcome => (
                <StaggerItem key={outcome.title} className="rounded-card border bg-background p-7">
                  <Check className="h-5 w-5 text-success" aria-hidden="true" />
                  <h3 className="mt-5 text-xl font-semibold">{outcome.title}</h3>
                  <p className="mt-3 leading-7 text-muted-foreground">{outcome.description}</p>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>

        <section className="py-20 lg:py-24" aria-labelledby="ideas-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <Reveal className="mb-10 max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">Post ideas</p>
              <h2 id="ideas-title" className="mt-4 heading-section">What you could post about this week</h2>
              <p className="mt-4 text-muted-foreground">Starting points drawn from the kind of stories Discover surfaces. Each becomes a draft you shape and approve.</p>
            </Reveal>
            <ul className="grid gap-4 sm:grid-cols-2">
              {page.postIdeas.map(idea => (
                <li key={idea} className="flex gap-3 rounded-card border bg-card p-5">
                  <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="leading-7">{idea}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-y bg-card py-20 lg:py-24" aria-labelledby="workflow-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <Reveal className="mb-12 max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">The workflow</p>
              <h2 id="workflow-title" className="mt-4 heading-section">From industry news to an approved post</h2>
            </Reveal>
            <ol className="grid gap-px overflow-hidden rounded-card border bg-border md:grid-cols-4">
              {AUDIENCE_WORKFLOW.map((step, index) => (
                <li key={step.title} className="bg-background p-6">
                  <span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span>
                  <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="py-20 lg:py-24" aria-labelledby="faq-title">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
            <Reveal>
              <h2 id="faq-title" className="heading-section">Questions before you begin</h2>
              <p className="mt-4 text-muted-foreground">Clear answers about what the workflow does, and what stays yours.</p>
            </Reveal>
            <div className="divide-y border-y">
              {page.faqs.map(faq => (
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

        <section className="border-t bg-muted/40 py-16" aria-labelledby="related-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 id="related-title" className="font-heading text-2xl font-semibold">Related pages</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {related.map(link => (
                <Link key={link.path} href={link.path} className="group rounded-card border bg-card p-5 hover:border-primary/40">
                  <span className="font-semibold">{link.label}</span>
                  <ArrowRight className="mt-4 h-4 w-4 text-primary transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              ))}
            </div>
            <h2 className="mt-12 font-heading text-xl font-semibold">Explore other {section.plural}</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {siblings.map(candidate => (
                <li key={candidate.slug}>
                  <Link href={audiencePagePath(kind, candidate)} className="inline-flex min-h-11 items-center rounded-full border bg-card px-4 text-sm font-medium hover:border-primary/40 hover:text-primary">
                    {candidate.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
