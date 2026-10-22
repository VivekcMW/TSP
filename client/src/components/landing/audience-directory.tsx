import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { AUDIENCE_INDEX } from "@shared/audience-index";
import { FREE_TOOL_LINKS } from "@/lib/free-tool-links";

/** Links from the homepage to every role and industry page, and the free tools. */
export function AudienceDirectory() {
  return (
    <section className="pb-20 lg:pb-28" data-testid="section-audience-directory" aria-labelledby="audience-directory-title">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-10 max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">Who it's for</p>
          <h2 id="audience-directory-title" className="mt-4 heading-section">Built for your role and your industry.</h2>
        </Reveal>
        <div className="grid gap-6 lg:grid-cols-2">
          {Object.values(AUDIENCE_INDEX).map(section => (
            <Reveal key={section.kind} className="rounded-card border bg-card p-6">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-xl font-semibold">By {section.singular}</h3>
                <Link href={section.path} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">
                  All {section.plural}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
              <ul className="mt-4 flex flex-wrap gap-2">
                {section.pages.map(page => (
                  <li key={page.slug}>
                    <Link href={`${section.path}/${page.slug}`} className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary">
                      {page.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
          <Reveal className="rounded-card border bg-card p-6 lg:col-span-2">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-xl font-semibold">Free LinkedIn tools</h3>
              <Link href="/tools" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="link-home-tools">
                All free tools<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <ul className="mt-4 flex flex-wrap gap-2">
              {FREE_TOOL_LINKS.map(tool => (
                <li key={tool.href}>
                  <Link href={tool.href} className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary">
                    {tool.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
