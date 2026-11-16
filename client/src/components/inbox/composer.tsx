import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, Maximize2, Minimize2, Minus, MoreVertical, Reply, Sparkles, Square, Trash2, Undo2, X, Linkedin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useIsSignedIn } from "@/lib/dev-auth";
import { apiRequest } from "@/lib/queryClient";
import { editorialRequest } from "@/lib/editorial-request";
import type { ReviewResponse } from "@/lib/editorial";
import { invalidatePublishingQueries } from "@/lib/publishing";
import { CREATE_TONES, type CreateTone } from "@/components/dashboard/create-post-state";
import { useAppTourReporter, type TourOutcome } from "@/components/app-tour";
import { LINKEDIN_STATUS_KEY, linkedInPostingState, type LinkedInConnectionStatus } from "@/lib/inbox-queries";
import {
  cancelLinkedInSchedule, approveLinkedInDraft, definitelyNotAdmitted, generationRequest, LINKEDIN_CHARACTER_LIMIT, nextMorning, postingOutcome, publishApprovedDraft, readUndoSeconds,
  saveLinkedInDraft, scheduleLabel, scheduleLinkedInDraft, storeUndoSeconds, toSavedDraft, UNDO_WINDOW_OPTIONS, type ComposeSource, type PostingResultKind, type SavedDraft,
} from "@/lib/linkedin-compose";
import { cn } from "@/lib/utils";
import type { Draft, UserProfile } from "@shared/schema";

export interface Compose {
  key: string;
  source?: ComposeSource;
  angle: string;
  take: string;
  body: string;
  tone: CreateTone;
  draft?: SavedDraft;
  saving: boolean;
  saveError?: string;
  generating: boolean;
  notice?: string;
  previousBody?: string;
  mode: "inline" | "float";
  minimized: boolean;
  maximized: boolean;
  /** One-shot request to focus the text, set only by explicit user actions. */
  focusToken?: number;
}
interface Pending { compose: Compose; left: number }
export type OpenableDraft = Pick<Draft, "id" | "content" | "updatedAt" | "tone">;
interface ComposerValue {
  inlineFor: (sourceId: string) => Compose | undefined;
  openForStory: (source: ComposeSource, inline: boolean) => void;
  openBlank: (angle?: string) => void;
  /** Continue a saved LinkedIn draft; edits stay revision-checked against it. */
  openDraft: (draft: OpenableDraft) => void;
  /** Adds text to the compose you last used if it is on screen, else starts a new one. */
  insertNote: (text: string, into: "body" | "take") => "existing" | "new";
}
const ComposerContext = createContext<ComposerValue | null>(null);
export function useComposer(): ComposerValue {
  const value = useContext(ComposerContext);
  if (!value) throw new Error("useComposer must be used within ComposerProvider");
  return value;
}
const ActionsContext = createContext<ReturnType<typeof useComposerActions> | null>(null);
const MAX_WINDOWS = 2;
const toneKeyFor = (value?: string | null): CreateTone => CREATE_TONES.find(tone => tone.value === value)?.key ?? "thoughtLeader";
const toneValue = (key: CreateTone) => CREATE_TONES.find(tone => tone.key === key)!.value;
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;
const TOUR_OUTCOME: Partial<Record<PostingResultKind, TourOutcome>> = { published: "published", simulated: "simulated", failed: "attention", unknown: "attention" };
const joinText = (current: string, addition: string) => current.trim() ? `${current.replace(/\s+$/, "")}\n\n${addition}` : addition;

