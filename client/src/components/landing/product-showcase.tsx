import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Reveal } from "@/components/motion/reveal";
import { ProductIllustration, type ProductIllustrationKey } from "./product-illustrations";
import { TONES } from "./landing-content";

interface ProductArea {
  key: ProductIllustrationKey;
  label: string;
  title: string;
  body: string;
  points: string[];
}

export const PRODUCT_AREAS: ProductArea[] = [
  { key: "pundit", label: "Pundit",
    title: "Set up in a minute with Pundit",
    body: "Tell Pundit what you do in one sentence. It reads what's being published right now and builds your sources, topics and people.",
    points: ["Picks each source with a reason you can check", "Refine it by chatting: \"more Southeast Asia\"", "Keep what fits, remove the rest, add your own"] },
  { key: "discover", label: "Discover",
    title: "Stories worth your opinion, every day",
    body: "Discover gathers fresh stories from your sources, topics and the people you follow, and tells you in plain words why each one is there.",
    points: ["A reason for every story", "Save, dismiss or write about it in one click", "A daily digest in your inbox, at your time"] },
  { key: "create", label: "Create",
    title: "A post in your voice, in seconds",
    body: "Turn any story, link or idea into a post shaped for the network you choose, in the tone that sounds like you.",
    points: [`${TONES.length} tones: ${TONES.join(", ")}`, "Claims checked against the source article", "Edit freely before anything goes out"] },
  { key: "content", label: "Content",
    title: "Plan the week, publish when you're ready",
    body: "Drafts wait in one place until you're happy. Publish directly where a network allows it, or schedule for when your audience is awake.",
    points: ["Nothing posts without your approval", "Schedule in your own time zone", "Copy-ready posts for every other network"] },
];

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
    <section id="product" className="scroll-mt-20 bg-card py-20 lg:py-32" data-testid="section-product">
      {PRODUCT_AREAS.map(area => <span key={area.key} id={`product-${area.key}`} className="block scroll-mt-20" aria-hidden="true" />)}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-12 grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">Your authority system</p>
            <h2 className="heading-section">Everything between “I should post” and published.</h2>
          </div>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground lg:justify-self-end">
            One focused workspace for discovering timely ideas, forming a credible take, and showing up consistently in your own voice.
          </p>
        </Reveal>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-10 grid h-auto w-full grid-cols-4 gap-1 rounded-xl border bg-muted/60 p-1 sm:inline-flex sm:w-auto">
            {PRODUCT_AREAS.map(area => (
              <TabsTrigger key={area.key} value={area.key} className="min-h-11 rounded-lg px-2 text-sm font-medium sm:px-5">{area.label}</TabsTrigger>
            ))}
          </TabsList>
          {PRODUCT_AREAS.map(area => (
            <TabsContent key={area.key} value={area.key} className="mt-0">
              <div className="grid items-center gap-10 rounded-[1.75rem] border bg-background p-5 shadow-sm sm:p-8 lg:grid-cols-[0.7fr_1.3fr] lg:gap-12 lg:p-10">
                <div className="space-y-5">
                  <h3 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">{area.title}</h3>
                  <p className="text-lg leading-relaxed text-muted-foreground">{area.body}</p>
                  <ul className="space-y-3">
                    {area.points.map(point => (
                      <li key={point} className="flex items-start gap-3 text-foreground">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success-subtle text-success"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>
                        {point}
                      </li>
                    ))}
                  </ul>
                  <Link href="/sign-up" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
                    Try {area.label} free<ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
                <div className="relative min-w-0">
                  <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-primary/10 blur-3xl" aria-hidden="true" />
                  <ProductIllustration area={area.key} />
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
