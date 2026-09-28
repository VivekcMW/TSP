import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { SOCIAL_NETWORKS } from "@/lib/platforms";

// Every network we draft for, as a quiet trust bar: breadth without a list in every sentence.
export function PlatformStrip() {
  return (
    <section className="py-12" data-testid="section-platform-strip">
      <div className="mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
        <Reveal>
          <p className="mb-8 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Publish where your industry pays attention
          </p>
        </Reveal>
        <StaggerGroup className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5">
          {SOCIAL_NETWORKS.map((platform) => (
            <StaggerItem key={platform.value} className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
              <platform.icon className="h-5 w-5" aria-hidden="true" />
              <span className="text-sm font-medium">{platform.label}</span>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
