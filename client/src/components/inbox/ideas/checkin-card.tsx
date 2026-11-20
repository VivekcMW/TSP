import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useIsSignedIn } from "@/lib/dev-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CHECKIN_KEY, CheckinConflict, checkinQuery, refreshTopicQueries, saveCheckin } from "@/lib/strategy-queries";
import { CHECKIN_FIELDS, CHECKIN_LIMIT, isSkippedCheckin, type CheckinAnswers, type CheckinField } from "@shared/topic-ideas";

const PROMPTS: Record<CheckinField, { label: string; placeholder: string; note: string }> = {
  win: { label: "A win this week", placeholder: "A result, a thank-you, something that worked", note: "Win" },
  lesson: { label: "Something you learned", placeholder: "A mistake, a surprise, a better way", note: "Lesson" },
  question: { label: "A question on your mind", placeholder: "Something you're still figuring out", note: "Question" },
};
const EMPTY: CheckinAnswers = { win: "", lesson: "", question: "" };
const message = (error: unknown) => error instanceof Error && error.message ? error.message : "Try again.";

/**
 * Weekly experience check-in shown above the ideas until this week is answered or skipped. Answers saved in another
 * tab are never overwritten silently: the server returns 409 and the card shows them, with Edit to replace them.
 */
export function CheckinCard() {
  const signedIn = Boolean(useIsSignedIn());
  const { toast } = useToast();
  const id = useId();
  const current = useQuery(checkinQuery(signedIn));
  const [answers, setAnswers] = useState<CheckinAnswers>(EMPTY);
  const [saved, setSaved] = useState<{ answers: CheckinAnswers; notice?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [noted, setNoted] = useState<ReadonlySet<CheckinField>>(new Set());
  const [closed, setClosed] = useState(false);

  const save = useMutation({
    mutationFn: saveCheckin,
    onSuccess: (response, sent) => {
      queryClient.setQueryData(CHECKIN_KEY, response);
      void refreshTopicQueries();
      setEditing(false);
      if (isSkippedCheckin(sent.answers)) { setClosed(true); toast({ title: "Skipped this week", description: "We'll ask again next week." }); }
      else setSaved({ answers: response.checkin?.answers ?? sent.answers });
    },
    onError: error => {
      if (!(error instanceof CheckinConflict)) { toast({ title: "Couldn't save your check-in", description: message(error), variant: "destructive" }); return; }
      queryClient.setQueryData(CHECKIN_KEY, error.current);
      void refreshTopicQueries();
      setEditing(false);
      const theirs = error.current.checkin;
      if (theirs && !isSkippedCheckin(theirs.answers)) setSaved({ answers: theirs.answers, notice: error.message });
      else if (theirs) setClosed(true);
      // A new week started and nothing is saved for it yet: keep what was typed for this week.
      else toast({ title: "A new week has started", description: "Your answers are still here. Save them for this week." });
    },
  });
  const note = useMutation({
    mutationFn: async (field: CheckinField) => { await apiRequest("POST", "/api/notes", { text: `${PROMPTS[field].note}: ${saved?.answers[field] ?? ""}`.slice(0, 1000) }); return field; },
    onSuccess: field => { setNoted(current => new Set([...current, field])); void queryClient.invalidateQueries({ queryKey: ["/api/notes"] }); },
    onError: error => toast({ title: "Couldn't save to Notes", description: message(error), variant: "destructive" }),
  });
  const submit = (value: CheckinAnswers) => current.data && save.mutate({ weekStart: current.data.weekStart, answers: value, replace: editing });

  if (closed || !current.isSuccess) return null;
  if (saved && !editing) {
    const filled = CHECKIN_FIELDS.filter(field => saved.answers[field].trim());
    return (
      <section aria-labelledby={`${id}-done`} className="m-3 rounded-md border bg-card p-4 text-sm" data-testid="card-checkin">
        <h3 id={`${id}-done`} className="flex items-center gap-2 font-semibold"><Check className="h-4 w-4 text-success" aria-hidden="true" />Check-in saved</h3>
        <p className="mt-1 text-xs text-muted-foreground" role={saved.notice ? "status" : undefined} data-testid="text-checkin-notice">
          {saved.notice ?? "Your answers are now in your ideas. You can also keep them in Notes."}
        </p>
        <ul className="mt-3 space-y-2">{filled.map(field => <li key={field} className="flex flex-wrap items-start gap-2 rounded-md border p-2">
          <p className="min-w-0 flex-1 break-words"><span className="font-medium">{PROMPTS[field].label}:</span> {saved.answers[field]}</p>
          {noted.has(field)
            ? <span className="inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" />Saved to Notes</span>
            : <Button size="sm" variant="outline" disabled={note.isPending} onClick={() => note.mutate(field)} data-testid={`button-checkin-note-${field}`}>
                <NotebookPen className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Save to Notes
              </Button>}
        </li>)}</ul>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { setAnswers(saved.answers); setEditing(true); }} data-testid="button-checkin-edit">Edit answers</Button>
          <Button size="sm" variant="ghost" onClick={() => setClosed(true)}>Done</Button>
        </div>
      </section>
    );
  }
  if (current.data.checkin && !editing) return null;

  const anything = CHECKIN_FIELDS.some(field => answers[field].trim());
  return (
    <section aria-labelledby={`${id}-title`} className="m-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm" data-testid="card-checkin">
      <h3 id={`${id}-title`} className="font-semibold">{editing ? "Edit this week's check-in" : "Weekly check-in"}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{editing ? "Saving replaces this week's answers." : "Three quick prompts. Your answers become post ideas. Leave any blank."}</p>
      <div className="mt-3 space-y-3">{CHECKIN_FIELDS.map(field => <div key={field}>
        <label htmlFor={`${id}-${field}`} className="text-xs font-medium">{PROMPTS[field].label}</label>
        <textarea id={`${id}-${field}`} value={answers[field]} maxLength={CHECKIN_LIMIT} rows={2} placeholder={PROMPTS[field].placeholder}
          onChange={event => { const value = event.target.value; setAnswers(current => ({ ...current, [field]: value })); }}
          className="mt-1 w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`input-checkin-${field}`} />
      </div>)}</div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {editing
          ? <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => setEditing(false)}>Cancel</Button>
          : <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => submit(EMPTY)} data-testid="button-checkin-skip">Skip this week</Button>}
        <Button size="sm" disabled={(!anything && !editing) || save.isPending} onClick={() => submit(answers)} data-testid="button-checkin-save">{save.isPending ? "Saving…" : "Save"}</Button>
      </div>
    </section>
  );
}
