import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlarmClock, Archive, ArrowLeft, CalendarClock, Clock, ExternalLink, Inbox, Mail, RefreshCw, Reply, Star, TrendingUp, X } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InlineCompose, useComposer, type Compose } from "@/components/inbox/composer";
import { PostFolderView } from "@/components/inbox/post-folder-view";
import { NewsSearchView } from "@/components/inbox/news-search-view";
import { IdeasView } from "@/components/inbox/ideas-view";
import { DismissReasonDialog, ToastActions } from "@/components/inbox/dismiss-reason-dialog";
import { CalibrationDialog } from "@/components/inbox/calibration-dialog";
import type { ComposeSource } from "@/lib/linkedin-compose";
import { useInboxShell } from "@/components/inbox/inbox-shell";
import { refreshJobMessage, useInboxRefreshJob } from "@/hooks/use-inbox-refresh-job";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { articleDateLabel } from "@/lib/article-date-label";
import { relevanceSummary } from "@/lib/relevance-summary";
import { ignoreInboxShortcut } from "@/lib/inbox-shortcuts";
import { storeCalibration, useCalibration, useDensity, useReadingPane } from "@/lib/inbox-feedback";
import { INBOX_LIST_KEYS, inboxStatusKey, inboxStatusQuery, recordVisitQuery, SNOOZED_KEY, snoozedQuery, type InboxRow, type InboxStatus } from "@/lib/inbox-queries";
import { cn } from "@/lib/utils";
import { DEFAULT_DISCOVER_FILTERS, filterDiscoverRows, isNew, sortDiscoverRows } from "@shared/discover";
import {
  FOLDER_STATUS, inboxHref, inboxTimeLabel, isPostFolder, isStoryFolder, matchesLabel, parseInboxLocation, selectionAfterRemoval, snoozeLabel, snoozePresets, topPicks,
  type InboxTab, type StoryFolder,
} from "@shared/inbox-view";
import type { PersonalTrend } from "@shared/article-quality";

const FOLDER_TITLES: Record<StoryFolder, { title: string; note: string }> = {
  inbox: { title: "For you", note: "" },
  shortlist: { title: "Shortlist", note: "Stories you saved to write about. Move one back to For you when you want it in your feed." },
  snoozed: { title: "Snoozed", note: "Snoozed stories return to For you at the time you chose. Unsnooze one to bring it back now." },
  dismissed: { title: "Not relevant", note: "Hidden from For you. Move a story back if you change your mind." },
};
const MOVE_LABEL: Record<InboxStatus, string> = { saved: "Saved to Shortlist", dismissed: "Marked not relevant", active: "Moved to For you" };
const TABS: Array<{ id: InboxTab; label: string }> = [{ id: "top", label: "Top picks" }, { id: "stories", label: "Stories" }, { id: "signals", label: "Signals" }];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase()).join("") || "?";
const sourceOf = (row: InboxRow): ComposeSource => ({ id: row.id, headline: row.headline, source: row.source, articleUrl: row.articleUrl });
const snoozedUntil = (row: InboxRow) => row.snoozedUntil ? new Date(row.snoozedUntil) : null;
/** An ended snooze keeps its past time on the server; only a time the server would accept again can be restored. */
const restorableSnooze = (row: InboxRow) => {
  const until = snoozedUntil(row);
  return until && until.getTime() > Date.now() + 60_000 ? until : null;
};
const SNOOZE_MAX_DAYS = 90;
// Gmail-style row tools appear for a real mouse or keyboard focus only: on touch screens they would cover
// the row, so a tap would hit an action instead of opening the story. Actions stay in the reading pane.
const ROW_TOOLS_SHOW = "sm:[@media(hover:hover)]:group-hover:flex group-has-[:focus-visible]:flex has-[[data-state=open]]:flex";
const ROW_TOOLS_COVER = "sm:[@media(hover:hover)]:group-hover:invisible group-has-[:focus-visible]:invisible";
type SnoozeTarget = { id: string; until: Date | null };

function velocityLabel(trend: PersonalTrend) {
  if (trend.velocityPercent === null) return "New this week";
  if (trend.velocityPercent === 0) return "Same as last week";
  return `${trend.velocityPercent > 0 ? "+" : "−"}${Math.abs(trend.velocityPercent)}% vs last week`;
}

/** Gmail-style Inbox: story folders with a reading pane, and your own posts in Drafts / Scheduled / Posted / Outbox. */
export default function InboxPage() {
  const { folder, tab, label, news, saved } = parseInboxLocation(useSearch());
  if (news) return <NewsSearchView key={`${news}\u0000${saved ?? ""}`} query={news} savedId={saved} />;
  if (folder === "ideas") return <IdeasView />;
  if (isPostFolder(folder)) return <PostFolderView folder={folder} />;
  return isStoryFolder(folder) ? <StoryFolderView folder={folder} tab={tab} label={label} /> : null;
}

