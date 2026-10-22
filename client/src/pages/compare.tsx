import { Link } from "wouter";
import { ArrowRight, Check, ChevronRight, ExternalLink } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/reveal";
import NotFound from "@/pages/not-found";
import {
  COMPARE_HUB, COMPARISONS, COMPARISONS_CHECKED, comparisonJsonLd, comparisonPath, getComparison,
} from "@shared/comparisons";

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** /compare/:slug — a fair, sourced comparison with one competitor. */
export default function ComparePage({ slug }: { slug: string }) {
  const page = getComparison(slug);
  if (!page) return <NotFound />;
  const others = COMPARISONS.filter(candidate => candidate.slug !== page.slug);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title={page.seoTitle} rawTitle canonical={comparisonPath(page)} description={page.metaDescription} jsonLd={comparisonJsonLd(page)} />
      <SiteHeader />
      <main className="flex-1">
        <section className="border-b bg-card py-20 lg:py-24">
          <Reveal className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground">Home</Link>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <Link href={COMPARE_HUB.path} className="hover:text-foreground">Compare</Link>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <span aria-current="page">{page.competitor}</span>
            </nav>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">{page.competitor} alternative</p>
            <h1 className="mt-5 heading-display text-balance">{page.headline}</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">{page.introduction}</p>
            <p className="mt-4 text-sm text-muted-foreground">Last checked <time dateTime={COMPARISONS_CHECKED}>{formatDate(COMPARISONS_CHECKED)}</time> against {page.competitor}'s own website.</p>
          </Reveal>
        </section>

        <section className="py-16 lg:py-20" aria-labelledby="verdict-title">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="rounded-card border border-primary/20 bg-primary/5 p-6 sm:p-8">
              <h2 id="verdict-title" className="text-sm font-bold uppercase tracking-[0.16em] text-primary">The short answer</h2>
              <p className="mt-3 text-lg leading-8 text-foreground">{page.verdict}</p>
            </div>
            <h2 className="mt-14 heading-section">What is {page.competitor}?</h2>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">{page.competitorSummary}</p>
            <h2 className="mt-14 heading-section">What is TheSocialPundit?</h2>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">
              TheSocialPundit helps professionals build authority from what is happening in their industry. Pundit builds a news brief from a sentence about your work, Discover brings you relevant stories with a reason each one fits, and Create drafts a post that takes a position, in a tone you choose. You edit every draft, and nothing is published without your action.
            </p>
          </div>
        </section>

        <section className="border-y bg-card py-16 lg:py-20" aria-labelledby="table-title">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <h2 id="table-title" className="heading-section">TheSocialPundit vs {page.competitor} at a glance</h2>
            <div className="mt-8 overflow-x-auto rounded-card border bg-background">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Feature comparison of TheSocialPundit and {page.competitor}</caption>
                <thead className="bg-muted/60 text-foreground">
                  <tr>
                    <th scope="col" className="w-1/4 p-4 font-semibold">Feature</th>
                    <th scope="col" className="p-4 font-semibold">TheSocialPundit</th>
                    <th scope="col" className="p-4 font-semibold">{page.competitor}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {page.rows.map(row => (
                    <tr key={row.feature} className="align-top">
                      <th scope="row" className="p-4 font-semibold text-foreground">{row.feature}</th>
                      <td className="p-4 leading-6 text-muted-foreground">{row.theSocialPundit}</td>
                      <td className="p-4 leading-6 text-muted-foreground">{row.competitor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="py-16 lg:py-20" aria-labelledby="choose-title">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <h2 id="choose-title" className="heading-section">Which should you choose?</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <div className="rounded-card border bg-card p-6">
                <h3 className="text-xl font-semibold">Choose {page.competitor} if</h3>
                <ul className="mt-4 space-y-3">
                  {page.chooseCompetitorIf.map(item => <li key={item} className="flex gap-2 leading-7 text-muted-foreground"><Check className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{item}</li>)}
                </ul>
              </div>
              <div className="rounded-card border border-primary/30 bg-card p-6">
                <h3 className="text-xl font-semibold">Choose TheSocialPundit if</h3>
                <ul className="mt-4 space-y-3">
                  {page.chooseUsIf.map(item => <li key={item} className="flex gap-2 leading-7 text-muted-foreground"><Check className="mt-1.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />{item}</li>)}
                </ul>
                <Button asChild className="mt-6"><Link href="/sign-up">Start free<ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link></Button>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t bg-card py-16 lg:py-20" aria-labelledby="compare-faq-title">
          <div className="mx-auto grid max-w-5xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
            <h2 id="compare-faq-title" className="heading-section">Common questions</h2>
            <div className="divide-y border-y">
              {page.faqs.map(faq => (
                <div key={faq.question} className="py-5">
                  <h3 className="font-semibold">{faq.question}</h3>
                  <p className="mt-2 leading-7 text-muted-foreground">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/40 py-14" aria-labelledby="sources-title">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <h2 id="sources-title" className="font-heading text-xl font-semibold">Sources and method</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Details about {page.competitor} come from its official website, checked on {formatDate(COMPARISONS_CHECKED)}. Products change, so check each vendor's site for current features and pricing. {page.competitor} is a trademark of its owner; TheSocialPundit isn't affiliated with it. Spotted something out of date? <Link href="/contact" className="text-primary hover:underline">Tell us</Link> and we'll correct it.
            </p>
            <ul className="mt-4 flex flex-wrap gap-3 text-sm">
              {page.sources.map(source => (
                <li key={source}>
                  <a href={source} rel="nofollow noopener noreferrer" target="_blank" className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline">
                    {source.replace(/^https?:\/\/(www\.)?/, "")}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
            <h2 className="mt-10 font-heading text-xl font-semibold">More comparisons</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {others.map(candidate => (
                <li key={candidate.slug}>
                  <Link href={comparisonPath(candidate)} className="inline-flex min-h-11 items-center rounded-full border bg-card px-4 text-sm font-medium hover:border-primary/40 hover:text-primary">
                    vs {candidate.competitor}
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
