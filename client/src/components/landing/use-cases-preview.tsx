import { Link } from "wouter";
import { ArrowRight, Compass, Layers3, PenLine } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { USE_CASES } from "@shared/use-cases";

const icons = [Compass, PenLine, Layers3] as const;

export function UseCasesPreview() {
  return (
    <section className="pb-20 lg:pb-28" data-testid="section-use-cases">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary-text">Built around the work</p>
            <h2 className="mt-4 heading-section">Start with the outcome you need.</h2>
          </div>
          <Link href="/use-cases" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
            View all use cases<ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Reveal>
        <StaggerGroup className="grid gap-4 lg:grid-cols-3">
          {USE_CASES.map((useCase, index) => {
            const Icon = icons[index];
            return (
              <StaggerItem key={useCase.slug} className="group rounded-card border bg-card p-6 transition-colors hover:border-primary/35">
                <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="mt-5 text-xl font-semibold">{useCase.label}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{useCase.metaDescription}</p>
                <Link href={`/use-cases/${useCase.slug}`} className="mt-5 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">
                  Explore {useCase.label.toLowerCase()}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </StaggerItem>
            );
          })}
        </StaggerGroup>
      </div>
    </section>
  );
}
