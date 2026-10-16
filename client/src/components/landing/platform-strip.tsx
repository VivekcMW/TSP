import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { SOCIAL_NETWORKS } from "@/lib/platforms";

// Every network we draft for, as a quiet trust bar: breadth without a list in every sentence.
export function PlatformStrip() {
  return (
    <section className="border-b bg-card py-10" data-testid="section-platform-strip">
      <div className="mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
        <Reveal>
          <p className="mb-7 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            One point of view, shaped for every place your audience pays attention
          </p>
        </Reveal>
        <StaggerGroup className="flex max-h-24 flex-wrap items-center justify-center gap-x-7 gap-y-4 overflow-hidden sm:max-h-none">
          {SOCIAL_NETWORKS.map((platform) => (
            <StaggerItem key={platform.value} className="flex items-center gap-2 text-muted-foreground/80 transition-colors hover:text-foreground">
              <platform.icon className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs font-semibold sm:text-sm">{platform.label}</span>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
