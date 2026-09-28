import { Globe2, MessageSquareQuote, Share2 } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { EDITION_COUNT, NETWORK_COUNT, TONES } from "./landing-content";

// Numbers read from the product's own configuration, never marketing estimates.
const facts = [
  { value: NETWORK_COUNT, label: "networks, one voice", detail: "From LinkedIn, X and WeChat to Naver Blog and Xing", icon: Share2 },
  { value: EDITION_COUNT, label: "regional news editions", detail: "From the US and UK to India, Japan and Brazil", icon: Globe2 },
  { value: TONES.length, label: "tones that sound like you", detail: TONES.join(" · "), icon: MessageSquareQuote },
];

export function Facts() {
  return (
    <section className="pb-20 lg:pb-28" data-testid="section-facts">
      <Reveal className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl bg-surface-ink text-surface-ink-foreground shadow-xl">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-secondary to-transparent" aria-hidden="true" />
          <ul className="grid divide-y divide-surface-ink-foreground/10 md:grid-cols-3 md:divide-x md:divide-y-0">
            {facts.map(fact => (
              <li key={fact.label} className="flex items-start gap-4 p-6 sm:p-8">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-secondary/15 text-secondary-on-dark">
                  <fact.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="font-heading text-4xl font-semibold leading-none tracking-tight sm:text-5xl">{fact.value}</p>
                  <p className="mt-2 text-lg font-medium">{fact.label}</p>
                  <p className="mt-1 text-sm leading-relaxed text-surface-ink-foreground/70">{fact.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </section>
  );
}
