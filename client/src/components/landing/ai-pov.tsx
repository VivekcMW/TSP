import { X } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { TONES } from "./landing-content";

// Illustrative contrast between a summary and a take; labelled as an example on the page.
const example = {
  generic: "This article discusses a new regulatory framework. It mentions that compliance is important for the future of the industry…",
  pundit: "The new framework isn't a hurdle. It's the green light institutional money was waiting for. If your roadmap ignores it, you're building a liability, not a business.",
};

export function AIPov() {
  return (
    <section id="voice" className="py-20 lg:py-28" data-testid="section-ai-pov">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-10 space-y-4 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary-text">Your voice</p>
          <h2 className="heading-section">Your voice, not generic AI</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Every draft takes a position on a real, current story instead of summarising it. Pick the tone that sounds like you.
          </p>
        </Reveal>
        <ul className="mb-10 flex flex-wrap justify-center gap-2" aria-label="Tones">
          {TONES.map((tone, index) => (
            <li key={tone} className={index === 0 ? "rounded-full border border-primary bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground" : "rounded-full border bg-card px-4 py-2 text-sm"}>{tone}</li>
          ))}
        </ul>
        <StaggerGroup className="grid items-stretch gap-6 md:grid-cols-2">
          <StaggerItem className="flex h-full flex-col rounded-card border border-dashed bg-muted/40 p-surface-relaxed">
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-destructive-subtle"><X className="h-3 w-3 text-destructive" aria-hidden="true" /></span>{" "}
              Generic AI summary
            </p>
            <p className="flex-1 text-muted-foreground line-through">{example.generic}</p>
          </StaggerItem>
          <StaggerItem className="flex h-full flex-col rounded-card border border-border bg-card p-surface-relaxed hover-lift">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-secondary-text">TheSocialPundit · {TONES[0]} · example</p>
            <p className="flex-1 text-lg leading-relaxed text-foreground">{example.pundit}</p>
          </StaggerItem>
        </StaggerGroup>
      </div>
    </section>
  );
}
