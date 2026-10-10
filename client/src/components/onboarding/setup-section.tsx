import { useState, type ReactNode } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { evidenceLabel, type SuggestedChoice, type SuggestionKind } from "@/lib/onboarding-suggestions";
import type { AgentStepState } from "@/hooks/use-onboarding-agent";

export interface SectionKind { kind: SuggestionKind; label: string; heading?: string }

interface SetupSectionProps {
  title: string;
  kinds: SectionKind[];
  state: AgentStepState;
  agentActive: boolean;
  selected: (kind: SuggestionKind) => string[];
  lookup: (kind: SuggestionKind, name: string) => SuggestedChoice | undefined;
  disabled: (kind: SuggestionKind, name: string) => boolean;
  onToggle: (kind: SuggestionKind, name: string) => void;
  onRetry: () => void;
  /** "Add your own" inputs, plus anything else the section shows under them. */
  children: ReactNode;
}

function Pick({ kind, label, name, choice, selected, disabled, onToggle }: {
  kind: SuggestionKind; label: string; name: string; choice?: SuggestedChoice; selected: boolean; disabled: boolean; onToggle: (kind: SuggestionKind, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const evidence = choice ? evidenceLabel(choice) : undefined;
  const headlines = choice?.evidence?.headlines ?? [];
  return (
    <div className={cn("flex flex-col rounded-lg border bg-card", selected ? "border-primary border-[1.5px]" : "border-border")}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${selected ? "Remove" : "Select"} ${label} ${name}`}
        disabled={disabled}
        onClick={() => onToggle(kind, name)}
        className="flex min-h-11 flex-col items-start gap-0.5 rounded-lg px-3.5 py-2.5 text-left hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex w-full items-start justify-between gap-2">
          <span className="font-medium [overflow-wrap:anywhere]">{name}</span>
          {selected && <span aria-hidden="true" className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-2.5 w-2.5" strokeWidth={3.5} /></span>}
        </span>
        {evidence && <span className={cn("text-xs font-medium", choice?.aiOnly ? "text-muted-foreground" : "text-secondary-text")}>{evidence}</span>}
        {choice?.reason && <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{choice.reason}</span>}
      </button>
      {headlines.length > 0 && (
        <div className="px-3.5 pb-2.5">
          <button type="button" aria-expanded={open} aria-label={`Why ${name}?`} onClick={() => setOpen(value => !value)}
            className="min-h-8 text-xs font-medium text-primary underline-offset-2 hover:underline">{open ? "Hide headlines" : "Why?"}</button>
          {open && (
            <ul aria-label={`Headlines behind ${name}`} className="mt-1 space-y-1.5">
              {headlines.map(headline => <li key={headline} className="border-l-2 border-secondary pl-2 text-xs leading-snug [overflow-wrap:anywhere]">{headline}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** One part of "Your setup": what is selected, what Pundit is finding, other options and your own. */
export function SetupSection({ title, kinds, state, agentActive, selected, lookup, disabled, onToggle, onRetry, children }: Readonly<SetupSectionProps>) {
  const isSelected = (kind: SuggestionKind, name: string) => selected(kind).some(item => item.toLowerCase() === name.toLowerCase());
  const options = (kind: SuggestionKind, items: SuggestedChoice[]) => items.filter(item => item.kind === kind && !isSelected(kind, item.name));
  const total = kinds.reduce((sum, { kind }) => sum + selected(kind).length, 0);
  const running = state.status === "running";
  const extras = kinds.flatMap(({ kind }) => options(kind, state.items));
  const aiPeople = [...state.items, ...state.batches.flatMap(batch => batch.items)].some(item => item.aiOnly);
  const grid = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        <span className={cn("text-sm", running ? "text-secondary-text" : "text-muted-foreground")}>
          {running ? (state.feed.at(-1) ?? "Pundit is working on this…") : `${total} selected`}
        </span>
      </div>

      {state.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span>{state.error ?? "The agent couldn't finish this step."} Add your own below or try again.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
        </div>
      )}

      {kinds.map(({ kind, label, heading }) => selected(kind).length > 0 && (
        <div key={kind} className="space-y-2">
          {heading && <p className="text-xs text-muted-foreground">{heading}</p>}
          <div className={grid}>
            {selected(kind).map(name => <Pick key={name} kind={kind} label={label} name={name} choice={lookup(kind, name)} selected disabled={disabled(kind, name)} onToggle={onToggle} />)}
          </div>
        </div>
      ))}

      {running && !total && (
        <div aria-hidden="true" className={grid}>
          {[0, 1, 2].map(index => <div key={index} className="h-20 animate-pulse rounded-lg bg-muted" />)}
        </div>
      )}

      {(extras.length > 0 || state.batches.length > 0 || state.refreshing) && (
        <div className="space-y-3">
          {extras.length > 0 && <p className="text-sm font-medium text-muted-foreground">More options from Pundit</p>}
          {kinds.map(({ kind, label }) => options(kind, state.items).length > 0 && (
            <div key={kind} className={grid}>
              {options(kind, state.items).map(item => <Pick key={item.name} kind={kind} label={label} name={item.name} choice={item} selected={false} disabled={disabled(kind, item.name)} onToggle={onToggle} />)}
            </div>
          ))}
          {state.batches.map(batch => {
            const fresh = kinds.flatMap(({ kind, label }) => options(kind, batch.items).map(item => ({ kind, label, item })));
            if (!fresh.length) return null;
            return (
              <div key={batch.id} className="space-y-2">
                <p className="flex items-center gap-1 text-sm font-medium"><Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  {`${batch.items.length} new suggestion${batch.items.length === 1 ? "" : "s"} based on your picks`}</p>
                <div className={grid}>
                  {fresh.map(({ kind, label, item }) => <Pick key={`${kind}-${item.name}`} kind={kind} label={label} name={item.name} choice={item} selected={false} disabled={disabled(kind, item.name)} onToggle={onToggle} />)}
                </div>
              </div>
            );
          })}
          {state.refreshing && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 shrink-0 animate-pulse" />Finding more based on your picks…</p>}
        </div>
      )}
      {aiPeople && <p className="text-xs text-muted-foreground">People marked “AI suggestion” come from the AI's general knowledge, not recent news.</p>}
      {!agentActive && !total && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
      {children}
    </section>
  );
}
