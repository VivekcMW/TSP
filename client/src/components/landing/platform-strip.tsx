import { PLATFORMS } from "@/lib/platforms";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";

// A quiet trust-bar style strip communicating platform breadth without
// repeating a 7-item list in every sentence of copy.
export function PlatformStrip() {
  return (
    <section className="py-12 border-y bg-muted/20" data-testid="section-platform-strip">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-8">
            One voice. Every platform your industry pays attention to.
          </p>
        </Reveal>
        <StaggerGroup className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
          {PLATFORMS.map((p) => (
            <StaggerItem
              key={p.value}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <p.icon className="w-5 h-5" />
              <span className="text-sm font-medium">{p.label}</span>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
