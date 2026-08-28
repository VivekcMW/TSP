import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO } from "@/components/seo";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { Compass, Heart, Sparkles, Target } from "lucide-react";

const values = [
  {
    icon: Target,
    title: "Opinions, not summaries",
    description:
      "Generic AI content summarizes the news. We believe the only content worth posting takes a stance — so every draft is built to have a point of view.",
  },
  {
    icon: Compass,
    title: "Your voice stays yours",
    description:
      "We draft, you decide. Nothing publishes without you reviewing it first — the AI is a starting point, never the final word.",
  },
  {
    icon: Heart,
    title: "Built for the busy, not the marketer",
    description:
      "You're an expert in your field, not a content creator. TheSocialPundit exists so your expertise doesn't stay invisible just because you don't have time to write.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title="About"
        canonical="/about"
        description="Why we built TheSocialPundit — and what we believe about AI-assisted professional content."
      />
      <SiteHeader />
      <main className="flex-1">
        <section className="py-16 lg:py-24" data-testid="section-about-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="heading-display mb-6" data-testid="text-about-title">
              Why we built TheSocialPundit
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              The best professionals we know are terrible at self-promotion — not because they lack
              opinions, but because they don't have time to write them down.
            </p>
          </div>
        </section>

        <section className="pb-16" data-testid="section-about-story">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <Reveal className="prose prose-neutral dark:prose-invert max-w-none space-y-5">
              <p className="text-muted-foreground">
                We kept meeting genuinely sharp people — founders, engineers, consultants, doctors — who
                had real, specific opinions about where their industry was headed, but hadn't posted
                anything in months. Not because they didn't care, but because turning a busy day into a
                well-formed, publish-ready take takes time most people don't have.
              </p>
              <p className="text-muted-foreground">
                Meanwhile, the people who did post consistently were often the least informed — because
                consistency, not expertise, is what social platforms actually reward. That felt backwards.
              </p>
              <p className="text-muted-foreground">
                TheSocialPundit is our attempt to fix that gap: read the news in your industry, draft an
                opinionated take in your voice, and hand it to you ready to review — so the people who
                actually know what they're talking about are the ones building an audience, not just the
                ones with the most spare time.
              </p>
            </Reveal>
          </div>
        </section>

        <section className="pb-20 lg:pb-28" data-testid="section-about-values">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <Reveal className="text-center mb-12">
              <h2 className="heading-section mb-4">What we believe</h2>
            </Reveal>
            <StaggerGroup className="grid md:grid-cols-3 gap-6">
              {values.map((value) => (
                <StaggerItem key={value.title}>
                  <Card className="h-full border bg-muted/30">
                    <CardContent className="p-6">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                        <value.icon className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="text-lg font-semibold mb-2">{value.title}</h3>
                      <p className="text-sm text-muted-foreground">{value.description}</p>
                    </CardContent>
                  </Card>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>

        <Reveal>
          <section className="py-16 lg:py-20 bg-muted/30" data-testid="section-about-cta">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <h2 className="heading-section mb-4">We're just getting started.</h2>
              <p className="text-muted-foreground mb-6">
                We're free for our first 1,000 subscribers while we build this together. Come be one of
                them.
              </p>
              <Link href="/sign-up" data-testid="link-about-signup">
                <Button size="lg">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Start Free Today
                </Button>
              </Link>
            </div>
          </section>
        </Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
