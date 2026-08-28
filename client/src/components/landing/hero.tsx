import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Zap, Clock, Sparkles, Newspaper, ArrowRight } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { Link } from "wouter";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp, scaleIn } from "@/lib/motion";

export function Hero() {
  const isSignedIn = useIsSignedIn();

  return (
    <section className="py-20 lg:py-28" data-testid="section-hero">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <Reveal variants={fadeUp} className="space-y-8">
          <h1 className="heading-display" data-testid="text-hero-headline">
            Too busy to post{" "}
            <span className="text-primary">consistently</span>?
          </h1>
          
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-hero-subtext">
            Your expertise is invisible if you're not posting consistently. TheSocialPundit reads the
            news in your industry and writes posts in your voice, ready to publish across 23
            platforms in 60 seconds — no more blank screens, no more wasted hours.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <span>5 min/day</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>Gemini 2.5 Flash AI</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              <span>18 industries</span>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-center gap-4">
            {isSignedIn ? (
              <Link href="/dashboard">
                <Button size="lg" data-testid="button-dashboard">
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/sign-up">
                  <Button size="lg" data-testid="button-cta-primary">
                    Start Free Today
                  </Button>
                </Link>
                <Link href="/how-it-works" data-testid="link-cta-how-it-works">
                  <Button variant="outline" size="lg">
                    See How It Works
                  </Button>
                </Link>
              </>
            )}
          </div>
        </Reveal>

        <Reveal variants={scaleIn} delay={0.15} className="mt-16">
          <Card className="border bg-muted/30 text-left overflow-hidden" data-testid="card-hero-demo">
            <CardContent className="p-6 lg:p-8">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-5 text-center">
                See it in action
              </p>
              <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 items-center">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Newspaper className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Today's industry news
                    </p>
                    <p className="text-sm text-muted-foreground">
                      "Fed signals rate cuts as inflation cools faster than expected"
                    </p>
                  </div>
                </div>

                <ArrowRight className="w-5 h-5 text-primary shrink-0 mx-auto rotate-90 md:rotate-0" />

                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-primary uppercase tracking-wide mb-1">
                      Your LinkedIn post, drafted
                    </p>
                    <p className="text-sm">
                      "Rate cuts are coming faster than the market priced in. If your 2026 plan
                      assumed higher-for-longer, it's time to revisit it..."
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

