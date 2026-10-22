import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Button } from "@/components/ui/button";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { AUDIENCE_SECTIONS, audienceHubJsonLd, audiencePagePath, type AudienceKind } from "@shared/audience-pages";

/** The /roles and /industries index pages. */
export default function AudienceHubPage({ kind }: { kind: AudienceKind }) {
  const section = AUDIENCE_SECTIONS[kind];
  const other = AUDIENCE_SECTIONS[kind === "roles" ? "industries" : "roles"];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO
        title={section.seoTitle.replace(" | TheSocialPundit", "")}
        canonical={section.path}
        description={section.metaDescription}
        jsonLd={audienceHubJsonLd(kind)}
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="border-b bg-card py-20 lg:py-28">
          <Reveal className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">{section.eyebrow}</p>
            <h1 className="mt-5 heading-display text-balance">{section.headline}</h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{section.introduction}</p>
          </Reveal>
        </section>

        <section className="py-20 lg:py-24" aria-labelledby="hub-grid-title">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal className="mb-10 max-w-2xl">
              <h2 id="hub-grid-title" className="heading-section">Choose yours</h2>
            </Reveal>
            <StaggerGroup className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {section.pages.map(page => (
                <StaggerItem key={page.slug} className="flex flex-col rounded-card border bg-card p-7 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-secondary-text">{page.eyebrow}</p>
                  <h3 className="mt-4 font-heading text-2xl font-semibold">{page.label}</h3>
                  <p className="mt-3 flex-1 leading-7 text-muted-foreground">{page.metaDescription}</p>
                  <Link href={audiencePagePath(kind, page)} className="mt-6 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
                    Explore {page.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>

        <section className="border-t bg-muted/40 py-16" aria-labelledby="hub-other-title">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div>
              <h2 id="hub-other-title" className="font-heading text-2xl font-semibold">Browse by {other.singular} instead</h2>
              <p className="mt-2 text-muted-foreground">{other.metaDescription}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline"><Link href={other.path}>All {other.plural}</Link></Button>
              <Button asChild><Link href="/sign-up">Start free<ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link></Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
