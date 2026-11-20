import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLearnedToast } from "@/components/inbox/dismiss-reason-dialog";
import { useToast } from "@/hooks/use-toast";
import { useIsSignedIn } from "@/lib/dev-auth";
import { proposeCalibration, sendCalibration, storeCalibration, type CalibrationProposal, type CalibrationVote } from "@/lib/inbox-feedback";
import { inboxStatusQuery, type InboxRow } from "@/lib/inbox-queries";
import { relevanceSummary } from "@/lib/relevance-summary";
import { topPicks } from "@shared/inbox-view";

export const CALIBRATION_STORIES = 10;
type Choice = { kind: keyof CalibrationProposal; label: string };
const CHOICE_TEXT: Record<keyof CalibrationProposal, (label: string) => string> = {
  moreAbout: label => `More about ${label}`, lessAbout: label => `Less about ${label}`, mute: label => `Mute ${label}?`,
};
const choiceId = (choice: Choice) => `${choice.kind}\u0000${choice.label}`;

/** "Tune your feed": rate up to 10 current stories, review the proposed changes, and nothing changes until Apply. */
export function CalibrationDialog({ open, onOpenChange }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const signedIn = Boolean(useIsSignedIn());
  const active = useQuery(inboxStatusQuery("active", signedIn && open));
  const [stories, setStories] = useState<InboxRow[] | null>(null);
  const [index, setIndex] = useState(0);
  const [votes, setVotes] = useState<Record<string, CalibrationVote>>({});
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const learnedToast = useLearnedToast();

  // A fixed sample for this session: refreshes while rating must not shift the stories.
  useEffect(() => {
    if (!open) { setStories(null); return; }
    if (stories || !active.data) return;
    setStories(topPicks(active.data.filter(row => row.status === "active"), CALIBRATION_STORIES));
    setIndex(0); setVotes({}); setSending(false);
  }, [open, active.data, stories]);

  const total = stories?.length ?? 0;
  const reviewing = Boolean(stories) && index >= total;
  const proposal = useMemo(() => proposeCalibration(stories ?? [], votes), [stories, votes]);
  const choices = useMemo<Choice[]>(() => (["moreAbout", "lessAbout", "mute"] as const).flatMap(kind => proposal[kind].map(label => ({ kind, label }))), [proposal]);
  useEffect(() => { if (reviewing) setChosen(new Set(choices.filter(choice => choice.kind !== "mute").map(choiceId))); }, [reviewing, choices]);
  // Focus a neutral element, never Apply: a repeated Space must not apply changes.
  useEffect(() => { if (open) (reviewing ? summaryRef : cardRef).current?.focus(); }, [open, reviewing, index, stories]);

  const story = stories && !reviewing ? stories[index] : null;
  const vote = (value: CalibrationVote) => {
    if (!story) return;
    setVotes(current => ({ ...current, [story.id]: value }));
    setIndex(current => current + 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!story || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const onControl = Boolean(target.closest("button, input, a, [role='checkbox']"));
    const action: CalibrationVote | null = event.key === "ArrowRight" || event.key === "1" ? "relevant"
      : event.key === "ArrowLeft" || event.key === "2" ? "not_relevant" : event.key === " " && !onControl ? "skip" : null;
    if (!action) return;
    event.preventDefault();
    vote(action);
  };
  const toggle = (choice: Choice, on: boolean) => setChosen(current => {
    const next = new Set(current);
    if (on) next.add(choiceId(choice)); else next.delete(choiceId(choice));
    return next;
  });
  const rated = Object.entries(votes).map(([id, value]) => ({ id, vote: value }));
  const anyRated = rated.some(entry => entry.vote !== "skip");
  const apply = async () => {
    const pick = (kind: keyof CalibrationProposal) => choices.filter(choice => choice.kind === kind && chosen.has(choiceId(choice))).map(choice => choice.label);
    const selected: CalibrationProposal = { moreAbout: pick("moreAbout"), lessAbout: pick("lessAbout"), mute: pick("mute") };
    if (!anyRated) { storeCalibration("done"); onOpenChange(false); return; }
    setSending(true);
    try {
      const result = await sendCalibration(rated, selected);
      storeCalibration("done");
      onOpenChange(false);
      learnedToast(result, "Thanks. Nothing to change yet.");
    } catch (error) {
      toast({ title: "Couldn't tune your feed", description: error instanceof Error && error.message ? error.message : "Try again.", variant: "destructive" });
    } finally { setSending(false); }
  };
  const selectedCount = choices.filter(choice => chosen.has(choiceId(choice))).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onKeyDown={onKeyDown} onOpenAutoFocus={event => { if (cardRef.current) { event.preventDefault(); cardRef.current.focus(); } }} data-testid="dialog-calibration">
        <DialogHeader>
          <DialogTitle>Tune your feed</DialogTitle>
          <DialogDescription>{reviewing ? "Here is what we would change. Nothing changes until you apply." : "Is this story relevant to you? Rate a few to teach your feed."}</DialogDescription>
        </DialogHeader>
        {!stories ? (active.isError
          ? <p role="alert" className="text-sm">Your stories could not be loaded. Close and try again.</p>
          : <p className="text-sm text-muted-foreground">Loading stories…</p>)
          : !total ? <p className="text-sm text-muted-foreground">There are no stories to rate yet. Find new stories first.</p>
          : story ? <>
            <div className="space-y-1">
              <div role="progressbar" aria-label="Stories rated" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index} className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${(index / total) * 100}%` }} />
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">{index + 1} of {total}</p>
            </div>
            <div ref={cardRef} tabIndex={-1} aria-live="polite" className="rounded-md border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="calibration-story">
              <p className="text-xs font-medium text-muted-foreground">{story.source}</p>
              <p className="mt-1 break-words text-base font-semibold leading-snug">{story.headline}</p>
              {(relevanceSummary(story) ?? story.summary) && <p className="mt-2 line-clamp-3 break-words text-sm text-muted-foreground">{relevanceSummary(story) ?? story.summary}</p>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => vote("not_relevant")}>Not relevant</Button>
              <Button variant="ghost" onClick={() => vote("skip")}>Skip</Button>
              <Button onClick={() => vote("relevant")}>Relevant</Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              <kbd className="rounded border px-1 font-mono">←</kbd> or <kbd className="rounded border px-1 font-mono">2</kbd> not relevant · <kbd className="rounded border px-1 font-mono">Space</kbd> skip · <kbd className="rounded border px-1 font-mono">→</kbd> or <kbd className="rounded border px-1 font-mono">1</kbd> relevant
            </p>
          </>
          : <div ref={summaryRef} tabIndex={-1} className="space-y-4 outline-none">
            {choices.length ? <fieldset className="space-y-1">
              <legend className="pb-1 text-sm font-medium">Proposed changes</legend>
              {choices.map(choice => <label key={choiceId(choice)} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted">
                <Checkbox checked={chosen.has(choiceId(choice))} onCheckedChange={value => toggle(choice, value === true)} />
                <span className="min-w-0 break-words">{CHOICE_TEXT[choice.kind](choice.label)}</span>
              </label>)}
            </fieldset> : <p className="text-sm text-muted-foreground">{anyRated ? "Nothing to change yet. Your votes are noted." : "You skipped every story. Nothing changes."}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => void apply()} disabled={sending} data-testid="button-calibration-apply">{sending ? "Applying…" : selectedCount ? "Apply" : "Done"}</Button>
            </DialogFooter>
          </div>}
      </DialogContent>
    </Dialog>
  );
}
