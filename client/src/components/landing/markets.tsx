import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Reveal } from "@/components/motion/reveal";
import { EDITION_COUNT, REGIONS } from "./landing-content";

/** Regions as tabs: a city photo, the networks drafted for there, and its news editions. */
export function Markets() {
  return (
    <section id="markets" className="scroll-mt-20 py-20 lg:py-28" data-testid="section-markets">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Tabs defaultValue="global" orientation="vertical" className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-14">
          <div className="min-w-0 space-y-6">
            <Reveal className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-secondary-text">Global</p>
              <h2 className="heading-section">Works in your market</h2>
              <p className="text-lg text-muted-foreground">
                Pundit reads news from {EDITION_COUNT} regional editions and writes for the networks your audience
                actually uses, from LinkedIn to WeChat.
              </p>
            </Reveal>
            <TabsList className="-mx-4 flex h-auto justify-start gap-2 overflow-x-auto bg-transparent px-4 pb-1 sm:mx-0 sm:px-0 lg:flex-col lg:items-stretch lg:overflow-visible">
              {REGIONS.map(region => (
                <TabsTrigger key={region.key} value={region.key}
                  className="min-h-11 shrink-0 justify-start rounded-full border bg-card px-4 text-sm font-medium data-[state=active]:border-primary data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none lg:rounded-card lg:px-5 lg:py-3 lg:text-base">
                  {region.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {REGIONS.map(region => (
            <TabsContent key={region.key} value={region.key} className="mt-0 min-w-0 space-y-5">
              <figure className="relative overflow-hidden rounded-2xl bg-muted shadow-lg">
                <img src={region.photo.src} srcSet={region.photo.srcSet} sizes="(min-width: 1024px) 720px, 100vw"
                  width={region.photo.width} height={region.photo.height} alt={region.photo.alt}
                  loading="lazy" decoding="async" className="aspect-[16/10] h-auto w-full object-cover" />
                <figcaption className="border-t bg-card px-5 py-4 text-card-foreground">
                  <span className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">{region.place}</span>
                  <span className="font-heading text-xl font-semibold">{region.label}</span>
                </figcaption>
              </figure>
              <p className="text-muted-foreground">{region.summary}</p>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Networks</h3>
                <ul className="flex flex-wrap gap-2">
                  {region.networks.map(network => (
                    <li key={network.value} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm">
                      <network.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{network.label}
                    </li>
                  ))}
                </ul>
              </div>
              {region.editions.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">News editions</h3>
                  <ul className="flex flex-wrap gap-2">
                    {region.editions.map(edition => <li key={edition} className="rounded-md bg-muted px-2.5 py-1 text-sm text-muted-foreground">{edition}</li>)}
                  </ul>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
