import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useIsSignedIn } from "@/lib/dev-auth";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";

export function FinalCTA() {
  const isSignedIn = useIsSignedIn();
  return (
    <section className="relative overflow-hidden border-t bg-card py-20 text-card-foreground lg:py-24" data-testid="section-final-cta">
      <Reveal variants={fadeUp} className="mx-auto max-w-3xl space-y-5 px-4 text-center sm:px-6 lg:px-8">
        <h2 className="heading-section text-foreground">Start showing up this week.</h2>
        <p className="text-balance text-lg text-muted-foreground">
          Set up in about a minute on the free plan, with no card needed. You approve every post.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {isSignedIn ? (
            <Button asChild size="lg" data-testid="link-final-cta-dashboard">
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="lg" data-testid="link-final-cta-signup">
                <Link href="/sign-up">Start free</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/contact">Talk to us</Link>
              </Button>
            </>
          )}
        </div>
      </Reveal>
    </section>
  );
}
