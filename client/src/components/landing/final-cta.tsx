import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useIsSignedIn } from "@/lib/dev-auth";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";

export function FinalCTA() {
  const isSignedIn = useIsSignedIn();
  return (
    <section className="relative overflow-hidden bg-foreground py-20 text-background lg:py-28" data-testid="section-final-cta">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,hsl(var(--primary)/0.45),transparent_45%)]" aria-hidden="true" />
      <Reveal variants={fadeUp} className="relative mx-auto max-w-4xl space-y-6 px-4 text-center sm:px-6 lg:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Your next post starts here</p>
        <h2 className="heading-section text-balance text-white">The next voice your industry remembers should be yours.</h2>
        <p className="mx-auto max-w-2xl text-balance text-lg text-white/60">
          Set up Pundit in about a minute. Get a feed built around your expertise. Approve every word.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-3">
          {isSignedIn ? (
            <Button asChild size="lg" className="h-12 px-6" data-testid="link-final-cta-dashboard">
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="lg" className="h-12 bg-white px-6 text-foreground hover:bg-white/90" data-testid="link-final-cta-signup">
                <Link href="/sign-up">Build my authority</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 border-white/20 bg-white/5 px-6 text-white hover:bg-white/10 hover:text-white">
                <Link href="/contact">Talk to us</Link>
              </Button>
            </>
          )}
        </div>
      </Reveal>
    </section>
  );
}
