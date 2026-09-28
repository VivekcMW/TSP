import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Reveal } from "@/components/motion/reveal";
import { productScreens, type LandingImage } from "./landing-images";
import { NETWORK_COUNT, TONES } from "./landing-content";

interface ProductArea {
  key: keyof typeof productScreens;
  label: string;
  title: string;
  body: string;
  points: string[];
  path: string;
}

export const PRODUCT_AREAS: ProductArea[] = [
  { key: "pundit", label: "Pundit", path: "onboarding",
    title: "Set up in a minute with Pundit",
    body: "Tell Pundit what you do in one sentence. It reads what's being published right now and builds your sources, topics and people.",
    points: ["Picks each source with a reason you can check", "Refine it by chatting: \"more Southeast Asia\"", "Keep what fits, remove the rest, add your own"] },
  { key: "discover", label: "Discover", path: "dashboard/discover",
    title: "Stories worth your opinion, every day",
    body: "Discover gathers fresh stories from your sources, topics and the people you follow, and tells you in plain words why each one is there.",
    points: ["A reason for every story", "Save, dismiss or write about it in one click", "A daily digest in your inbox, at your time"] },
  { key: "create", label: "Create", path: "dashboard/create",
    title: "A post in your voice, in seconds",
    body: `Turn any story, link or idea into a post shaped for one of ${NETWORK_COUNT} networks, in the tone that sounds like you.`,
    points: [`${TONES.length} tones: ${TONES.join(", ")}`, "Claims checked against the source article", "Edit freely before anything goes out"] },
  { key: "content", label: "Content", path: "dashboard/content",
    title: "Plan the week, publish when you're ready",
    body: "Drafts wait in one place until you're happy. Publish directly where a network allows it, or schedule for when your audience is awake.",
    points: ["Nothing posts without your approval", "Schedule in your own time zone", "Copy-ready posts for every other network"] },
];

function Screenshot({ image, path }: { image: LandingImage; path: string }) {
  return (
    <figure className="overflow-hidden rounded-2xl border bg-card shadow-xl">
      <div className="flex items-center gap-2 border-b bg-muted/60 px-4 py-2.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-border" /><span className="h-2.5 w-2.5 rounded-full bg-border" /><span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="ml-3 truncate rounded-md bg-background px-3 py-0.5 text-xs text-muted-foreground">thesocialpundit.com/{path}</span>
      </div>
      <img src={image.src} srcSet={image.srcSet} sizes="(min-width: 1024px) 720px, 100vw" width={image.width} height={image.height}
        alt={image.alt} loading="lazy" decoding="async" className="block h-auto w-full" />
    </figure>
  );
}

const fromHash = () => {
  const key = typeof window === "undefined" ? "" : window.location.hash.replace("#product-", "");
  return PRODUCT_AREAS.some(area => area.key === key) ? key : "pundit";
};

export function ProductShowcase() {
  const [tab, setTab] = useState(fromHash);
  // The header's Product menu links to /#product-<area>; open that tab when the address names one.
  useEffect(() => {
    const follow = () => setTab(fromHash());
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  return (
    <section id="product" className="scroll-mt-20 bg-card py-20 lg:py-28" data-testid="section-product">
      {PRODUCT_AREAS.map(area => <span key={area.key} id={`product-${area.key}`} className="block scroll-mt-20" aria-hidden="true" />)}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-10 max-w-2xl space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary-text">Product</p>
          <h2 className="heading-section">Everything you need to show up every week</h2>
          <p className="text-lg text-muted-foreground">From today's news to a post in your voice, in one place.</p>
        </Reveal>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-10 grid h-auto w-full grid-cols-4 gap-1 rounded-xl bg-muted p-1 sm:inline-flex sm:w-auto">
            {PRODUCT_AREAS.map(area => (
              <TabsTrigger key={area.key} value={area.key} className="min-h-11 rounded-lg px-2 text-sm font-medium sm:px-5">{area.label}</TabsTrigger>
            ))}
          </TabsList>
          {PRODUCT_AREAS.map(area => (
            <TabsContent key={area.key} value={area.key} className="mt-0">
              <div className="grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
                <div className="space-y-5">
                  <h3 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">{area.title}</h3>
                  <p className="text-lg leading-relaxed text-muted-foreground">{area.body}</p>
                  <ul className="space-y-3">
                    {area.points.map(point => (
                      <li key={point} className="flex items-start gap-3 text-foreground">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success/10 text-success"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>
                        {point}
                      </li>
                    ))}
                  </ul>
                  <Link href="/sign-up" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
                    Try {area.label} free<ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
                <Screenshot image={productScreens[area.key]} path={area.path} />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
