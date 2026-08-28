import { Link } from "wouter";
import { Compass, Sparkles, Send, ArrowRight } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";

const steps = [
  {
    icon: Compass,
    step: "1",
    title: "Pick your industry",
    description: "Choose from 18 industries. We match you to 80+ trusted publications your peers already read.",
  },
  {
    icon: Sparkles,
    step: "2",
    title: "AI drafts your take",
    description: "Real-time news gets turned into an opinionated post in your chosen tonality — not a summary.",
  },
  {
    icon: Send,
    step: "3",
    title: "Review & publish",
    description: "Edit if you want, then post across LinkedIn, Twitter/X, and 21 more platforms in a couple of clicks.",
  },
];

export function HowItWorksPreview() {
  return (
    <section className="py-20 lg:py-28 bg-muted/30" data-testid="section-how-it-works-preview">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <h2 className="heading-section mb-4">From news to your voice in 3 steps.</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            No content calendar. No writer's block. Just a repeatable loop that takes minutes.
          </p>
        </Reveal>

        <StaggerGroup className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {steps.map((step) => (
            <StaggerItem key={step.step}>
              <div className="text-center" data-testid={`step-how-it-works-${step.step}`}>
                <div className="relative w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                  <step.icon className="w-6 h-6 text-primary" />
                  <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                    {step.step}
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">{step.description}</p>
              </div>
            </StaggerItem>
          ))}
        </StaggerGroup>

        <div className="text-center mt-12">
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:opacity-80 transition-opacity"
            data-testid="link-how-it-works-full"
          >
            See the full walkthrough
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
