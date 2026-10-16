import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Cpu,
  Film,
  GraduationCap,
  HeartHandshake,
  Landmark,
  Leaf,
  Megaphone,
  Plane,
  Radio,
  Scale,
  ShoppingBag,
  Sparkles,
  Sprout,
  Stethoscope,
  Factory,
  Flag,
  type LucideIcon,
} from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { EASE } from "@/lib/motion";

interface Industry {
  label: string;
  icon: LucideIcon;
}

const industries: Industry[] = [
  { label: "Media & Advertising", icon: Megaphone },
  { label: "Technology & SaaS", icon: Cpu },
  { label: "Finance & Banking", icon: Landmark },
  { label: "Healthcare & Pharma", icon: Stethoscope },
  { label: "E-commerce & Retail", icon: ShoppingBag },
  { label: "Consulting & Services", icon: BriefcaseBusiness },
  { label: "Legal Services", icon: Scale },
  { label: "Hospitality & Travel", icon: Plane },
  { label: "Real Estate", icon: Building2 },
  { label: "Education & EdTech", icon: GraduationCap },
  { label: "Product Marketing", icon: Sparkles },
  { label: "Manufacturing", icon: Factory },
  { label: "Energy & Sustainability", icon: Leaf },
  { label: "Non-profit & NGO", icon: HeartHandshake },
  { label: "Government", icon: Flag },
  { label: "Entertainment", icon: Film },
  { label: "Telecommunications", icon: Radio },
  { label: "Agriculture & Food", icon: Sprout },
];

const liveBrief = [
  { label: "Publications", value: "Trusted sources in your field" },
  { label: "Topics", value: "The shifts your peers discuss" },
  { label: "People", value: "Experts shaping the conversation" },
];

export function IndustriesShowcase() {
  const reduce = useReducedMotion();

  return (
    <section id="industries" className="scroll-mt-20 overflow-hidden bg-card py-20 lg:py-28" data-testid="section-industries">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div className="max-w-2xl space-y-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">Every field. Every niche.</p>
            <h2 className="heading-section text-balance">If there is a conversation in your industry, Pundit can follow it.</h2>
          </div>
          <div className="max-w-xl space-y-5 lg:justify-self-end">
            <p className="text-lg leading-relaxed text-muted-foreground">
              You are not choosing from a fixed template. Tell Pundit what you do—in any profession, market or specialist niche—and it builds the intelligence brief around you.
            </p>
            <Link href="/sign-up" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
              Build your industry brief<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <StaggerGroup className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {industries.map((industry, index) => (
              <StaggerItem
                key={industry.label}
                className="group flex min-h-24 items-center gap-3 rounded-xl border bg-background p-3 transition-colors hover:border-primary/30 hover:bg-accent/40 sm:p-4"
              >
                <motion.span
                  animate={reduce || index !== 1 ? undefined : { rotate: [0, 4, -4, 0] }}
                  transition={reduce ? undefined : { duration: 3, repeat: Infinity, repeatDelay: 2 }}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                >
                  <industry.icon className="h-4 w-4" aria-hidden="true" />
                </motion.span>
                <span className="text-sm font-semibold leading-snug text-foreground">{industry.label}</span>
              </StaggerItem>
            ))}
          </StaggerGroup>

          <div className="relative min-h-[32rem] overflow-hidden rounded-[1.75rem] bg-foreground p-5 text-white shadow-xl sm:p-7">
            <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_center,hsl(var(--background))_1px,transparent_1px)] [background-size:24px_24px]" aria-hidden="true" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">A brief built from scratch</p>
                  <h3 className="mt-2 font-heading text-2xl font-semibold">Your industry goes here.</h3>
                </div>
                <motion.span
                  animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.75, 1, 0.75] }}
                  transition={reduce ? undefined : { duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-blue-300"
                >
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                </motion.span>
              </div>

              <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                <p className="text-xs text-white/45">Tell Pundit what you do</p>
                <p className="mt-2 text-base leading-relaxed text-white/90">
                  “I advise family-owned food exporters on cross-border growth in the Middle East.”
                </p>
              </div>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <motion.span
                  initial={reduce ? false : { opacity: 0.45 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reduce ? 0 : 0.8, repeat: reduce ? 0 : Infinity, repeatType: "reverse", ease: EASE }}
                  className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-300"
                >
                  Pundit is mapping your world
                </motion.span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <div className="space-y-2.5">
                {liveBrief.map((item, index) => (
                  <motion.div
                    key={item.label}
                    initial={reduce ? false : { opacity: 0, x: 16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: reduce ? 0 : 0.4, delay: index * 0.1, ease: EASE }}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/10 p-3.5"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-300/10 font-mono text-xs text-blue-300">0{index + 1}</span>
                    <div>
                      <p className="text-xs font-semibold text-white">{item.label}</p>
                      <p className="mt-0.5 text-xs text-white/45">{item.value}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-success/25 bg-success/10 p-3.5">
                <p className="flex items-center gap-2 text-sm font-semibold text-green-300">
                  <span className="h-2 w-2 rounded-full bg-green-300" />No preset required
                </p>
                <p className="mt-1 text-xs leading-relaxed text-white/50">Refine the brief in conversation until it matches the way you actually work.</p>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          These are examples, not limits. From aerospace to zoology, your expertise defines the system.
        </p>
      </div>
    </section>
  );
}
