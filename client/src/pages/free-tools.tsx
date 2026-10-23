import { Link } from "wouter";
import { ArrowRight, Hash, Newspaper, PenLine, Type } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";
import { FREE_TOOLS, FREE_TOOLS_HUB_PATH, FREE_TOOLS_HUB_SEO, freeToolsHubJsonLd } from "@shared/free-tools";

const ICONS = [Newspaper, PenLine, Hash, Type];

export default function FreeToolsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEO title={FREE_TOOLS_HUB_SEO.title} rawTitle canonical={FREE_TOOLS_HUB_PATH}
        description={FREE_TOOLS_HUB_SEO.description} jsonLd={freeToolsHubJsonLd()} />
      <SiteHeader />
      <main className="flex-1">
        <section className="bg-muted/30 py-14 lg:py-20">
          <Reveal variants={fadeUp} className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-info">Free · No sign-up</p>
            <h1 className="heading-section mb-4 text-4xl sm:text-5xl" data-testid="text-tools-headline">Free LinkedIn tools</h1>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Write better LinkedIn posts faster: turn news into a draft, sharpen your opening line, pick the right hashtags and format the post so it reads well on a phone.
            </p>
          </Reveal>
        </section>

        <section className="py-14 lg:py-16">
          <ul className="mx-auto grid max-w-5xl gap-6 px-4 sm:px-6 md:grid-cols-2">
            {FREE_TOOLS.map((tool, index) => {
              const Icon = ICONS[index % ICONS.length];
              return (
                <li key={tool.path}>
                  <Link href={tool.path} className="group flex h-full flex-col rounded-2xl border bg-card p-6 transition-colors hover:border-primary" data-testid={`link-hub-${tool.path.split("/").pop()}`}>
                    <span className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                    <h2 className="font-heading text-xl font-semibold text-foreground">{tool.name}</h2>
                    <p className="mt-2 flex-1 text-muted-foreground">{tool.summary}</p>
                    <span className="mt-4 inline-flex items-center text-sm font-medium text-primary">Open the tool<ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="bg-muted/30 py-16 lg:py-20">
          <div className="mx-auto max-w-3xl space-y-4 px-4 text-muted-foreground sm:px-6">
            <h2 className="heading-section mb-2 text-foreground">From one-off posts to a weekly habit</h2>
            <p>These tools help with a single post. Posting well every week is harder: you need to spot the stories worth talking about, have a view on them and find the time to write.</p>
            <p>
              <Link href="/how-it-works" className="font-medium text-primary underline-offset-4 hover:underline">TheSocialPundit</Link> does that work with you. It watches the news in your industry, drafts posts in your own voice and schedules them after you approve.
              See <Link href="/pricing" className="font-medium text-primary underline-offset-4 hover:underline">plans and pricing</Link>, or read practical guides on the <Link href="/blog" className="font-medium text-primary underline-offset-4 hover:underline">blog</Link>.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
