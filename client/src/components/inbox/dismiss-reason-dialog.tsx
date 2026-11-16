import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { changedSomething, changeFeedPreferences, DISMISS_REASON_OPTIONS, learnedSummary, moveStories, sendDismissFeedback, storiesFrom, undoneToast } from "@/lib/inbox-feedback";
import type { InboxRow } from "@/lib/inbox-queries";
import type { DismissReason, FeedbackResult } from "@shared/schema";

const SHOWN_TOPICS = 5;
const errorText = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

/** Two toast buttons; `onClick` is the primary (Undo) so callers can treat this like a single ToastAction. */
export function ToastActions({ onClick, undoLabel = "Undo", extra }: Readonly<{ onClick: () => void; undoLabel?: string; extra?: { label: string; altText: string; onClick: () => void } }>) {
  return <span className="flex shrink-0 flex-wrap gap-2">
    {extra && <ToastAction altText={extra.altText} onClick={extra.onClick}>{extra.label}</ToastAction>}
    <ToastAction altText={undoLabel} onClick={onClick}>{undoLabel}</ToastAction>
  </span>;
}

/** Toast for what feedback taught: Undo puts the preferences back; a newly muted source offers to move its For you stories. */
export function useLearnedToast() {
  const { toast } = useToast();
  const moveOut = useCallback(async (ids: string[]) => {
    const { moved, error } = await moveStories(ids, "dismissed");
    const undo = moved.length ? { action: <ToastAction altText="Undo" onClick={() => void moveStories(moved, "active").then(back => {
      if (back.error) toast({ title: "Couldn't move every story back", description: back.error, variant: "destructive" });
    })}>Undo</ToastAction> } : {};
    if (error) toast({ title: moved.length ? `Moved ${moved.length} of ${ids.length}` : "Couldn't move the stories", description: error, variant: "destructive", ...undo });
    else toast({ title: `Moved ${moved.length} ${moved.length === 1 ? "story" : "stories"} to Not relevant`, ...undo });
  }, [toast]);

  return useCallback((result: FeedbackResult, fallback: string, feedbackId?: string) => {
    const title = learnedSummary(result.learned) ?? fallback;
    if (!changedSomething(result.undo)) { toast({ title }); return; }
    const others = storiesFrom(result.learned.muted);
    const undo = () => void changeFeedPreferences({ restore: result.undo, ...(feedbackId ? { feedbackId } : {}) })
      .then(({ skipped }) => toast(undoneToast(skipped)))
      .catch(error => toast({ title: "Couldn't undo the change", description: errorText(error, "Try again."), variant: "destructive" }));
    toast({
      title,
      description: others.length ? `${others.length} more ${others.length === 1 ? "story" : "stories"} from ${result.learned.muted.join(", ")} in For you.` : undefined,
      action: <ToastActions onClick={undo} extra={others.length ? { label: "Move them", altText: "Move them to Not relevant", onClick: () => void moveOut(others.map(row => row.id)) } : undefined} />,
    });
  }, [toast, moveOut]);
}

/** Compact "Why?" after a single story is marked Not relevant. Ticked boxes are exactly what the server applies. */
export function DismissReasonDialog({ story, onClose }: Readonly<{ story: InboxRow | null; onClose: () => void }>) {
  const { toast } = useToast();
  const learnedToast = useLearnedToast();
  const [reason, setReason] = useState<DismissReason | null>(null);
  const [mute, setMute] = useState(false);
  const [topics, setTopics] = useState<ReadonlySet<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  const keywords = [...new Set((story?.matchedKeywords ?? []).map(keyword => keyword.trim()).filter(Boolean))].slice(0, SHOWN_TOPICS);
  useEffect(() => { setReason(null); setMute(false); setTopics(new Set()); setSending(false); }, [story?.id]);

  const choose = (next: DismissReason) => {
    setReason(next);
    const prefill = DISMISS_REASON_OPTIONS.find(option => option.id === next)?.prefill ?? null;
    setMute(prefill === "source");
    setTopics(new Set(prefill === "topics" ? keywords : []));
  };
  const toggleTopic = (keyword: string, on: boolean) => setTopics(current => {
    const next = new Set(current);
    if (on) next.add(keyword); else next.delete(keyword);
    return next;
  });
  const send = async () => {
    if (!story || !reason || sending) return;
    setSending(true);
    try {
      const result = await sendDismissFeedback(story.id, { reason, muteSource: mute, lessAbout: keywords.filter(keyword => topics.has(keyword)) });
      onClose();
      learnedToast(result, "Thanks. We noted that.", result.feedbackIds[0]);
    } catch (error) {
      toast({ title: "Couldn't save your feedback", description: errorText(error, "Try again."), variant: "destructive" });
    } finally { setSending(false); }
  };

  return (
    <Dialog open={Boolean(story)} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="dialog-dismiss-reason">
        <DialogHeader>
          <DialogTitle>Why isn’t this relevant?</DialogTitle>
          <DialogDescription className="line-clamp-2 break-words">{story?.headline}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void send(); }}>
          <fieldset className="space-y-1">
            <legend className="sr-only">Reason</legend>
            {DISMISS_REASON_OPTIONS.map(option => <label key={option.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
              <input type="radio" name="dismiss-reason" value={option.id} checked={reason === option.id} onChange={() => choose(option.id)} className="h-4 w-4 accent-primary" />
              {option.label}
            </label>)}
          </fieldset>
          {story && (story.source.trim() || keywords.length > 0) && <fieldset className="space-y-1 border-t pt-3">
            <legend className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">Also</legend>
            {story.source.trim() && <CheckRow checked={mute} onChange={setMute} label={`Mute ${story.source.trim()}`} />}
            {keywords.map(keyword => <CheckRow key={keyword} checked={topics.has(keyword)} onChange={on => toggleTopic(keyword, on)} label={`Less about ${keyword}`} />)}
          </fieldset>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!reason || sending}>{sending ? "Sending…" : "Send"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CheckRow({ checked, onChange, label }: Readonly<{ checked: boolean; onChange: (checked: boolean) => void; label: string }>) {
  return <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted">
    <Checkbox checked={checked} onCheckedChange={value => onChange(value === true)} />
    <span className="min-w-0 break-words">{label}</span>
  </label>;
}
