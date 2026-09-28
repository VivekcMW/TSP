import { Link } from "wouter";
import { ArrowRight, Linkedin, Newspaper } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Reveal } from "@/components/motion/reveal";
import { industryPhotos } from "./landing-images";
import { INDUSTRIES } from "./landing-content";

/** Industry tabs: a photo, an example story, and the kind of post Pundit drafts from it. */
export function IndustriesShowcase() {
  return (
    <section id="industries" className="scroll-mt-20 bg-card py-20 lg:py-28" data-testid="section-industries">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl space-y-4">
            <p className="text-xs font-bold uppercase tracking-wider text-secondary-text">Industries</p>
            <h2 className="heading-section">Built for your industry</h2>
          </div>
          <Link href="/industries" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
            See every industry<ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Reveal>
        <Tabs defaultValue={INDUSTRIES[0].key}>
          <TabsList className="-mx-4 mb-8 flex h-auto justify-start gap-2 overflow-x-auto bg-transparent px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {INDUSTRIES.map(industry => (
              <TabsTrigger key={industry.key} value={industry.key}
                className="min-h-11 shrink-0 rounded-full border bg-background px-4 text-sm font-medium data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                {industry.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {INDUSTRIES.map(industry => {
            const photo = industryPhotos[industry.key];
            return (
              <TabsContent key={industry.key} value={industry.key} className="mt-0">
                <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
                  <img src={photo.src} srcSet={photo.srcSet} sizes="(min-width: 1024px) 600px, 100vw" width={photo.width} height={photo.height}
                    alt={photo.alt} loading="lazy" decoding="async" className="aspect-[4/3] h-auto w-full rounded-2xl bg-muted object-cover shadow-lg" />
                  <div className="space-y-4">
                    <div className="rounded-xl border bg-background p-5">
                      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Newspaper className="h-4 w-4" aria-hidden="true" />Today's story · example
                      </p>
                      <p className="text-lg font-semibold text-foreground">{industry.story}</p>
                    </div>
                    <div className="rounded-xl border-2 border-primary bg-background p-5">
                      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                        <Linkedin className="h-4 w-4" aria-hidden="true" />Your LinkedIn post · example
                      </p>
                      <p className="leading-relaxed text-foreground">{industry.post}</p>
                    </div>
                    <Link href="/sign-up" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
                      Get posts like this for {industry.label.split(" and ")[0].toLowerCase()}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </section>
  );
}