function StoryFolderView({ folder, tab, label }: Readonly<{ folder: StoryFolder; tab: InboxTab; label: string | null }>) {
  const signedIn = Boolean(useIsSignedIn());
  const [, navigate] = useLocation();
  const { query } = useInboxShell();
  const composer = useComposer();
  const { toast } = useToast();
  const status = FOLDER_STATUS[folder];
  const showSignals = folder === "inbox" && tab === "signals";
  const snoozedFolder = folder === "snoozed";
  const canSnooze = status === "active";

  const statusList = useQuery(inboxStatusQuery(status, signedIn && !snoozedFolder));
  const snoozedList = useQuery(snoozedQuery(signedIn && snoozedFolder));
  const list = snoozedFolder ? snoozedList : statusList;
  const listKey = useMemo(() => snoozedFolder ? SNOOZED_KEY : inboxStatusKey(status), [snoozedFolder, status]);
  const visit = useQuery(recordVisitQuery(signedIn));
  const trends = useQuery<PersonalTrend[]>({ queryKey: ["/api/trends"], enabled: signedIn && showSignals });
  const refresh = useInboxRefreshJob();
  const newSince = visit.data ? visit.data.previousVisitAt ?? visit.data.currentVisitAt : null;

  const [locallyRead, setLocallyRead] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const [whyFor, setWhyFor] = useState<InboxRow | null>(null);
  const [tuning, setTuning] = useState(false);
  const busy = useRef(false);
  const compact = useDensity() === "compact";
  const split = useReadingPane() === "right";
  const calibration = useCalibration();

  useEffect(() => { setChecked(new Set()); setReadingOpen(false); }, [folder, tab, label]);

  const rows = useMemo(() => {
    const inFolder = (list.data ?? []).filter(item => item.status === status);
    const matching = filterDiscoverRows(inFolder, { ...DEFAULT_DISCOVER_FILTERS, search: query }, { locallyRead }).filter(row => matchesLabel(row, label));
    if (snoozedFolder) return [...matching].sort((a, b) => (snoozedUntil(a)?.getTime() ?? 0) - (snoozedUntil(b)?.getTime() ?? 0));
    return folder === "inbox" && tab === "top" && !query.trim() && !label ? topPicks(matching) : sortDiscoverRows(matching, "added");
  }, [list.data, status, query, locallyRead, label, folder, tab, snoozedFolder]);
  const signals = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (trends.data ?? []).filter(trend => !needle || trend.topic.toLocaleLowerCase().includes(needle));
  }, [trends.data, query]);
  const newCount = useMemo(() => (list.data ?? []).filter(item => item.status === "active" && isNew(item, newSince, locallyRead)).length, [list.data, newSince, locallyRead]);

  const selected = rows.find(row => row.id === selectedId) ?? null;
  const selectedSignal = signals.find(trend => trend.topic === selectedTopic) ?? null;
  // Desktop shows the first item without marking it read; only an explicit open does that.
  useEffect(() => { if (!showSignals && !selected && rows.length) setSelectedId(rows[0].id); }, [showSignals, selected, rows]);
  useEffect(() => { if (showSignals && !selectedSignal && signals.length) setSelectedTopic(signals[0].topic); }, [showSignals, selectedSignal, signals]);

  const markRead = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/inbox/${id}/read`)).json() as Promise<{ id: string; readAt: string }>,
    onSuccess: ({ id, readAt }) => {
      const stamp = (current?: InboxRow[]) => current?.map(item => item.id === id && !item.readAt ? { ...item, readAt: readAt as unknown as Date } : item);
      for (const key of [["/api/inbox"], ...INBOX_LIST_KEYS]) queryClient.setQueryData<InboxRow[]>(key, stamp);
    },
  });

  const markUnread = useCallback(async (ids: string[]) => {
    if (busy.current || !ids.length) return;
    busy.current = true;
    const done = new Set<string>();
    let failure: string | null = null;
    try {
      for (const id of ids) {
        try { await apiRequest("DELETE", `/api/inbox/${id}/read`); done.add(id); }
        catch (error) { failure = error instanceof Error ? error.message : "The story could not be marked unread."; break; }
      }
      if (done.size) {
        setLocallyRead(current => new Set([...current].filter(id => !done.has(id))));
        const clear = (current?: InboxRow[]) => current?.map(item => done.has(item.id) ? { ...item, readAt: null } : item);
        for (const key of [["/api/inbox"], ...INBOX_LIST_KEYS]) queryClient.setQueryData<InboxRow[]>(key, clear);
        setChecked(new Set());
        setReadingOpen(false);
      }
      if (failure) toast({ title: done.size ? `Marked ${done.size} of ${ids.length} unread` : "Couldn't mark as unread", description: failure, variant: "destructive" });
      else toast({ title: done.size > 1 ? `Marked ${done.size} stories as unread` : "Marked as unread" });
    } finally { busy.current = false; }
  }, [toast]);

  /** Snooze or unsnooze; Undo restores each story's previous snooze time. */
  const setSnooze = useCallback(async (targets: SnoozeTarget[], undoable = true) => {
    if (busy.current || !targets.length) return;
    busy.current = true;
    const order = rows.map(row => row.id);
    const before = new Map((list.data ?? []).map(row => [row.id, restorableSnooze(row)]));
    const done: SnoozeTarget[] = [];
    let failure: string | null = null;
    try {
      for (const target of targets) {
        try {
          if (target.until) await apiRequest("POST", `/api/inbox/${target.id}/snooze`, { until: target.until.toISOString() });
          else await apiRequest("DELETE", `/api/inbox/${target.id}/snooze`);
          done.push(target);
        } catch (error) { failure = error instanceof Error ? error.message : "The story could not be snoozed."; break; }
      }
      if (done.length) {
        // Snoozing leaves For you; unsnoozing leaves Snoozed. Changing a snooze time keeps it in place.
        const removed = new Set(done.filter(target => snoozedFolder ? !target.until : Boolean(target.until)).map(target => target.id));
        if (removed.size) {
          queryClient.setQueryData<InboxRow[]>(listKey, current => current?.filter(item => !removed.has(item.id)));
          setSelectedId(current => selectionAfterRemoval(order, removed, current));
          setChecked(current => new Set([...current].filter(id => !removed.has(id))));
          setReadingOpen(false);
        }
        void queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      }
      const snoozing = done.find(target => target.until)?.until;
      const undo = undoable && done.length ? { action: <ToastAction altText="Undo" onClick={() => void setSnooze(done.map(target => ({ id: target.id, until: before.get(target.id) ?? null })), false)}>Undo</ToastAction> } : {};
      const title = snoozing ? `Snoozed until ${snoozeLabel(snoozing)}` : "Moved to For you";
      if (failure) toast({ title: done.length ? `Updated ${done.length} of ${targets.length}` : "Couldn't snooze the story", description: failure, variant: "destructive", ...undo });
      else if (done.length) toast({ title: done.length > 1 ? `${title}: ${done.length} stories` : title, ...undo });
    } finally { busy.current = false; }
  }, [rows, list.data, snoozedFolder, listKey, toast]);
  const snooze = useCallback((ids: string[], until: Date) => void setSnooze(ids.map(id => ({ id, until }))), [setSnooze]);
  const unsnooze = useCallback((ids: string[]) => void setSnooze(ids.map(id => ({ id, until: null }))), [setSnooze]);

  const open = useCallback((row: InboxRow) => {
    setSelectedId(row.id);
    setReadingOpen(true);
    if (!row.readAt && !locallyRead.has(row.id)) {
      setLocallyRead(current => new Set(current).add(row.id));
      markRead.mutate(row.id);
    }
  }, [locallyRead, markRead]);

  /** `resnooze` restores snoozes that a move out of Snoozed cleared (the server clears a snooze on any status change). */
  const triage = useCallback(async (ids: string[], to: InboxStatus, undoable = true, resnooze?: ReadonlyMap<string, Date>) => {
    if (busy.current || !ids.length) return;
    busy.current = true;
    const from = status;
    const order = rows.map(row => row.id);
    const snoozes = new Map<string, Date>();
    if (snoozedFolder) for (const row of list.data ?? []) { const until = restorableSnooze(row); if (until) snoozes.set(row.id, until); }
    const done: string[] = [];
    let failure: string | null = null;
    try {
      for (const id of ids) {
        try { await apiRequest("PATCH", `/api/inbox/${id}`, { status: to }); done.push(id); }
        catch (error) { failure = error instanceof Error ? error.message : "The story could not be moved."; break; }
        const until = resnooze?.get(id);
        if (until && until.getTime() > Date.now() + 60_000) {
          try { await apiRequest("POST", `/api/inbox/${id}/snooze`, { until: until.toISOString() }); }
          catch (error) { failure = `Moved back, but the snooze could not be restored. ${error instanceof Error ? error.message : ""}`.trim(); break; }
        }
      }
      if (done.length) {
        const removed = new Set(done);
        queryClient.setQueryData<InboxRow[]>(listKey, current => current?.filter(item => !removed.has(item.id)));
        void queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
        setSelectedId(current => selectionAfterRemoval(order, removed, current));
        setChecked(current => new Set([...current].filter(id => !removed.has(id))));
        setReadingOpen(false);
      }
      const undoMove = () => void triage(done, from, false, snoozes);
      // A single story marked Not relevant can say why; bulk moves never ask.
      const asked = to === "dismissed" && undoable && ids.length === 1 && done.length === 1 && !failure ? (list.data ?? []).find(row => row.id === done[0]) : undefined;
      const undo = undoable && done.length ? { action: asked
        ? <ToastActions onClick={undoMove} extra={{ label: "Why?", altText: "Tell us why this is not relevant", onClick: () => setWhyFor(asked) }} />
        : <ToastAction altText="Undo" onClick={undoMove}>Undo</ToastAction> } : {};
      // One toast only (the toaster shows one at a time): a partial failure must keep Undo for what moved.
      if (failure) toast({ title: done.length ? `Moved ${done.length} of ${ids.length}` : "Couldn't move the story", description: failure, variant: "destructive", ...undo });
      else if (done.length) toast({ title: done.length > 1 ? `${MOVE_LABEL[to]}: ${done.length} stories` : MOVE_LABEL[to], ...undo });
    } finally { busy.current = false; }
  }, [rows, status, listKey, toast, snoozedFolder, list.data]);

  const draft = useCallback((row: InboxRow) => { open(row); composer.openForStory(sourceOf(row), true); }, [open, composer]);
  const shortlistTarget: InboxStatus = status === "saved" ? "active" : "saved";

  // Deferred until the row renders; yields if focus has meanwhile moved out of the list (e.g. into the composer).
  const focusRow = (id: string) => requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("[data-inbox-list]")) return;
    document.querySelector<HTMLElement>(`[data-testid="row-inbox-${CSS.escape(id)}"]`)?.focus();
  });
  useEffect(() => {
    if (showSignals) return;
    const onKey = (event: KeyboardEvent) => {
      if (ignoreInboxShortcut(event)) return;
      const index = rows.findIndex(row => row.id === selectedId);
      const current = index >= 0 ? rows[index] : null;
      const step = (delta: number) => {
        const next = rows[Math.max(0, Math.min(rows.length - 1, (index < 0 ? -1 : index) + delta))];
        if (next) { open(next); focusRow(next.id); }
      };
      const actions: Record<string, () => void> = {
        j: () => step(1), k: () => step(-1),
        o: () => { if (current) open(current); },
        r: () => { if (current) draft(current); },
        s: () => { if (current) void triage([current.id], shortlistTarget); },
        e: () => { if (current && status !== "dismissed") void triage([current.id], "dismissed"); },
        b: () => { if (current && canSnooze) { setReadingOpen(true); setSnoozeMenuOpen(true); } },
        U: () => { if (current && (current.readAt || locallyRead.has(current.id))) void markUnread([current.id]); },
        x: () => { if (current) setChecked(previous => { const next = new Set(previous); if (next.has(current.id)) next.delete(current.id); else next.add(current.id); return next; }); },
        u: () => setReadingOpen(false),
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSignals, rows, selectedId, open, draft, triage, shortlistTarget, status, canSnooze, markUnread, locallyRead]);

  const checkedIds = rows.filter(row => checked.has(row.id)).map(row => row.id);
  const allChecked = rows.length > 0 && checkedIds.length === rows.length;
  const loading = showSignals ? trends.isLoading : list.isLoading;
  const failed = showSignals ? trends.isError : list.isError;
  const refreshing = refresh.isLoading;
  const refreshMessage = refresh.status !== "idle" ? refreshJobMessage(refresh) : "";
  const count = showSignals ? signals.length : rows.length;
  const activeCount = folder === "inbox" ? (list.data ?? []).filter(item => item.status === "active").length : 0;
  const offerTuning = folder === "inbox" && !showSignals && calibration === "none" && activeCount >= 5;

  return (
    <main className="flex h-full min-h-0" aria-label={FOLDER_TITLES[folder].title}>
      <section aria-label={`${FOLDER_TITLES[folder].title} list`} data-inbox-list className={cn("min-h-0 min-w-0 flex-col", split && "border-r lg:flex lg:w-[min(46%,36rem)] lg:shrink-0", readingOpen ? "hidden" : "flex w-full")}>
        <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2" aria-label="List actions">
          {!showSignals && <span className="flex h-10 w-10 items-center justify-center">
            <Checkbox aria-label="Select all" checked={allChecked ? true : checkedIds.length ? "indeterminate" : false} disabled={!rows.length}
              onCheckedChange={value => setChecked(value === true ? new Set(rows.map(row => row.id)) : new Set())} />
          </span>}
          {checkedIds.length ? <>
            {status !== "saved" && <Button variant="ghost" size="icon" aria-label="Save selected to Shortlist" onClick={() => void triage(checkedIds, "saved")}><Star className="h-4 w-4" aria-hidden="true" /></Button>}
            {status !== "dismissed" && <Button variant="ghost" size="icon" aria-label="Mark selected not relevant" onClick={() => void triage(checkedIds, "dismissed")}><Archive className="h-4 w-4" aria-hidden="true" /></Button>}
            {status !== "active" && <Button variant="ghost" size="icon" aria-label="Move selected to For you" onClick={() => void triage(checkedIds, "active")}><Inbox className="h-4 w-4" aria-hidden="true" /></Button>}
            {canSnooze && <SnoozeMenu label="Snooze selected" onSnooze={until => snooze(checkedIds, until)}>
              <Button variant="ghost" size="icon" aria-label="Snooze selected"><Clock className="h-4 w-4" aria-hidden="true" /></Button>
            </SnoozeMenu>}
            {snoozedFolder && <Button variant="ghost" size="icon" aria-label="Unsnooze selected" onClick={() => unsnooze(checkedIds)}><AlarmClock className="h-4 w-4" aria-hidden="true" /></Button>}
            <Button variant="ghost" size="icon" aria-label="Mark selected as unread" onClick={() => void markUnread(checkedIds)}><Mail className="h-4 w-4" aria-hidden="true" /></Button>
            <span className="ml-1 text-xs text-muted-foreground">{checkedIds.length} selected</span>
          </> : folder === "inbox" && <Button variant="ghost" size="icon" aria-label={refreshing ? "Finding new stories" : "Find new stories"} title="Find new stories"
              onClick={() => void refresh.startRefresh()} disabled={refreshing || refresh.status === "unavailable"} data-testid="button-refresh-inbox">
              <RefreshCw className={cn("h-4 w-4", refreshing && "motion-safe:animate-spin")} aria-hidden="true" />
            </Button>}
          {label && <span className="ml-1 inline-flex h-7 max-w-[12rem] items-center gap-1 rounded-md bg-muted pl-2 pr-1 text-xs">
            <span className="truncate">Label: {label}</span>
            <button type="button" className="rounded p-0.5 hover:bg-background" aria-label="Clear label filter" onClick={() => navigate(inboxHref({ folder, tab }))}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </span>}
          <span className="ml-auto pr-2 text-xs tabular-nums text-muted-foreground" aria-live="polite">{loading ? "Loading…" : count ? `1–${count} of ${count}` : "0"}</span>
        </div>
        {refreshMessage && <p role="status" className="shrink-0 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">{refreshMessage}</p>}
        {folder === "inbox" ? (
          <div role="tablist" aria-label="Inbox categories" className="flex shrink-0 border-b">
            {TABS.map(entry => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => navigate(inboxHref({ folder, tab: entry.id, label }))}
              className={cn("flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap border-b-2 px-2 text-sm font-medium transition-colors hover:bg-muted", tab === entry.id ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
              data-testid={`tab-inbox-${entry.id}`}>
              {entry.label}
              {entry.id === "stories" && newCount > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{newCount} new</span>}
            </button>)}
          </div>
        ) : <p className="shrink-0 border-b px-4 py-2.5 text-xs text-muted-foreground">{FOLDER_TITLES[folder].note}</p>}
        {offerTuning && <div role="region" aria-label="Tune your feed" className="flex shrink-0 items-center gap-2 border-b bg-primary/5 py-2 pl-4 pr-2 text-sm" data-testid="banner-tune-feed">
          <p className="min-w-0 flex-1">Tune your feed in 30 seconds. Rate a few stories and we’ll show more of what fits.</p>
          <Button size="sm" onClick={() => setTuning(true)} data-testid="button-start-tuning">Start</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Dismiss Tune your feed" onClick={() => storeCalibration("dismissed")}><X className="h-4 w-4" aria-hidden="true" /></Button>
        </div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? <div className="space-y-px" aria-label="Loading">{[0, 1, 2, 3].map(index => <div key={index} className="space-y-2 border-b p-4"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-2/3" /></div>)}</div>
            : failed ? <div role="alert" className="p-6 text-sm"><p className="font-medium">This list could not be loaded.</p><Button variant="outline" className="mt-3" onClick={() => void (showSignals ? trends.refetch() : list.refetch())}>Try again</Button></div>
            : showSignals ? (signals.length ? <ul aria-label="Signals">{signals.map(trend => {
                const isSelected = trend.topic === selectedSignal?.topic;
                return <li key={trend.topic} className={cn("border-b", isSelected && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                  <button type="button" className="block w-full px-4 py-3 text-left hover:bg-muted/60" aria-current={isSelected ? "true" : undefined} onClick={() => { setSelectedTopic(trend.topic); setReadingOpen(true); }} data-testid={`row-signal-${trend.topic}`}>
                    <span className="flex items-baseline gap-2"><span className="flex-1 truncate text-sm text-muted-foreground">Your sources</span><span className="text-xs text-muted-foreground">7 days</span></span>
                    <span className="block truncate text-sm font-semibold">{trend.topic}</span>
                    <span className="block truncate text-xs text-muted-foreground">{trend.count} articles · {velocityLabel(trend)} · {trend.sourceCount} known sources</span>
                  </button>
                </li>;
              })}</ul> : <EmptyList title="No signals yet" body="Signals appear when at least two newly discovered articles share a topic this week." />)
            : rows.length ? <ul aria-label="Stories" data-density={compact ? "compact" : "comfortable"}>{rows.map(row => {
                const unread = !row.readAt && !locallyRead.has(row.id);
                const isSelected = row.id === selected?.id;
                const snippet = relevanceSummary(row) ?? row.summary ?? "";
                const returns = snoozedFolder ? snoozedUntil(row) : null;
                return <li key={row.id} className={cn("group relative grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-1 border-b pl-1 pr-3 transition-shadow", compact ? "py-1" : "py-2.5", "hover:z-[1] hover:shadow-sm", unread ? "bg-card" : "bg-muted/30", isSelected && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                  <span className="flex h-8 w-9 items-center justify-center"><Checkbox aria-label={`Select ${row.headline}`} checked={checked.has(row.id)} onCheckedChange={value => setChecked(current => { const next = new Set(current); if (value === true) next.add(row.id); else next.delete(row.id); return next; })} /></span>
                  <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-pressed={status === "saved"}
                    aria-label={status === "saved" ? `Move ${row.headline} back to For you` : `Save ${row.headline} to Shortlist`} onClick={() => void triage([row.id], shortlistTarget)}>
                    <Star className={cn("h-4 w-4", status === "saved" && "fill-warning text-warning")} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => open(row)} aria-current={isSelected ? "true" : undefined} className="min-w-0 rounded-md px-1 py-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" data-testid={`row-inbox-${row.id}`}>
                    <span className="flex items-baseline gap-2">
                      <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold text-foreground" : "text-muted-foreground")}>{row.source}</span>
                      {isNew(row, newSince, locallyRead) && <span className="rounded bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">New</span>}
                      {returns
                        ? <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-warning", ROW_TOOLS_COVER)}><Clock className="h-3 w-3" aria-hidden="true" />{snoozeLabel(returns)}</span>
                        : <span className={cn("whitespace-nowrap text-xs tabular-nums", ROW_TOOLS_COVER, unread ? "font-semibold text-foreground" : "text-muted-foreground")}>{inboxTimeLabel(row)}</span>}
                    </span>
                    <span className={cn("mt-0.5 block truncate text-sm", unread && "font-semibold")}>{row.headline}</span>
                    {!compact && <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{snippet}</span>
                      {(row.matchedKeywords ?? []).slice(0, 1).map(keyword => <span key={keyword} className="shrink-0 rounded border px-1.5 text-[11px] font-medium">{keyword}</span>)}
                    </span>}
                  </button>
                  <div className={cn("absolute right-2 top-1.5 hidden items-center gap-0.5 rounded-md border bg-card p-0.5 shadow-sm", ROW_TOOLS_SHOW)}>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Draft my take on ${row.headline}`} onClick={() => draft(row)}><Reply className="h-4 w-4" aria-hidden="true" /></Button>
                    {status === "dismissed"
                      ? <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${row.headline} to For you`} onClick={() => void triage([row.id], "active")}><Inbox className="h-4 w-4" aria-hidden="true" /></Button>
                      : <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Mark ${row.headline} not relevant`} onClick={() => void triage([row.id], "dismissed")}><Archive className="h-4 w-4" aria-hidden="true" /></Button>}
                    {!unread && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Mark ${row.headline} as unread`} onClick={() => void markUnread([row.id])}><Mail className="h-4 w-4" aria-hidden="true" /></Button>}
                    {snoozedFolder
                      ? <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Unsnooze ${row.headline}`} onClick={() => unsnooze([row.id])}><AlarmClock className="h-4 w-4" aria-hidden="true" /></Button>
                      : canSnooze && <SnoozeMenu label={`Snooze ${row.headline}`} onSnooze={until => snooze([row.id], until)}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Snooze ${row.headline}`}><Clock className="h-4 w-4" aria-hidden="true" /></Button>
                      </SnoozeMenu>}
                  </div>
                </li>;
              })}</ul>
            : <EmptyList
                title={folder === "inbox" && !query && !label ? "You’re all caught up" : "Nothing here"}
                body={folder === "inbox" && !query && !label ? "Find new stories from your sources, or write from your own idea." : query || label ? "Try another search or label." : FOLDER_TITLES[folder].note}
                actions={folder === "inbox" && !query && !label ? <>
                  <Button onClick={() => void refresh.startRefresh()} disabled={refreshing}>{refreshing ? "Finding stories…" : "Find new stories"}</Button>
                  <Button variant="outline" onClick={() => composer.openBlank()}>Write from your idea</Button>
                </> : undefined} />}
        </div>
      </section>

      <section aria-label="Reading pane" className={cn("min-h-0 min-w-0 flex-1 flex-col", split && "lg:flex", readingOpen ? "flex" : "hidden")}>
        {showSignals ? (selectedSignal ? <SignalPane trend={selectedSignal} split={split} onBack={() => setReadingOpen(false)} onStories={() => navigate(inboxHref({ folder: "inbox", tab: "stories", label: selectedSignal.topic }))}
            onDraft={() => { const links = new Set(selectedSignal.articles.map(article => article.link)); const story = (list.data ?? []).find(item => links.has(item.articleUrl)); if (story) composer.openForStory(sourceOf(story), false); else composer.openBlank(selectedSignal.topic); }} />
          : <EmptyPane />)
          : selected ? <StoryPane row={selected} status={status} split={split} compose={composer.inlineFor(selected.id)} onBack={() => setReadingOpen(false)} onDraft={() => draft(selected)}
              onShortlist={() => void triage([selected.id], shortlistTarget)} onDismiss={() => void triage([selected.id], "dismissed")} onRestore={() => void triage([selected.id], "active")}
              read={Boolean(selected.readAt || locallyRead.has(selected.id))} onMarkUnread={() => void markUnread([selected.id])}
              snooze={canSnooze ? { until: snoozedFolder ? snoozedUntil(selected) : null, menuOpen: snoozeMenuOpen, onMenuOpenChange: setSnoozeMenuOpen,
                onSnooze: until => snooze([selected.id], until), onUnsnooze: () => unsnooze([selected.id]) } : undefined} />
          : <EmptyPane />}
      </section>
      <DismissReasonDialog story={whyFor} onClose={() => setWhyFor(null)} />
      {folder === "inbox" && <CalibrationDialog open={tuning} onOpenChange={setTuning} />}
    </main>
  );
}

function SnoozeMenu({ label, open, onOpenChange, onSnooze, children }: Readonly<{
  label: string; open?: boolean; onOpenChange?: (open: boolean) => void; onSnooze: (until: Date) => void; children: ReactNode;
}>) {
  const [picking, setPicking] = useState(false);
  const now = new Date();
  return <>
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" aria-label={label}>
        <DropdownMenuLabel>Snooze until…</DropdownMenuLabel>
        {snoozePresets(now).map(preset => <DropdownMenuItem key={preset.id} onSelect={() => onSnooze(preset.until)} data-testid={`snooze-${preset.id}`}>
          {preset.label}<span className="ml-auto pl-4 text-xs text-muted-foreground">{snoozeLabel(preset.until, now)}</span>
        </DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setPicking(true)} data-testid="snooze-pick"><CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />Pick date & time…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <SnoozePicker open={picking} onOpenChange={setPicking} onSnooze={until => { setPicking(false); onSnooze(until); }} />
  </>;
}

function SnoozePicker({ open, onOpenChange, onSnooze }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onSnooze: (until: Date) => void }>) {
  const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [value, setValue] = useState(() => local(snoozePresets()[0].until));
  useEffect(() => { if (open) setValue(local(snoozePresets()[0].until)); }, [open]);
  const until = new Date(value);
  const delay = until.getTime() - Date.now();
  const valid = Number.isFinite(delay) && delay > 60_000 && delay <= SNOOZE_MAX_DAYS * 86_400_000;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Snooze until</DialogTitle><DialogDescription>The story leaves For you and comes back at this time ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</DialogDescription></DialogHeader>
        <label className="block text-sm font-medium">Return on
          <input type="datetime-local" value={value} min={local(new Date())} onChange={event => setValue(event.target.value)} className="mt-1 block h-10 w-full rounded-md border px-3" data-testid="input-snooze-until" />
        </label>
        {!valid && <p className="text-xs text-destructive">Choose a time between a minute and {SNOOZE_MAX_DAYS} days from now.</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!valid} onClick={() => onSnooze(until)}>Snooze</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyList({ title, body, actions }: Readonly<{ title: string; body: string; actions?: ReactNode }>) {
  return <div className="flex flex-col items-center px-6 py-14 text-center">
    <h2 className="text-base font-semibold">{title}</h2>
    <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
    {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
  </div>;
}

function EmptyPane() {
  return <div className="m-auto max-w-sm px-6 text-center text-sm text-muted-foreground">
    <p className="font-medium text-foreground">Pick something worth saying</p>
    <p className="mt-1">Open a story to see why it fits you, then draft your take.</p>
    <p className="mt-3"><kbd className="rounded border px-1 font-mono text-xs">j</kbd> / <kbd className="rounded border px-1 font-mono text-xs">k</kbd> move · <kbd className="rounded border px-1 font-mono text-xs">r</kbd> draft · <kbd className="rounded border px-1 font-mono text-xs">?</kbd> shortcuts</p>
  </div>;
}

interface PaneSnooze { until: Date | null; menuOpen: boolean; onMenuOpenChange: (open: boolean) => void; onSnooze: (until: Date) => void; onUnsnooze: () => void }

function StoryPane({ row, status, split, compose, onBack, onDraft, onShortlist, onDismiss, onRestore, read, onMarkUnread, snooze }: Readonly<{
  row: InboxRow; status: InboxStatus; split: boolean; compose?: Compose; onBack: () => void; onDraft: () => void; onShortlist: () => void; onDismiss: () => void; onRestore: () => void;
  read: boolean; onMarkUnread: () => void; snooze?: PaneSnooze;
}>) {
  const why = relevanceSummary(row);
  const keywords = row.matchedKeywords ?? [];
  return <>
    <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2" aria-label="Story actions">
      <Button variant="ghost" size="icon" className={cn(split && "lg:hidden")} aria-label="Back to list" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Button>
      <Button variant="ghost" size="icon" aria-pressed={status === "saved"} aria-label={status === "saved" ? "Move back to For you" : "Save to Shortlist"} onClick={onShortlist}>
        <Star className={cn("h-4 w-4", status === "saved" && "fill-warning text-warning")} aria-hidden="true" />
      </Button>
      {status === "dismissed"
        ? <Button variant="ghost" size="icon" aria-label="Move to For you" onClick={onRestore}><Inbox className="h-4 w-4" aria-hidden="true" /></Button>
        : <Button variant="ghost" size="icon" aria-label="Mark not relevant" onClick={onDismiss}><Archive className="h-4 w-4" aria-hidden="true" /></Button>}
      {snooze && <SnoozeMenu label="Snooze" open={snooze.menuOpen} onOpenChange={snooze.onMenuOpenChange} onSnooze={snooze.onSnooze}>
        <Button variant="ghost" size="icon" aria-label={snooze.until ? "Change snooze time" : "Snooze"} title="Snooze (b)"><Clock className="h-4 w-4" aria-hidden="true" /></Button>
      </SnoozeMenu>}
      {read && <Button variant="ghost" size="icon" aria-label="Mark as unread" title="Mark as unread (Shift+U)" onClick={onMarkUnread}><Mail className="h-4 w-4" aria-hidden="true" /></Button>}
      <a href={row.articleUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" data-testid={`link-article-${row.id}`}>
        Open original<span className="sr-only"> (opens in a new tab)</span><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </div>
    <article className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
      {snooze?.until && <p role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm">
        <Clock className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="flex-1">Snoozed until <span className="font-semibold">{snoozeLabel(snooze.until)}</span>. It returns to For you then.</span>
        <Button size="sm" variant="outline" onClick={snooze.onUnsnooze} data-testid="button-unsnooze">Unsnooze</Button>
      </p>}
      <h2 className="break-words text-xl font-semibold leading-snug" data-testid={`text-headline-${row.id}`}>{row.headline}</h2>
      {keywords.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Labels">{keywords.slice(0, 4).map(keyword => <span key={keyword} className="rounded border px-1.5 text-[11px] font-medium">{keyword}</span>)}</div>}
      <div className="mt-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold" aria-hidden="true">{initials(row.source)}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span className="font-semibold">{row.source}</span><span className="text-xs text-muted-foreground">{articleDateLabel(row)}</span></p>
          {row.summary?.trim() && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{row.summary}</p>}
        </div>
      </div>
      {why && <p className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"><span className="font-medium text-foreground">Why you’re seeing this:</span> {why}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        {!compose && <Button onClick={onDraft} data-testid={`button-generate-${row.id}`}><Reply className="mr-2 h-4 w-4" aria-hidden="true" />Draft my take</Button>}
        {status !== "saved" && <Button variant="outline" onClick={onShortlist}><Star className="mr-2 h-4 w-4" aria-hidden="true" />Save to Shortlist</Button>}
        {status === "dismissed"
          ? <Button variant="outline" onClick={onRestore}><Inbox className="mr-2 h-4 w-4" aria-hidden="true" />Move to For you</Button>
          : <Button variant="outline" onClick={onDismiss}><Archive className="mr-2 h-4 w-4" aria-hidden="true" />Not relevant</Button>}
      </div>
      {compose && <InlineCompose compose={compose} />}
    </article>
  </>;
}

function SignalPane({ trend, split, onBack, onStories, onDraft }: Readonly<{ trend: PersonalTrend; split: boolean; onBack: () => void; onStories: () => void; onDraft: () => void }>) {
  return <>
    <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
      <Button variant="ghost" size="icon" className={cn(split && "lg:hidden")} aria-label="Back to list" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Button>
      <span className="ml-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><TrendingUp className="h-4 w-4" aria-hidden="true" />Signal from your sources</span>
    </div>
    <article className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
      <h2 className="break-words text-xl font-semibold leading-snug">{trend.topic}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{velocityLabel(trend)}</p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
        {([["This week", trend.count], ["Previous week", trend.previousCount], ["Known sources", trend.sourceCount]] as const).map(([name, value]) =>
          <div key={name} className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">{name}</dt><dd className="text-lg font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      {trend.articles.length > 0 && <section className="mt-4" aria-label="Example articles">
        <h3 className="text-sm font-semibold">Example articles</h3>
        <ul className="mt-1">{trend.articles.map(article => <li key={article.link}><a className="flex min-h-9 items-center break-words py-1 text-sm underline" href={article.link} target="_blank" rel="noopener noreferrer">{article.title}<span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>
      </section>}
      <p className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Counted from articles discovered for you in the last 7 days, compared with the previous 7 days{trend.coverage.partial ? " (partial coverage)" : ""}. This is not a LinkedIn trend or engagement measure.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={onDraft}><Reply className="mr-2 h-4 w-4" aria-hidden="true" />Draft a post on this</Button>
        <Button variant="outline" onClick={onStories}>Show matching stories</Button>
      </div>
    </article>
  </>;
}
