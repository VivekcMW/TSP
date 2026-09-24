import { useState, type ReactNode } from "react";
import { Check, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { evidenceLabel, type SuggestedChoice, type SuggestionKind } from "@/lib/onboarding-suggestions";
import type { AgentStepState } from "@/hooks/use-onboarding-agent";

export interface StepKind { kind: SuggestionKind; label: string; heading?: string }

interface AgentStepProps {
  mode: "agent" | "manual";
  state: AgentStepState;
  kinds: StepKind[];
  selected: (kind: SuggestionKind) => string[];
  lookup: (kind: SuggestionKind, name: string) => SuggestedChoice | undefined;
  disabled: (kind: SuggestionKind, name: string) => boolean;
  isPending: boolean;
  steerPlaceholder: string;
  onToggle: (kind: SuggestionKind, name: string) => void;
  onSteer: (instruction: string) => void;
  onRetry: () => void;
  onStartAgent: () => void;
  /** The step's "Add your own" inputs. */
  children: ReactNode;
}

function Choice({ kind, label, name, choice, selected, disabled, onToggle }: {
  kind: SuggestionKind; label: string; name: string; choice?: SuggestedChoice; selected: boolean; disabled: boolean; onToggle: (kind: SuggestionKind, name: string) => void;
}) {
  const evidence = choice ? evidenceLabel(choice) : undefined;
  return (
    <Button
      type="button"
      aria-pressed={selected}
      aria-label={`${selected ? "Remove" : "Select"} ${label} ${name}`}
      title={choice?.evidence && !choice.aiOnly ? `Latest: ${choice.evidence.headline}` : choice?.reason}
      disabled={disabled}
      variant={selected ? "default" : "outline"}
      className="h-auto min-h-11 flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
      onClick={() => onToggle(kind, name)}
    >
      <span className="flex items-center">
        {selected && <Check className="mr-1 h-3 w-3 shrink-0" />}
        <span>{name}</span>
        {evidence && <span className={cn("ml-1 text-xs", selected ? "opacity-80" : "text-muted-foreground")}>· {evidence}</span>}
      </span>
      {choice?.reason && <span className={cn("text-xs font-normal", selected ? "opacity-80" : "text-muted-foreground")}>{choice.reason}</span>}
    </Button>
  );
}

/** One onboarding step run by the agent: what it is doing, your setup, more options and steering. */
export function AgentStep({ mode, state, kinds, selected, lookup, disabled, isPending, steerPlaceholder, onToggle, onSteer, onRetry, onStartAgent, children }: Readonly<AgentStepProps>) {
  const [instruction, setInstruction] = useState("");
  const running = state.status === "running";
  const steer = () => {
    const text = instruction.trim();
    if (!text || running) return;
    onSteer(text);
    setInstruction("");
  };
  const isSelected = (kind: SuggestionKind, name: string) => selected(kind).some(item => item.toLowerCase() === name.toLowerCase());
  const options = (kind: SuggestionKind, items: SuggestedChoice[]) => items.filter(item => item.kind === kind && !isSelected(kind, item.name));
  const agentOptions = kinds.flatMap(({ kind }) => options(kind, state.items));
  const shownAiPeople = [...state.items, ...state.batches.flatMap(batch => batch.items)].some(item => item.aiOnly);

  return (
    <div className="space-y-5">
      <section aria-label="Agent" className="space-y-3 rounded-lg border border-dashed p-4">
        {mode === "manual" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Want the agent to find these from live news?</p>
            <Button type="button" variant="outline" size="sm" onClick={onStartAgent} disabled={isPending}>
              <Sparkles className="mr-2 h-4 w-4" />Let the agent help
            </Button>
          </div>
        ) : (
          <>
            {running && (
              <div role="status" aria-live="polite" className="space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 shrink-0 animate-pulse text-primary" />The agent is working…</p>
                <ol className="space-y-0.5 pl-6 text-sm text-muted-foreground">
                  {(state.feed.length ? state.feed.slice(-4) : ["Getting started…"]).map((line, index, lines) => (
                    <li key={`${index}-${line}`} className={cn(index === lines.length - 1 && "text-foreground")}>{line}</li>
                  ))}
                </ol>
              </div>
            )}
            {state.status === "ready" && (
              <div className="space-y-2">
                <p className="flex items-start gap-2 text-sm"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{state.note || (state.items.length ? "Here's what I found. Keep what fits and remove the rest." : "I couldn't find recent coverage for this. Add your own below, or tell me what to look for.")}</span>
                </p>
                {!state.grounded && <p className="text-xs text-muted-foreground">The news search didn't respond, so these come from the AI's general knowledge.</p>}
                {state.feed.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Show what I did</summary>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5">{state.feed.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
                  </details>
                )}
              </div>
            )}
            {state.status === "error" && (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
                <span>{state.error ?? "The agent couldn't finish this step."} Add your own below or try again.</span>
                <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={isPending}>Try again</Button>
              </div>
            )}
            {(state.status === "ready" || state.status === "error") && (
              <div className="flex gap-2">
                <Input aria-label="Tell the agent what to change" value={instruction} maxLength={200} disabled={isPending}
                  placeholder={steerPlaceholder} onChange={event => setInstruction(event.target.value)} onKeyDown={event => event.key === "Enter" && steer()} />
                <Button type="button" variant="outline" onClick={steer} disabled={isPending || !instruction.trim()}>
                  <Send className="mr-2 h-4 w-4" />Ask the agent
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-label="Your setup" className="space-y-2">
        <p className="text-sm font-medium">Your setup</p>
        {kinds.every(({ kind }) => !selected(kind).length) && <p className="text-sm text-muted-foreground">Nothing selected yet.</p>}
        {kinds.map(({ kind, label, heading }) => selected(kind).length > 0 && (
          <div key={kind} className="space-y-1">
            {heading && <p className="text-xs text-muted-foreground">{heading}</p>}
            <div className="flex flex-wrap gap-2">
              {selected(kind).map(name => <Choice key={name} kind={kind} label={label} name={name} choice={lookup(kind, name)} selected disabled={isPending} onToggle={onToggle} />)}
            </div>
          </div>
        ))}
      </section>

      {(agentOptions.length > 0 || state.batches.length > 0 || state.refreshing) && (
        <section aria-label="More options" className="space-y-3">
          {agentOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">More options from the agent</p>
              {kinds.map(({ kind, label, heading }) => options(kind, state.items).length > 0 && (
                <div key={kind} className="space-y-1">
                  {heading && <p className="text-xs text-muted-foreground">{heading}</p>}
                  <div className="flex flex-wrap gap-2">
                    {options(kind, state.items).map(item => <Choice key={item.name} kind={kind} label={label} name={item.name} choice={item} selected={false} disabled={disabled(kind, item.name)} onToggle={onToggle} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {state.batches.map(batch => {
            const fresh = kinds.flatMap(({ kind }) => options(kind, batch.items));
            if (!fresh.length) return null;
            return (
              <div key={batch.id} className="space-y-2">
                <p className="flex items-center gap-1 text-sm font-medium"><Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  {`${batch.items.length} new suggestion${batch.items.length === 1 ? "" : "s"} based on your picks`}</p>
                <div className="flex flex-wrap gap-2">
                  {kinds.flatMap(({ kind, label }) => options(kind, batch.items).map(item => (
                    <Choice key={`${kind}-${item.name}`} kind={kind} label={label} name={item.name} choice={item} selected={false} disabled={disabled(kind, item.name)} onToggle={onToggle} />
                  )))}
                </div>
              </div>
            );
          })}
          {state.refreshing && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 shrink-0 animate-pulse" />Finding more based on your picks…</p>}
          {shownAiPeople && <p className="text-xs text-muted-foreground">People marked “AI suggestion” come from the AI's general knowledge, not recent news.</p>}
        </section>
      )}

      <section aria-label="Add your own" className="space-y-2">
        <p className="text-sm font-medium">Add your own</p>
        {children}
      </section>
    </div>
  );
}
