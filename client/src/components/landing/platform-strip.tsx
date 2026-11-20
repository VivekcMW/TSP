import { Linkedin } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";

export function PlatformStrip() {
  return (
    <section className="border-b bg-card py-10" data-testid="section-platform-strip">
      <div className="mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
        <Reveal className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Purpose-built for
          </p>
          <span className="inline-flex items-center gap-2 font-semibold text-foreground">
            <Linkedin className="h-5 w-5 text-brand-linkedin" aria-hidden="true" />
            LinkedIn
          </span>
          <span className="text-sm text-muted-foreground">Professional thought leadership, grounded in industry news.</span>
        </Reveal>
      </div>
    </section>
  );
}
