import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { evidenceLabel, type SuggestionKind } from "@/lib/onboarding-suggestions";
import type { StepSuggestions } from "@/hooks/use-onboarding-suggestions";

interface SuggestionPanelProps {
  state: StepSuggestions;
  /** Kinds shown by this panel, in order; `label` completes "Select <label> <name>". */
  kinds: Array<{ kind: SuggestionKind; label: string; heading?: string }>;
  searching: string;
  isSelected: (kind: SuggestionKind, name: string) => boolean;
  isDisabled: (kind: SuggestionKind, name: string) => boolean;
  onToggle: (kind: SuggestionKind, name: string) => void;
  onRetry: () => void;
}

export function SuggestionPanel({ state, kinds, searching, isSelected, isDisabled, onToggle, onRetry }: Readonly<SuggestionPanelProps>) {
  return (
    <section aria-label="Suggestions from recent news" className="space-y-3 rounded-lg border border-dashed p-3" data-testid="onboarding-suggestions">
      {state.batches.map((batch, index) => (
        <div key={batch.id} className="space-y-2">
          <p className="flex items-center gap-1 text-sm font-medium">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            {batch.fromPicks
              ? `${batch.items.length} new suggestion${batch.items.length === 1 ? "" : "s"} based on your picks`
              : batch.grounded ? "Suggested from recent news" : "Suggested by AI"}
          </p>
          {kinds.map(({ kind, label, heading }) => {
            const items = batch.items.filter(item => item.kind === kind);
            if (!items.length) return null;
            return (
              <div key={kind} className="space-y-1">
                {heading && <p className="text-xs text-muted-foreground">{heading}</p>}
                <div className="flex flex-wrap gap-2">
                  {items.map(item => {
                    const selected = isSelected(kind, item.name);
                    const evidence = evidenceLabel(item);
                    return (
                      <Button
                        type="button"
                        key={item.name}
                        aria-pressed={selected}
                        aria-label={`${selected ? "Remove" : "Select"} ${label} ${item.name}`}
                        title={item.evidence ? `Latest: ${item.evidence.headline}` : item.reason}
                        disabled={isDisabled(kind, item.name)}
                        variant={selected ? "default" : "outline"}
                        className="h-auto min-h-11 whitespace-normal text-left"
                        onClick={() => onToggle(kind, item.name)}
                      >
                        {selected && <Check className="mr-1 h-3 w-3" />}
                        <span>{item.name}</span>
                        {evidence && <span className={cn("ml-1 text-xs", selected ? "opacity-80" : "text-muted-foreground")}>· {evidence}</span>}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {index === 0 && (
            <p className="text-xs text-muted-foreground">
              {!batch.items.length ? "No recent coverage matched your focus yet. Pick from the list below."
                : batch.grounded ? "From news published in the last 30 days. Suggestions update as you pick."
                  : "AI suggestions: the news search didn't respond, so these aren't checked against recent coverage."}
            </p>
          )}
        </div>
      ))}
      {state.status === "loading" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 shrink-0 animate-pulse" />
          {state.batches.length ? "Finding more based on your picks…" : searching}
        </p>
      )}
      {state.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <span>{state.error} Your picks are kept. Choose from the list below or try again.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry suggestions</Button>
        </div>
      )}
    </section>
  );
}
