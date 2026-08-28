import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { fadeUp } from "@/lib/motion";
import { useIsSignedIn } from "@/lib/dev-auth";

export function FinalCTA() {
  const isSignedIn = useIsSignedIn();

  return (
    <section
      className="py-20 lg:py-24 bg-surface-ink text-white relative overflow-hidden"
      data-testid="section-final-cta"
    >
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-secondary to-transparent" />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <Reveal variants={fadeUp}>
          <h2 className="heading-section mb-4 text-white">
            Free for the first 1,000 subscribers.
          </h2>
          <p className="text-lg text-white/70 mb-8 max-w-xl mx-auto">
            Start posting like the go-to voice in your industry — across 23 platforms, in your
            voice, in minutes a week.
          </p>
          {isSignedIn ? (
            <Link href="/dashboard" data-testid="link-final-cta-dashboard">
              <Button size="lg" className="bg-secondary text-secondary-foreground hover:opacity-90">
                <Sparkles className="w-4 h-4 mr-2" />
                Go to Dashboard
              </Button>
            </Link>
          ) : (
            <Link href="/sign-up" data-testid="link-final-cta-signup">
              <Button size="lg" className="bg-secondary text-secondary-foreground hover:opacity-90">
                <Sparkles className="w-4 h-4 mr-2" />
                Start Free Today
              </Button>
            </Link>
          )}
        </Reveal>
      </div>
    </section>
  );
}
