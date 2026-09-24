import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Understanding } from "@/lib/onboarding-suggestions";
import type { UnderstandingStatus } from "@/hooks/use-focus-understanding";

interface UnderstandingCardProps {
  status: UnderstandingStatus;
  understanding: Understanding | null;
  disabled?: boolean;
  onChange: (next: Understanding) => void;
  onAnswer: (question: string, answer: string) => void;
  onRetry: () => void;
}

const FIELDS = [
  { field: "role", label: "Role" }, { field: "industry", label: "Industry" },
  { field: "region", label: "Region" }, { field: "audience", label: "Audience" },
] as const;

/** Step 1: what the agent understood about the user, editable in place. */
export function UnderstandingCard({ status, understanding, disabled, onChange, onAnswer, onRetry }: Readonly<UnderstandingCardProps>) {
  const [newArea, setNewArea] = useState("");
  const [typedAnswer, setTypedAnswer] = useState("");
  const addArea = () => {
    const area = newArea.trim().slice(0, 40);
    if (!understanding || !area || understanding.focusAreas.length >= 5 || understanding.focusAreas.some(existing => existing.toLowerCase() === area.toLowerCase())) return;
    onChange({ ...understanding, focusAreas: [...understanding.focusAreas, area] });
    setNewArea("");
  };

  return (
    <section aria-label="What the agent understood" className="space-y-3 rounded-lg border border-dashed p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 shrink-0 text-primary" />
        {understanding ? "Here's what I understood" : "The agent"}
      </p>
      {status === "idle" && !understanding && (
        <p className="text-sm text-muted-foreground">Write a sentence or two about your work, and I'll tell you what I understood before building your setup.</p>
      )}
      {status === "loading" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 shrink-0 animate-pulse" />{understanding ? "Updating what I understood…" : "Reading your focus…"}
        </p>
      )}
      {status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <span>I couldn't read your focus just now. You can still build your setup.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={disabled}>Try again</Button>
        </div>
      )}
      {understanding && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(({ field, label }) => (
              <label key={field} className="block space-y-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Input
                  aria-label={label}
                  value={understanding[field] ?? ""}
                  maxLength={60}
                  disabled={disabled}
                  placeholder={field === "region" ? "e.g. India" : field === "audience" ? "e.g. agencies and brands" : ""}
                  onChange={event => onChange({ ...understanding, [field]: field === "role" || field === "industry" ? event.target.value : event.target.value || null })}
                />
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Focus areas</p>
            <div className="flex flex-wrap gap-2">
              {understanding.focusAreas.map(area => (
                <span key={area} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm">
                  {area}
                  <button type="button" aria-label={`Remove focus area ${area}`} disabled={disabled} className="rounded-full p-0.5 hover:bg-muted"
                    onClick={() => onChange({ ...understanding, focusAreas: understanding.focusAreas.filter(existing => existing !== area) })}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            {understanding.focusAreas.length < 5 && (
              <div className="flex gap-2">
                <Input aria-label="Add a focus area" value={newArea} maxLength={40} disabled={disabled} placeholder="Add a focus area…"
                  onChange={event => setNewArea(event.target.value)} onKeyDown={event => event.key === "Enter" && addArea()} />
                <Button type="button" variant="outline" onClick={addArea} disabled={disabled || !newArea.trim()}>Add focus area</Button>
              </div>
            )}
          </div>
          {understanding.question && (
            <div className="space-y-2 rounded-md bg-muted/50 p-3">
              <p className="text-sm font-medium">{understanding.question.text}</p>
              <div className="flex flex-wrap gap-2">
                {understanding.question.options.map(option => (
                  <Button key={option} type="button" variant="outline" size="sm" disabled={disabled || status === "loading"}
                    onClick={() => onAnswer(understanding.question!.text, option)}>{option}</Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input aria-label="Or type your answer" value={typedAnswer} maxLength={200} disabled={disabled} placeholder="Or type your answer…"
                  onChange={event => setTypedAnswer(event.target.value)}
                  onKeyDown={event => { if (event.key === "Enter" && typedAnswer.trim()) onAnswer(understanding.question!.text, typedAnswer.trim()); }} />
                <Button type="button" variant="outline" disabled={disabled || !typedAnswer.trim() || status === "loading"}
                  onClick={() => onAnswer(understanding.question!.text, typedAnswer.trim())}>Answer</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
