import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Linkedin,
  Newspaper,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsSignedIn } from "@/lib/dev-auth";
import { EASE } from "@/lib/motion";

const reassurances = ["No card needed", "Nothing posts without you", "Set up in about a minute"];

const signals = [
  { source: "Reuters", age: "18m", title: "Global ad spend shifts toward creator-led expertise", score: "Strong fit" },
  { source: "Harvard Business Review", age: "41m", title: "Why category experts are becoming the new media brands", score: "Worth a take" },
  { source: "LinkedIn News", age: "1h", title: "Executives rethink how they build trust online", score: "Trending" },
];

export function Hero() {
  const isSignedIn = useIsSignedIn();
  const reduce = useReducedMotion();
  const arrive = (delay: number) => reduce ? {} : {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease: EASE, delay },
  };

  return (
    <section
      className="relative isolate overflow-hidden border-b bg-card pb-16 pt-14 sm:pt-20 lg:pb-24 lg:pt-24"
      data-testid="section-hero"
    >
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute inset-x-0 top-0 h-[38rem] bg-[radial-gradient(circle_at_72%_8%,hsl(var(--primary)/0.12),transparent_42%)]" />
        <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(hsl(var(--foreground))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--foreground))_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16 lg:px-8">
        <motion.div {...arrive(0)} className="max-w-2xl">
          <h1 className="heading-display text-balance text-foreground" data-testid="text-hero-headline">
            Turn what you know into{" "}
            <span className="relative whitespace-nowrap text-primary">
              influence.
              <svg className="absolute -bottom-2 left-0 h-3 w-full text-primary/30" viewBox="0 0 300 12" fill="none" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 9.5C74 2.5 188 1 298 6.5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </span>
          </h1>

          <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            TheSocialPundit finds the stories shaping your industry, develops a point of view in your voice, and prepares every post for your approval—before the moment passes.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3" id="hero-cta">
            {isSignedIn ? (
              <Button asChild size="lg" className="h-12 px-6 text-base" data-testid="button-dashboard">
                <Link href="/dashboard">Open your workspace<ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg" className="h-12 px-6 text-base shadow-lg shadow-primary/15" data-testid="button-cta-primary">
                  <Link href="/sign-up">Build my authority<ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base bg-card" data-testid="link-cta-how-it-works">
                  <Link href="/how-it-works">See how it works</Link>
                </Button>
              </>
            )}
          </div>

          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {reassurances.map(item => (
              <li key={item} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" aria-hidden="true" />{item}
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div {...arrive(0.12)} className="relative mx-auto w-full max-w-2xl">
          <div className="absolute -inset-5 -z-10 rounded-[2.5rem] bg-primary/10 blur-3xl" aria-hidden="true" />
          <div className="overflow-hidden rounded-[1.75rem] border border-foreground/10 bg-foreground text-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10">
                  <Sparkles className="h-4 w-4 text-white" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">Today&apos;s authority brief</p>
                  <p className="text-xs text-white/55">Personalised for your expertise</p>
                </div>
              </div>
              <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/65 sm:flex">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Updated now
              </span>
            </div>

            <div className="grid gap-px bg-white/10 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="bg-foreground p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Signals for you</p>
                  <span className="text-xs text-white/45">3 of 24</span>
                </div>
                <div className="space-y-2.5">
                  {signals.map((signal, index) => (
                    <motion.div
                      key={signal.title}
                      {...arrive(0.22 + index * 0.08)}
                      className={`rounded-xl border p-3.5 ${index === 0 ? "border-primary/50 bg-primary/15" : "border-white/10 bg-white/[0.035]"}`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-white/45">
                        <span>{signal.source} · {signal.age}</span>
                        <span className={index === 0 ? "text-blue-300" : ""}>{signal.score}</span>
                      </div>
                      <p className="text-sm font-medium leading-snug text-white/90">{signal.title}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-5 text-foreground sm:p-6">
                <div className="mb-5 flex items-center justify-between">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />Point of view
                  </p>
                  <span className="rounded-full bg-success-subtle px-2.5 py-1 text-[11px] font-semibold text-success">Source checked</span>
                </div>
                <p className="font-heading text-xl font-semibold leading-snug sm:text-2xl">
                  Expertise is becoming the most defensible media channel.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Audiences are not asking for more content. They are asking for a useful perspective from someone who has earned one.
                </p>

                <div className="my-5 border-y py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-linkedin/10 text-brand-linkedin">
                        <Linkedin className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold">LinkedIn draft</p>
                        <p className="text-xs text-muted-foreground">Confident · 168 words</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex -space-x-2" aria-hidden="true">
                    <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-accent text-xs font-bold text-primary">in</span>
                    <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-muted text-xs font-bold">𝕏</span>
                    <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-success-subtle text-xs font-bold tracking-widest text-success">•••</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />Waiting for your approval
                  </span>
                </div>
              </div>
            </div>
          </div>

        </motion.div>
      </div>
    </section>
  );
}
