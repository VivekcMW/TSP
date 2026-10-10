import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Basics", description: "Your market" },
  { title: "Focus", description: "What matters" },
  { title: "Curate", description: "Review your feed" },
] as const;

interface OnboardingProgressProps {
  currentStep: 1 | 2 | 3;
  completed?: boolean;
  className?: string;
}

export function OnboardingProgress({ currentStep, completed = false, className }: Readonly<OnboardingProgressProps>) {
  return (
    <nav aria-label="Onboarding progress" className={cn("w-full", className)}>
      <ol className="grid grid-cols-3 gap-2">
        {STEPS.map((step, index) => {
          const number = (index + 1) as 1 | 2 | 3;
          const isDone = completed || number < currentStep;
          const isCurrent = !completed && number === currentStep;
          return (
            <li key={step.title} aria-current={isCurrent ? "step" : undefined} className="min-w-0">
              <div className="mb-2 flex items-center">
                <span className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  isDone && "border-primary bg-primary text-primary-foreground",
                  isCurrent && "border-primary bg-primary/10 text-primary",
                  !isDone && !isCurrent && "border-border bg-background text-muted-foreground",
                )}>
                  {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : number}
                </span>
                {number < 3 && (
                  <span className={cn("mx-2 h-px min-w-0 flex-1 bg-border", (isDone || number < currentStep) && "bg-primary")} />
                )}
              </div>
              <p className={cn("truncate text-xs font-semibold sm:text-sm", isCurrent ? "text-foreground" : "text-muted-foreground")}>{step.title}</p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">{step.description}</p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
