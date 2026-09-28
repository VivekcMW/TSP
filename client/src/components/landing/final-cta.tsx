import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useIsSignedIn } from "@/lib/dev-auth";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";

export function FinalCTA() {
  const isSignedIn = useIsSignedIn();
  return (
    <section className="relative overflow-hidden bg-surface-ink py-20 text-surface-ink-foreground lg:py-24" data-testid="section-final-cta">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-secondary to-transparent" />
      <Reveal variants={fadeUp} className="mx-auto max-w-3xl space-y-5 px-4 text-center sm:px-6 lg:px-8">
        <h2 className="heading-section text-surface-ink-foreground">Start showing up this week.</h2>
        <p className="text-balance text-lg text-surface-ink-foreground/80">
          Set up in about a minute on the free plan, with no card needed. You approve every post.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {isSignedIn ? (
            <Button asChild size="lg" className="h-12 bg-secondary px-7 text-base text-secondary-foreground hover:bg-secondary/90" data-testid="link-final-cta-dashboard">
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="lg" className="h-12 bg-secondary px-7 text-base font-semibold text-secondary-foreground hover:bg-secondary/90" data-testid="link-final-cta-signup">
                <Link href="/sign-up">Start free</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 border-2 bg-transparent px-7 text-base text-surface-ink-foreground [border-color:hsl(var(--surface-ink-foreground)/0.6)] hover:bg-surface-ink-foreground/10">
                <Link href="/contact">Talk to us</Link>
              </Button>
            </>
          )}
        </div>
      </Reveal>
    </section>
  );
}
