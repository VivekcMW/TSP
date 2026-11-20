import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { WATCHLIST_MAX } from "@shared/moments";
import { saveWatchlist, WATCHLIST_KEY, watchlistQuery, type WatchlistView } from "@/lib/moments-queries";

type Term = WatchlistView["terms"][number];
const termKey = (term: Term) => `${term.kind}:${term.term.toLocaleLowerCase()}`;
const GROUPS: Array<{ kind: Term["kind"]; label: string }> = [
  { kind: "company", label: "Companies" }, { kind: "person", label: "People" }, { kind: "topic", label: "Topics" },
];

/** Notification settings row: choose which profile companies, people and topics to watch. Loads only when opened. */
export function WatchlistSettings() {
  const [open, setOpen] = useState(false);
  return <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <p className="text-sm font-medium">Watchlist</p>
      <p id="watchlist-help" className="text-sm text-muted-foreground">New stories that mention what you watch show up as alerts.</p>
    </div>
    <Button type="button" variant="outline" aria-describedby="watchlist-help" onClick={() => setOpen(true)} data-testid="button-open-watchlist">Choose what to watch</Button>
    <WatchlistDialog open={open} onOpenChange={setOpen} />
  </div>;
}

function WatchlistDialog({ open, onOpenChange }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const cache = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useQuery({ ...watchlistQuery(open), refetchOnWindowFocus: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!open) { loaded.current = false; return; }
    if (data && !loaded.current) { loaded.current = true; setSelected(new Set(data.terms.map(termKey))); setError(null); }
  }, [open, data]);
  const save = useMutation({
    mutationFn: () => saveWatchlist((data?.options ?? []).filter(option => selected.has(termKey(option)))),
    onSuccess: saved => {
      cache.setQueryData(WATCHLIST_KEY, saved);
      toast({ title: "Watchlist saved" });
      onOpenChange(false);
    },
    onError: (failure: Error) => setError(failure.message),
  });
  const toggle = (term: Term, checked: boolean) => setSelected(current => {
    const next = new Set(current);
    if (checked) next.add(termKey(term)); else next.delete(termKey(term));
    return next;
  });
  const options = data?.options ?? [];
  const full = selected.size >= WATCHLIST_MAX;

  return <Dialog open={open} onOpenChange={value => { if (!save.isPending) onOpenChange(value); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>What to watch</DialogTitle>
        <DialogDescription>Choose from the companies, people and topics in your profile. Up to {WATCHLIST_MAX}.</DialogDescription>
      </DialogHeader>
      {isLoading ? <output className="text-sm text-muted-foreground">Loading your watchlist…</output>
        : isError || !data ? <div role="alert" className="space-y-2 text-sm">Your watchlist could not be loaded. <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>Retry</Button></div>
        : !options.length ? <p className="text-sm text-muted-foreground">Add companies, people or topics in Content settings first.</p>
        : <div className="grid min-w-0 gap-4">
          {GROUPS.map(group => {
            const terms = options.filter(option => option.kind === group.kind);
            if (!terms.length) return null;
            return <fieldset key={group.kind} className="min-w-0">
              <legend className="mb-1 text-sm font-semibold">{group.label}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {terms.map(term => {
                  const checked = selected.has(termKey(term));
                  return <label key={termKey(term)} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-md px-1 [overflow-wrap:anywhere] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={checked} disabled={!checked && full}
                      onChange={event => toggle(term, event.target.checked)} />
                    <span className="text-sm">{term.term}</span>
                  </label>;
                })}
              </div>
            </fieldset>;
          })}
          <p className="text-xs text-muted-foreground" aria-live="polite">{selected.size} of {WATCHLIST_MAX} chosen.</p>
        </div>}
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
        <Button type="button" onClick={() => save.mutate()} disabled={!data || save.isPending} data-testid="button-save-watchlist">{save.isPending ? "Saving…" : "Save watchlist"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