function useComposerActions(onConnectLinkedIn: () => void) {
  const signedIn = Boolean(useIsSignedIn());
  const { toast } = useToast();
  const reportTour = useAppTourReporter();
  const tour = useRef(reportTour);
  tour.current = reportTour;
  const lastActive = useRef<string | null>(null);
  const profile = useQuery<UserProfile>({ queryKey: ["/api/profile"], enabled: signedIn });
  const linkedIn = useQuery<LinkedInConnectionStatus>({ queryKey: LINKEDIN_STATUS_KEY, enabled: signedIn, staleTime: 30_000 });
  const ready = linkedInPostingState(linkedIn.data) === "ready";
  const requireReview = profile.data?.requirePublishReview ?? true;
  const [composes, setComposes] = useState<Compose[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(readUndoSeconds);
  const ref = useRef(composes);
  const pendingRef = useRef<{ pending: Pending; timer: ReturnType<typeof setInterval> } | null>(null);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveChains = useRef(new Map<string, Promise<void>>());
  const generations = useRef(new Map<string, AbortController>());

  const commit = useCallback((next: Compose[]) => { ref.current = next; setComposes(next); }, []);
  const get = (key: string) => ref.current.find(compose => compose.key === key);
  const patch = useCallback((key: string, change: Partial<Compose> | ((compose: Compose) => Partial<Compose>)) => {
    commit(ref.current.map(compose => compose.key === key ? { ...compose, ...(typeof change === "function" ? change(compose) : change) } : compose));
  }, [commit]);
  const remove = useCallback((key: string) => {
    clearTimeout(saveTimers.current.get(key));
    generations.current.get(key)?.abort();
    commit(ref.current.filter(compose => compose.key !== key));
  }, [commit]);

  const create = (fields: Partial<Compose> & Pick<Compose, "mode">): Compose => ({
    key: crypto.randomUUID(), angle: "", take: "", body: "", tone: toneKeyFor(profile.data?.defaultTone), saving: false, generating: false, minimized: false, maximized: false, ...fields,
  });
  const addWindow = (compose: Compose) => {
    const floats = ref.current.filter(item => item.mode === "float" && !item.minimized);
    const minimize = floats.length >= MAX_WINDOWS ? floats[0].key : null;
    commit([...ref.current.map(item => item.key === minimize ? { ...item, minimized: true } : item), compose]);
  };

  /** Serialized per compose so a slow save never overwrites a newer one. */
  const saveNow = useCallback(async (key: string): Promise<SavedDraft | undefined> => {
    clearTimeout(saveTimers.current.get(key));
    const run = async () => {
      const compose = get(key);
      if (!compose?.body.trim() || compose.draft?.content === compose.body) return;
      patch(key, { saving: true, saveError: undefined });
      try {
        const draft = await saveLinkedInDraft(compose.draft, compose.body, toneValue(compose.tone), compose.source?.id);
        patch(key, { draft, saving: false });
        tour.current?.("draft-saved", draft.id);
        void invalidatePublishingQueries();
      } catch (error) {
        const conflict = error instanceof Error && /409|changed|revision/i.test(error.message);
        patch(key, { saving: false, saveError: conflict ? "This draft changed elsewhere. Reopen it from Drafts to keep both versions." : message(error, "Couldn't save. Your text is kept here.") });
        throw error;
      }
    };
    const chain = (saveChains.current.get(key) ?? Promise.resolve()).then(run, run);
    saveChains.current.set(key, chain.catch(() => undefined));
    await chain;
    return get(key)?.draft;
  }, [patch]);
  const scheduleSave = useCallback((key: string) => {
    clearTimeout(saveTimers.current.get(key));
    saveTimers.current.set(key, setTimeout(() => { void saveNow(key).catch(() => undefined); }, 1200));
  }, [saveNow]);

  const update = (key: string, change: Partial<Pick<Compose, "angle" | "take" | "body" | "tone">>) => {
    patch(key, change);
    if (change.body !== undefined || change.tone !== undefined) scheduleSave(key);
  };

  const generate = async (key: string) => {
    const compose = get(key);
    if (!compose || compose.generating) return;
    const request = generationRequest({ source: compose.source, angle: compose.angle, take: compose.take, toneKey: compose.tone });
    if ("error" in request) { patch(key, { notice: request.error }); return; }
    const controller = new AbortController();
    generations.current.set(key, controller);
    patch(key, { generating: true, notice: undefined });
    try {
      const data = await editorialRequest<ReviewResponse>(request.endpoint, request.body, { signal: controller.signal });
      const text = (data.posts?.linkedin as Record<string, unknown> | undefined)?.[compose.tone];
      if (typeof text !== "string" || !text.trim()) throw new Error("No LinkedIn post was returned. Try again.");
      patch(key, current => ({ previousBody: current.body.trim() ? current.body : undefined, body: text, notice: "Draft written. Check every claim against the source before posting." }));
      scheduleSave(key);
    } catch (error) {
      if (get(key)) patch(key, { notice: controller.signal.aborted ? "Stopped. Nothing was replaced." : message(error, "Couldn't write a draft. Try again.") });
    } finally {
      generations.current.delete(key);
      if (get(key)) patch(key, { generating: false });
    }
  };

  const send = useCallback(async (compose: Compose) => {
    // Restored composes float: an inline pane may not be on screen, and transient flags are stale.
    const reopen = () => commit([...ref.current, { ...compose, mode: "float", minimized: false, maximized: false, generating: false, saving: false, focusToken: Date.now() }]);
    let approved: SavedDraft;
    try { approved = await approveLinkedInDraft(compose.draft!, requireReview); }
    catch (error) {
      toast({ title: "Not posted", description: `${message(error, "Approval failed.")} Your draft is open again.`, variant: "destructive" });
      reopen(); void invalidatePublishingQueries(); return;
    }
    try {
      const outcome = postingOutcome(await publishApprovedDraft(approved));
      toast({ title: outcome.title, description: outcome.description, variant: outcome.tone === "error" ? "destructive" : undefined });
      const tourOutcome = TOUR_OUTCOME[outcome.kind];
      if (tourOutcome) tour.current?.("publishing-result", approved.id, tourOutcome);
    } catch (error) {
      if (definitelyNotAdmitted(error)) {
        toast({ title: "Not posted", description: `${message(error, "LinkedIn posting was refused.")} Your draft is open again.`, variant: "destructive" });
        reopen();
      } else {
        // Admission may have committed; the scheduler could still deliver it. Never invite a second post.
        toast({ title: "Delivery not confirmed", description: "Check Posted before trying again so the post is not duplicated.", variant: "destructive" });
        tour.current?.("publishing-result", approved.id, "attention");
      }
    } finally { void invalidatePublishingQueries(); }
  }, [commit, requireReview, toast]);
  const finishPending = useCallback((post: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    clearInterval(current.timer);
    pendingRef.current = null;
    setPending(null);
    if (post) void send(current.pending.compose);
    else {
      commit([...ref.current, { ...current.pending.compose, mode: "float", minimized: false, maximized: false, generating: false, saving: false, focusToken: Date.now() }]);
      toast({ title: "Posting cancelled", description: "Nothing was sent. Your draft is open again." });
    }
  }, [commit, send, toast]);
  const finishRef = useRef(finishPending);
  finishRef.current = finishPending;
  useEffect(() => () => { if (pendingRef.current) clearInterval(pendingRef.current.timer); }, []);

  const readyToSend = (key: string): Compose | undefined => {
    const compose = get(key);
    if (!compose) return undefined;
    if (!ready) {
      patch(key, { notice: compose.body.trim() ? "Connect LinkedIn to post. Your draft is saved." : "Connect LinkedIn to post." });
      if (compose.body.trim()) void saveNow(key).catch(() => undefined);
      onConnectLinkedIn();
      return undefined;
    }
    if (compose.generating) { patch(key, { notice: "Wait for Help me write to finish, or stop it first." }); return undefined; }
    if (!compose.body.trim()) { patch(key, { notice: "Write something before posting." }); return undefined; }
    if (compose.body.length > LINKEDIN_CHARACTER_LIMIT) { patch(key, { notice: `Shorten the post to ${LINKEDIN_CHARACTER_LIMIT.toLocaleString()} characters.` }); return undefined; }
    return compose;
  };

  /** One click: save the visible text, then hold it client-side for the undo window. Nothing is sent before it ends. */
  const reserving = useRef(false);
  const post = async (key: string) => {
    if (!readyToSend(key)) return;
    // Reserved synchronously: two Post clicks during a save must never both become pending.
    if (pendingRef.current || reserving.current) { patch(key, { notice: "Another post is waiting to send. Undo it or wait a moment." }); return; }
    reserving.current = true;
    try {
      let draft: SavedDraft | undefined;
      try { draft = await saveNow(key); } catch { return; }
      const compose = get(key);
      if (!compose || !draft || draft.content !== compose.body) { if (compose) patch(key, { notice: "Your latest edit is still saving. Try again in a moment." }); return; }
      remove(key);
      const entry: Pending = { compose: { ...compose, draft }, left: undoSeconds };
      const timer: ReturnType<typeof setInterval> = setInterval(() => {
        const current = pendingRef.current;
        if (!current || current.timer !== timer) { clearInterval(timer); return; }
        const left = current.pending.left - 1;
        if (left <= 0) { finishRef.current(true); return; }
        current.pending = { ...current.pending, left };
        setPending(current.pending);
      }, 1000);
      pendingRef.current = { pending: entry, timer };
      setPending(entry);
    } finally { reserving.current = false; }
  };

  const schedule = async (key: string, at: Date) => {
    if (!readyToSend(key)) return;
    if (at.getTime() <= Date.now() + 60_000) { patch(key, { notice: "Choose a time at least a minute from now." }); return; }
    let draft: SavedDraft | undefined;
    try { draft = await saveNow(key); } catch { return; }
    if (!draft) return;
    try {
      await scheduleLinkedInDraft(draft, at, requireReview);
      remove(key);
      const id = draft.id;
      tour.current?.("publishing-result", id, "scheduled");
      toast({ title: `Scheduled for ${scheduleLabel(at)}`, description: "Nothing posts before then. Change it in Scheduled.",
        action: <ToastAction altText="Undo schedule" onClick={() => { void cancelLinkedInSchedule(id).then(() => {
          toast({ title: "Schedule cancelled", description: "The post is back in Drafts." }); void invalidatePublishingQueries();
        }, error => toast({ title: "Couldn't cancel", description: message(error, "Check Scheduled."), variant: "destructive" })); }}>Undo</ToastAction> });
    } catch (error) { patch(key, { notice: message(error, "Couldn't schedule. Your draft is kept.") }); }
    finally { void invalidatePublishingQueries(); }
  };

  const close = async (key: string) => {
    const compose = get(key);
    if (!compose) return;
    try { await saveNow(key); } catch { return; }
    remove(key);
    if (compose.body.trim()) toast({ title: "Draft saved", description: "Find it in Drafts." });
  };
  const discard = async (key: string) => {
    if (!get(key)) return;
    // Let an in-flight autosave finish first, so the draft it creates is the one deleted.
    clearTimeout(saveTimers.current.get(key));
    await (saveChains.current.get(key) ?? Promise.resolve());
    const id = get(key)?.draft?.id;
    remove(key);
    if (id) {
      try { await apiRequest("DELETE", `/api/drafts/${encodeURIComponent(id)}`); void invalidatePublishingQueries(); }
      catch (error) { toast({ title: "Couldn't delete the saved draft", description: message(error, "It remains in Drafts."), variant: "destructive" }); return; }
    }
    toast({ title: "Draft discarded" });
  };

  const opened = () => tour.current?.("create-opened");
  const onScreen = (compose: Compose) => {
    if (compose.minimized) return false;
    if (compose.mode === "float") return true;
    // An inline compose stays mounted under a hidden reading pane (list view on narrow screens).
    const element = document.querySelector<HTMLElement>(`[data-compose-key="${CSS.escape(compose.key)}"]`);
    if (!element) return false;
    return typeof element.checkVisibility === "function" ? element.checkVisibility() : element.getClientRects().length > 0;
  };
  const value: ComposerValue = {
    inlineFor: sourceId => composes.find(compose => compose.mode === "inline" && compose.source?.id === sourceId),
    openForStory: (source, inline) => {
      opened();
      const existing = ref.current.find(compose => compose.source?.id === source.id);
      if (existing) { patch(existing.key, { mode: inline ? "inline" : existing.mode, minimized: false, focusToken: Date.now() }); return; }
      const compose = create({ source, mode: inline ? "inline" : "float", focusToken: Date.now() });
      if (inline) commit([...ref.current, compose]); else addWindow(compose);
    },
    openBlank: angle => {
      opened();
      const blank = ref.current.find(compose => compose.mode === "float" && !compose.source && !compose.body.trim() && !compose.take.trim());
      if (blank) { patch(blank.key, { minimized: false, focusToken: Date.now(), ...(angle ? { angle } : {}) }); return; }
      addWindow(create({ mode: "float", angle: angle ?? "", focusToken: Date.now() }));
    },
    openDraft: draft => {
      if (pendingRef.current?.pending.compose.draft?.id === draft.id) {
        toast({ title: "This post is about to send", description: "Undo it first if you want to edit it." });
        return;
      }
      opened();
      const existing = ref.current.find(compose => compose.draft?.id === draft.id);
      if (existing) { patch(existing.key, { mode: "float", minimized: false, focusToken: Date.now() }); return; }
      addWindow(create({ mode: "float", body: draft.content, draft: toSavedDraft(draft), tone: toneKeyFor(draft.tone), focusToken: Date.now() }));
    },
    insertNote: (text, into) => {
      const last = ref.current.find(compose => compose.key === lastActive.current);
      const target = last && onScreen(last) ? last : [...ref.current].reverse().find(compose => compose.mode === "float" && !compose.minimized);
      if (!target) {
        opened();
        const compose = create({ mode: "float", focusToken: Date.now(), ...(into === "take" ? { take: text.slice(0, 2000) } : { body: text }) });
        addWindow(compose);
        if (into === "body") scheduleSave(compose.key);
        return "new";
      }
      if (into === "take") update(target.key, { take: joinText(target.take, text).slice(0, 2000) });
      else update(target.key, { body: joinText(target.body, text) });
      patch(target.key, { focusToken: Date.now() });
      return "existing";
    },
  };
  return { value, composes, pending, undoSeconds, ready, update, generate, post, schedule, close, discard, patch, finishPending,
    touch: (key: string) => { lastActive.current = key; },
    setUndoSeconds: (seconds: number) => { storeUndoSeconds(seconds); setUndoSeconds(seconds); },
    stop: (key: string) => generations.current.get(key)?.abort() };
}

/** Gmail-style compose windows and inline replies, with one-click LinkedIn posting behind an undo window. */
export function ComposerProvider({ children, onConnectLinkedIn, sidePanelOpen = false }: Readonly<{ children: ReactNode; onConnectLinkedIn: () => void; sidePanelOpen?: boolean }>) {
  const actions = useComposerActions(onConnectLinkedIn);
  const floats = actions.composes.filter(compose => compose.mode === "float");
  const maximized = floats.find(compose => compose.maximized && !compose.minimized);
  return (
    <ComposerContext.Provider value={actions.value}>
      <ActionsContext.Provider value={actions}>
        {children}
        {/* Like Gmail, compose windows sit left of an open side panel (rail 3.5rem + panel 20.5rem). */}
        {floats.length > 0 && <div className={cn("pointer-events-none fixed bottom-0 right-4 z-40 flex items-end gap-3 max-lg:left-0 max-lg:right-0", sidePanelOpen ? "md:right-[25rem]" : "md:right-[4.5rem]")} aria-label="Compose windows">
          {floats.map(compose => <ComposeCard key={compose.key} compose={compose} />)}
        </div>}
        {maximized && <div className="fixed inset-0 z-30 bg-foreground/30" aria-hidden="true" onClick={() => actions.patch(maximized.key, { maximized: false })} />}
        {actions.pending && <div role="status" aria-live="polite" className="fixed bottom-5 left-5 z-50 flex items-center gap-2 rounded-md bg-foreground py-2 pl-4 pr-2 text-sm text-background shadow-lg" data-testid="pending-post">
          <span>Posting to LinkedIn in {actions.pending.left}s…</span>
          <Button size="sm" variant="ghost" className="text-background hover:bg-background/15 hover:text-background" onClick={() => actions.finishPending(false)}>Undo</Button>
          <Button size="sm" variant="ghost" className="text-background hover:bg-background/15 hover:text-background" onClick={() => actions.finishPending(true)}>Post now</Button>
        </div>}
      </ActionsContext.Provider>
    </ComposerContext.Provider>
  );
}

export function InlineCompose({ compose }: Readonly<{ compose: Compose }>) {
  return <ComposeCard compose={compose} />;
}

function ComposeCard({ compose }: Readonly<{ compose: Compose }>) {
  const actions = useContext(ActionsContext)!;
  const [picking, setPicking] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const float = compose.mode === "float";
  const over = compose.body.length > LINKEDIN_CHARACTER_LIMIT;
  const empty = !compose.body.trim();
  const tone = CREATE_TONES.find(item => item.key === compose.tone)!;
  const title = compose.angle.trim() || compose.source?.headline || (compose.draft ? "LinkedIn draft" : "New LinkedIn post");
  const tomorrow = useMemo(() => nextMorning(new Date()), [picking]);
  const weekday = useMemo(() => nextMorning(new Date(), true), [picking]);
  useEffect(() => {
    if (!compose.focusToken || compose.minimized) return;
    bodyRef.current?.focus();
    actions.patch(compose.key, { focusToken: undefined });
  }, [compose.focusToken, compose.minimized]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // Portaled menus and dialogs bubble here through React; they handle their own keys.
    if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void actions.post(compose.key); }
    else if (event.key === "Escape" && float) { event.preventDefault(); actions.patch(compose.key, { minimized: true, maximized: false }); }
  };

  return (
    <section role={float ? "dialog" : "region"} aria-label={float ? `Compose: ${title}` : "Draft my take"} onKeyDown={onKeyDown} data-testid={`compose-${compose.mode}`}
      data-compose-key={compose.key} onFocusCapture={() => actions.touch(compose.key)}
      className={cn("pointer-events-auto flex min-w-0 flex-col overflow-hidden border bg-card shadow-lg",
        float ? "rounded-t-md" : "mt-5 rounded-md shadow-sm",
        float && (compose.minimized ? "w-72" : compose.maximized ? "fixed inset-x-[8vw] bottom-[6vh] top-[6vh] z-40 rounded-md" : "h-[min(36rem,85vh)] w-[32rem] max-lg:h-[85vh] max-lg:w-full"))}>
      <header className={cn("flex h-10 shrink-0 items-center gap-1 pl-3 pr-1 text-sm font-semibold", float ? "bg-foreground text-background" : "border-b")}>
        {float
          ? <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => actions.patch(compose.key, { minimized: !compose.minimized, ...(compose.minimized ? { focusToken: Date.now() } : {}) })}>{title}</button>
          : <span className="flex min-w-0 flex-1 items-center gap-2"><Reply className="h-4 w-4 shrink-0" aria-hidden="true" />Draft my take</span>}
        {float ? <>
          <HeaderButton label={compose.minimized ? "Restore" : "Minimize"} onClick={() => actions.patch(compose.key, { minimized: !compose.minimized, maximized: false, ...(compose.minimized ? { focusToken: Date.now() } : {}) })}><Minus className="h-4 w-4" aria-hidden="true" /></HeaderButton>
          {!compose.minimized && <HeaderButton label={compose.maximized ? "Exit full screen" : "Full screen"} onClick={() => actions.patch(compose.key, { maximized: !compose.maximized })}>
            {compose.maximized ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}</HeaderButton>}
        </> : <HeaderButton label="Pop out" onClick={() => actions.patch(compose.key, { mode: "float", minimized: false })}><Maximize2 className="h-4 w-4" aria-hidden="true" /></HeaderButton>}
        <HeaderButton label="Save and close" onClick={() => void actions.close(compose.key)}><X className="h-4 w-4" aria-hidden="true" /></HeaderButton>
      </header>
      {!compose.minimized && <>
        <div className="flex min-h-9 items-center gap-2 border-b px-3 text-xs">
          <span className="w-16 shrink-0 text-muted-foreground">Post as</span>
          <Linkedin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="font-medium">{actions.ready ? "Your LinkedIn profile" : "LinkedIn not connected"}</span>
        </div>
        <div className="flex min-h-9 items-center gap-2 border-b px-3 text-xs">
          <span className="w-16 shrink-0 text-muted-foreground">Based on</span>
          <span className="min-w-0 truncate rounded bg-muted px-2 py-0.5">{compose.source ? compose.source.headline : "Your own idea"}</span>
        </div>
        <label className="flex min-h-9 items-center gap-2 border-b px-3 text-xs">
          <span className="w-16 shrink-0 text-muted-foreground">Angle</span>
          <input value={compose.angle} onChange={event => actions.update(compose.key, { angle: event.target.value })} maxLength={200}
            placeholder="What is the point of this post?" className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <textarea ref={bodyRef} value={compose.body} onChange={event => actions.update(compose.key, { body: event.target.value })} aria-label="Post text"
          placeholder="Write your post, or use Help me write below." className={cn("min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed outline-none", !float && "min-h-[10rem]")} data-testid="compose-body" />
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 p-1.5">
          <Sparkles className="ml-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <input value={compose.take} onChange={event => actions.update(compose.key, { take: event.target.value })} maxLength={2000} aria-label="Your take"
            placeholder={compose.source ? "Your take (optional)" : "Describe your idea"} className="h-8 min-w-[8rem] flex-1 rounded border bg-card px-2 text-xs outline-none focus:border-input" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-8 gap-1 text-xs">{tone.label}<ChevronDown className="h-3 w-3" aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuLabel>Tone</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={compose.tone} onValueChange={value => actions.update(compose.key, { tone: value as CreateTone })}>
                {CREATE_TONES.map(item => <DropdownMenuRadioItem key={item.key} value={item.key}>{item.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {compose.generating
            ? <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => actions.stop(compose.key)}><Square className="mr-1 h-3 w-3" aria-hidden="true" />Stop</Button>
            : <Button size="sm" className="h-8 text-xs" onClick={() => void actions.generate(compose.key)} data-testid="button-help-me-write">Help me write</Button>}
          {compose.previousBody !== undefined && !compose.generating && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" aria-label="Restore previous text"
            onClick={() => { actions.update(compose.key, { body: compose.previousBody! }); actions.patch(compose.key, { previousBody: undefined, notice: "Previous text restored." }); }}><Undo2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
        </div>
        {(compose.notice || compose.saveError) && <p role="status" className={cn("mx-3 mb-2 text-xs", compose.saveError ? "text-destructive" : "text-muted-foreground")}>{compose.saveError ?? compose.notice}</p>}
        <footer className="flex shrink-0 items-center gap-1 border-t px-2 py-2">
          <span className="inline-flex overflow-hidden rounded-md">
            <Button className="rounded-r-none px-5" disabled={(empty || over) && actions.ready} onClick={() => void actions.post(compose.key)} data-testid="button-compose-post">
              {actions.ready ? "Post" : "Connect LinkedIn"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button className="rounded-l-none border-l border-primary-foreground/30 px-2" disabled={empty || over || !actions.ready} aria-label="Schedule options"><ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuLabel>Schedule post</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void actions.schedule(compose.key, tomorrow)}>Tomorrow morning<span className="ml-auto pl-4 text-xs text-muted-foreground">{scheduleLabel(tomorrow)}</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void actions.schedule(compose.key, weekday)}>Next weekday morning<span className="ml-auto pl-4 text-xs text-muted-foreground">{scheduleLabel(weekday)}</span></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPicking(true)}><CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />Pick date & time…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
          {actions.ready && <span className="ml-1 hidden text-[11px] text-muted-foreground sm:inline">Undo for {actions.undoSeconds}s</span>}
          <span className="ml-auto" />
          <span className="text-[11px] text-muted-foreground" aria-live="polite">{compose.saving ? "Saving…" : compose.draft && compose.draft.content === compose.body ? "Saved" : ""}</span>
          <span className={cn("px-1 text-[11px] tabular-nums", over ? "font-semibold text-destructive" : "text-muted-foreground")}>{compose.body.length.toLocaleString()}/{LINKEDIN_CHARACTER_LIMIT.toLocaleString()}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More options"><MoreVertical className="h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuLabel>Undo window</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={String(actions.undoSeconds)} onValueChange={value => actions.setUndoSeconds(Number(value))}>
                {UNDO_WINDOW_OPTIONS.map(seconds => <DropdownMenuRadioItem key={seconds} value={String(seconds)}>{seconds} seconds</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Discard draft" onClick={() => void actions.discard(compose.key)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
        </footer>
      </>}
      <SchedulePicker open={picking} onOpenChange={setPicking} onSchedule={at => { setPicking(false); void actions.schedule(compose.key, at); }} />
    </section>
  );
}

function HeaderButton({ label, onClick, children }: Readonly<{ label: string; onClick: () => void; children: ReactNode }>) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded hover:bg-muted/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{children}</button>;
}

function SchedulePicker({ open, onOpenChange, onSchedule }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onSchedule: (at: Date) => void }>) {
  const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [value, setValue] = useState(() => local(nextMorning(new Date())));
  const at = new Date(value);
  const valid = Number.isFinite(at.getTime()) && at.getTime() > Date.now() + 60_000;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Pick date & time</DialogTitle><DialogDescription>In your browser’s time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</DialogDescription></DialogHeader>
        <label className="block text-sm font-medium">When
          <input type="datetime-local" value={value} min={local(new Date())} onChange={event => setValue(event.target.value)} className="mt-1 block h-10 w-full rounded-md border px-3" />
        </label>
        {!valid && <p className="text-xs text-destructive">Choose a time at least a minute from now.</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!valid} onClick={() => onSchedule(at)}>Schedule post</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
