import { ArrowRight, CheckCircle2, Radar, Sparkles, Send } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";

const steps = [
  {
    number: "01",
    icon: Radar,
    title: "Find the signal",
    body: "Pundit watches the sources, topics and people that matter in your field—across regional editions.",
    meta: "Relevant, current, explained",
  },
  {
    number: "02",
    icon: Sparkles,
    title: "Shape your take",
    body: "It turns a timely story into a clear point of view grounded in the source and calibrated to your voice.",
    meta: "A perspective, not a summary",
  },
  {
    number: "03",
    icon: CheckCircle2,
    title: "Make it yours",
    body: "Review every claim, change the tone, edit freely or skip it. You remain the editor-in-chief.",
    meta: "Human judgment stays in control",
  },
  {
    number: "04",
    icon: Send,
    title: "Show up everywhere",
    body: "Adapt one strong idea for each network, then publish or schedule it when your audience is listening.",
    meta: "One voice across every channel",
  },
];

export function AuthorityLoop() {
  return (
    <section className="relative overflow-hidden bg-foreground py-20 text-background lg:py-28" data-testid="section-authority-loop">
      <div className="pointer-events-none absolute inset-0 opacity-10 [background-image:radial-gradient(circle_at_center,hsl(var(--background))_1px,transparent_1px)] [background-size:24px_24px]" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-12 grid gap-5 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-blue-300">The authority loop</p>
            <h2 className="heading-section max-w-xl text-white">From industry signal to memorable point of view.</h2>
          </div>
          <p className="max-w-xl text-lg leading-relaxed text-white/60 lg:justify-self-end">
            Consistency does not come from posting more. It comes from a repeatable editorial system that helps you say something worth remembering.
          </p>
        </Reveal>

        <StaggerGroup className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <StaggerItem key={step.number} className="group relative bg-foreground p-6 sm:p-7">
              <div className="mb-10 flex items-center justify-between">
                <span className="font-mono text-xs text-white/35">{step.number}</span>
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-blue-300 transition-colors group-hover:border-blue-300/30 group-hover:bg-blue-300/10">
                  <step.icon className="h-5 w-5" aria-hidden="true" />
                </span>
              </div>
              <h3 className="font-heading text-xl font-semibold text-white">{step.title}</h3>
              <p className="mt-3 min-h-24 text-sm leading-relaxed text-white/55">{step.body}</p>
              <p className="mt-6 flex items-center gap-1.5 border-t border-white/10 pt-4 text-xs font-medium text-white/70">
                {step.meta}{index < steps.length - 1 && <ArrowRight className="ml-auto hidden h-4 w-4 text-white/25 lg:block" aria-hidden="true" />}
              </p>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
