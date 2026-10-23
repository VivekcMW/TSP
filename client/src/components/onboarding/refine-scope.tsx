import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { SuggestionStep } from "@/lib/onboarding-suggestions";

export interface RefineOption {
  value: SuggestionStep;
  label: string;
  count: number;
}

interface RefineScopeProps {
  options: RefineOption[];
  value: SuggestionStep;
  onChange: (value: SuggestionStep) => void;
  disabled?: boolean;
}

/**
 * Which part of the setup the next message changes. A dropdown hid this behind
 * an extra open-then-pick, so the pills stay visible: they double as a readout
 * of what Pundit is about to touch, and of how much is selected there.
 */
export function RefineScope({ options, value, onChange, disabled = false }: Readonly<RefineScopeProps>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Selection follows focus, as it does in any radio group.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const last = options.length - 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? last
      : forward ? (index === last ? 0 : index + 1) : (index === 0 ? last : index - 1);
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span id="refine-scope-label" className="text-xs font-medium text-muted-foreground">Refining</span>
      <div role="radiogroup" aria-labelledby="refine-scope-label" className="flex min-w-0 flex-wrap gap-1">
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={element => { refs.current[index] = element; }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              onKeyDown={event => onKeyDown(event, index)}
              className={cn(
                "control-touch-target inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.count > 0 && (
                <span className={cn(
                  "rounded-full px-1.5 text-[0.6875rem] font-semibold tabular-nums",
                  selected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground",
                )}>
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
