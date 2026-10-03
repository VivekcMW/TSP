import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CalendarClock, Check, Linkedin, Newspaper, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsSignedIn } from "@/lib/dev-auth";
import { EASE } from "@/lib/motion";
import { heroPhoto } from "./landing-images";
import { EDITION_COUNT, NETWORK_COUNT } from "./landing-content";

const reassurances = ["No card needed", "You approve every post", `News from ${EDITION_COUNT} regional editions`];

export function Hero() {
  const isSignedIn = useIsSignedIn();
  const reduce = useReducedMotion();
  // Chips arrive in the order the product works: story found, draft written, post scheduled.
  const arrive = (delay: number) => reduce ? {} : {
    initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.18, ease: EASE, delay: delay * 0.18 },
  };

  return (
    <section className="overflow-x-clip bg-card pb-16 pt-12 lg:pb-24 lg:pt-20" data-testid="section-hero">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8">
        <div className="space-y-7">
          <h1 className="heading-display text-foreground" data-testid="text-hero-headline">
            Be the{" "}
            <span className="underline decoration-primary decoration-[0.12em] underline-offset-[0.16em]">voice</span>{" "}
            your industry listens to.
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground" data-testid="text-hero-subtext">
            Pundit reads today's news in your field and drafts posts in your voice for LinkedIn, X, WeChat and{" "}
            {NETWORK_COUNT - 3} more networks. You approve every word.
          </p>
          <div className="flex flex-wrap items-center gap-3" id="hero-cta">
            {isSignedIn ? (
              <Button asChild size="lg" data-testid="button-dashboard">
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg" data-testid="button-cta-primary">
                  <Link href="/sign-up">Start free<ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link>
                </Button>
                <Button asChild variant="outline" size="lg" data-testid="link-cta-how-it-works">
                  <Link href="/how-it-works">See how it works</Link>
                </Button>
              </>
            )}
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {reassurances.map(item => (
              <li key={item} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" aria-hidden="true" />{item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-md pb-28 sm:pb-0 lg:max-w-none">
          <div className="relative ml-auto aspect-[4/5] w-[88%] overflow-hidden rounded-[2rem] bg-accent shadow-xl">
            <img
              src={heroPhoto.src} srcSet={heroPhoto.srcSet} sizes="(min-width: 1024px) 520px, 88vw"
              width={heroPhoto.width} height={heroPhoto.height} alt={heroPhoto.alt}
              loading="eager" decoding="async"
              // React 18 only passes the lowercase HTML attribute through.
              {...{ fetchpriority: "high" }}
              className="h-full w-full object-cover"
            />
          </div>

          <motion.div {...arrive(0.2)} className="absolute left-0 top-[6%] flex max-w-[14rem] items-start gap-3 rounded-card border bg-card p-surface-compact shadow-sm sm:max-w-[16rem]" aria-hidden="true">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Newspaper className="h-4 w-4" /></span>
            <span className="text-xs leading-snug">
              <span className="block font-semibold text-foreground">Story found for you</span>
              <span className="text-muted-foreground">CTV and FAST put cable on the back foot · Exchange4Media</span>
            </span>
          </motion.div>

          <motion.div {...arrive(0.6)} className="absolute right-0 top-[42%] hidden items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-lg sm:flex lg:-right-4" aria-hidden="true">
            <Sparkles className="h-4 w-4 text-info" />Pundit is writing in your voice
          </motion.div>

          <motion.div {...arrive(1)} className="absolute bottom-0 left-0 w-[86%] max-w-sm space-y-3 rounded-card border bg-card p-surface-standard shadow-sm sm:bottom-[4%] sm:w-[78%]" aria-hidden="true">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-linkedin/10 text-brand-linkedin"><Linkedin className="h-3.5 w-3.5" /></span>
              Your LinkedIn post · draft
            </div>
            <p className="text-sm leading-relaxed text-foreground">
              Streaming isn't coming for cable's audience. It already has it. The real question is where the ad budgets follow…
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-2.5 py-1 font-medium text-success"><Check className="h-3 w-3" />Draft ready in seconds</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-info-subtle px-2.5 py-1 font-medium text-info"><CalendarClock className="h-3 w-3" />Scheduled · 9:00 your time</span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
