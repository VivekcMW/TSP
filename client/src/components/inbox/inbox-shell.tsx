import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Archive, CalendarDays, Clock, Eye, FileText, Inbox, Lightbulb, Linkedin, Menu, Pencil, Plus, Rss, Search, Send, Settings, Sparkles, Star, StickyNote, Tag, Trash2, X, CalendarClock,
} from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { ComposerProvider, useComposer } from "@/components/inbox/composer";
import { AccountMenu } from "@/components/dashboard/navbar";
import { HelpButton } from "@/components/help-panel";
import { SourcesManagerContent } from "@/components/dashboard/sources-manager";
import { ShellSearch } from "@/components/inbox/shell-search";
import { SavedSearchesNav } from "@/components/inbox/saved-searches-nav";
import { PlanPanel } from "@/components/inbox/plan-panel";
import { QuickSettingsPanel } from "@/components/inbox/quick-settings-panel";
import { InputsPanel } from "@/components/inbox/inputs-panel";
import { WatchAlertsList } from "@/components/inbox/watch-alerts";
import { watchAlertsQuery } from "@/lib/moments-queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToastAction } from "@/components/ui/toast";
import { setClassicLayoutPreference } from "@/hooks/use-client-features";
import { usePostRows } from "@/hooks/use-post-rows";
import { useToast } from "@/hooks/use-toast";
import { ignoreInboxShortcut, INBOX_SHORTCUTS } from "@/lib/inbox-shortcuts";
import { inboxStatusQuery, LINKEDIN_STATUS_KEY, linkedInPostingState, type LinkedInConnectionStatus } from "@/lib/inbox-queries";
import { postCounts } from "@/lib/post-folders";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { inboxHref, parseInboxLocation, topicLabels, type InboxFolder } from "@shared/inbox-view";
import type { UserNote, UserProfile } from "@shared/schema";

type Connector = "plan" | "watchlist" | "settings" | "notes" | "linkedin" | "sources" | "more";
interface InboxShellContextValue { query: string; setQuery: (query: string) => void; openShortcuts: () => void }
const InboxShellContext = createContext<InboxShellContextValue>({ query: "", setQuery: () => {}, openShortcuts: () => {} });
export const useInboxShell = () => useContext(InboxShellContext);

const isInboxPath = (path: string) => path === "/dashboard" || path === "/dashboard/discover";

/** Gmail-style workspace frame: search bar, folders, labels and connector side panel around every signed-in page. */
export function InboxShell({ children }: Readonly<{ children: ReactNode }>) {
  const [panel, setPanel] = useState<Connector | null>(null);
  return (
    <ComposerProvider onConnectLinkedIn={() => setPanel("linkedin")} sidePanelOpen={panel !== null}>
      <ShellFrame panel={panel} setPanel={setPanel}>{children}</ShellFrame>
    </ComposerProvider>
  );
}

function ShellFrame({ children, panel, setPanel }: Readonly<{ children: ReactNode; panel: Connector | null; setPanel: Dispatch<SetStateAction<Connector | null>> }>) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const signedIn = useIsSignedIn();
  const composer = useComposer();
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef(composer.openBlank);
  composeRef.current = composer.openBlank;
  const openCompose = () => composeRef.current();
  useEffect(() => { setNavOpen(false); }, [location, search]);

  // Capture phase: the Inbox owns "?" (Gmail's shortcut list) ahead of Help's bubbling listener.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ignoreInboxShortcut(event)) return;
      if (event.key === "c") { event.preventDefault(); composeRef.current(); }
      else if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
      else if (event.key === "?") { event.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const context = useMemo(() => ({ query, setQuery, openShortcuts: () => setShortcutsOpen(true) }), [query]);

  return (
    <InboxShellContext.Provider value={context}>
      <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground" data-clarity-mask="True">
        <header className="flex h-16 shrink-0 items-center gap-2 px-2 sm:px-3" aria-label="Workspace">
          <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" aria-label="Open folders" onClick={() => setNavOpen(true)}><Menu className="h-5 w-5" aria-hidden="true" /></Button>
          <Button variant="ghost" size="icon" className="hidden shrink-0 lg:inline-flex" aria-label={navCollapsed ? "Expand folders" : "Collapse folders"} aria-pressed={navCollapsed} onClick={() => setNavCollapsed(value => !value)}><Menu className="h-5 w-5" aria-hidden="true" /></Button>
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2 pr-2 lg:w-44" aria-label="TheSocialPundit Inbox" data-testid="link-navbar-logo">
            <img src="/logo-mark.png" alt="" className="h-7 w-7 rounded-md" aria-hidden="true" />
            <span className="hidden font-bold text-primary sm:inline">TheSocialPundit</span>
          </Link>
          <ShellSearch query={query} setQuery={setQuery} inputRef={searchRef} />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <PostingStatusChip signedIn={signedIn} onOpen={() => setPanel("linkedin")} />
            <HelpButton />
            <Button variant="ghost" size="icon" aria-label="Quick settings" title="Quick settings" aria-pressed={panel === "settings"} onClick={() => setPanel(current => current === "settings" ? null : "settings")} data-testid="button-quick-settings"><Settings className="h-5 w-5" aria-hidden="true" /></Button>
            <AccountMenu layoutSwitch={{ label: "Switch to classic layout", onSelect: () => setClassicLayoutPreference(true) }} />
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className={cn("hidden shrink-0 overflow-y-auto lg:block", navCollapsed ? "w-[4.5rem]" : "w-60")}>
            <InboxNav collapsed={navCollapsed} location={location} search={search} signedIn={signedIn} onCompose={openCompose} />
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden border-t bg-card lg:mb-2 lg:rounded-md lg:border" id="workspace-content">{children}</div>
          {panel && <ConnectorPanel panel={panel} onClose={() => setPanel(null)} />}
          <ConnectorRail panel={panel} onToggle={next => setPanel(current => current === next ? null : next)} />
        </div>
        <Button onClick={openCompose} className="fixed bottom-5 right-5 z-20 h-14 gap-2 px-5 shadow-lg lg:hidden" aria-label="Compose a LinkedIn post" data-testid="button-inbox-compose-mobile">
          <Pencil className="h-5 w-5" aria-hidden="true" />Compose
        </Button>
      </div>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 overflow-y-auto p-0">
          <SheetHeader className="sr-only"><SheetTitle>Folders</SheetTitle><SheetDescription>Inbox folders, topic labels and your focus.</SheetDescription></SheetHeader>
          <InboxNav collapsed={false} location={location} search={search} signedIn={signedIn} onCompose={() => { setNavOpen(false); openCompose(); }} />
        </SheetContent>
      </Sheet>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Shortcuts work in the Inbox when you are not typing.</DialogDescription></DialogHeader>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {INBOX_SHORTCUTS.map(([key, action]) => <div key={key} className="flex items-center justify-between gap-3 border-b pb-2 text-sm"><dt>{action}</dt><dd><kbd className="rounded border border-b-2 bg-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd></dd></div>)}
          </dl>
        </DialogContent>
      </Dialog>
    </InboxShellContext.Provider>
  );
}

function InboxNav({ collapsed, location, search, signedIn, onCompose }: Readonly<{ collapsed: boolean; location: string; search: string; signedIn: boolean; onCompose: () => void }>) {
  const profile = useQuery<UserProfile>({ queryKey: ["/api/profile"], enabled: signedIn });
  const active = useQuery(inboxStatusQuery("active", signedIn));
  const saved = useQuery(inboxStatusQuery("saved", signedIn));
  const { rows: posts } = usePostRows(signedIn);
  const postCount = postCounts(posts);
  const unread = (active.data ?? []).filter(item => item.status === "active" && !item.readAt).length;
  const current = isInboxPath(location) ? parseInboxLocation(search) : null;
  const labels = topicLabels(profile.data?.keywords);
  const at = (folder: InboxFolder) => current?.folder === folder && !current.news;
  const folders: Array<{ label: string; href: string; icon: typeof Inbox; count?: number; strong?: boolean; active: boolean }> = [
    { label: "For you", href: inboxHref(), icon: Inbox, count: unread, strong: unread > 0, active: at("inbox") && !current?.label },
    { label: "Ideas", href: inboxHref({ folder: "ideas" }), icon: Lightbulb, active: at("ideas") && !current?.news },
    { label: "Shortlist", href: inboxHref({ folder: "shortlist" }), icon: Star, count: saved.data?.length, active: at("shortlist") },
    { label: "Snoozed", href: inboxHref({ folder: "snoozed" }), icon: Clock, active: at("snoozed") },
    { label: "Drafts", href: inboxHref({ folder: "drafts" }), icon: FileText, count: postCount.drafts, active: at("drafts") },
    { label: "Scheduled", href: inboxHref({ folder: "scheduled" }), icon: CalendarClock, count: postCount.scheduled, active: at("scheduled") },
    { label: "Posted", href: inboxHref({ folder: "posted" }), icon: Send, active: at("posted") },
    // Like Gmail's Outbox: only shown while something needs checking.
    ...(postCount.outbox || at("outbox") ? [{ label: "Outbox", href: inboxHref({ folder: "outbox" }), icon: AlertTriangle, count: postCount.outbox, strong: postCount.outbox > 0, active: at("outbox") }] : []),
    { label: "Not relevant", href: inboxHref({ folder: "dismissed" }), icon: Archive, active: at("dismissed") },
    { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, active: location === "/dashboard/calendar" },
  ];
  const item = "flex h-9 w-full items-center gap-3 pr-3 text-sm transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <nav aria-label="Folders" className="flex min-h-full flex-col gap-1 py-2 pr-2">
      <div className="px-3 pb-3">
        <Button onClick={onCompose} className={cn("h-12 gap-3 shadow-sm", collapsed ? "w-12 px-0" : "px-5")} aria-label="Compose a LinkedIn post" data-testid="button-inbox-compose">
          <Pencil className="h-5 w-5" aria-hidden="true" />{!collapsed && <span>Compose</span>}
        </Button>
      </div>
      <ul className="space-y-0.5">
        {folders.map(folder => <li key={folder.label}>
          <Link href={folder.href} className={cn(item, collapsed ? "justify-center rounded-md px-0" : "rounded-r-md pl-6", folder.active && "bg-primary/10 font-semibold text-primary")}
            aria-current={folder.active ? "page" : undefined} aria-label={collapsed ? folder.label : undefined} data-testid={`nav-folder-${folder.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <folder.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!collapsed && <><span className={cn("flex-1 truncate", folder.strong && "font-semibold")}>{folder.label}</span>{!!folder.count && <span className="text-xs font-semibold tabular-nums">{folder.count}</span>}</>}
          </Link>
        </li>)}
      </ul>
      <SavedSearchesNav collapsed={collapsed} currentSavedId={current?.saved ?? null} itemClassName={item} />
      {!collapsed && <>
        <div className="mt-4 flex items-center justify-between pl-6 pr-1 text-sm font-semibold">
          <span>Labels</span>
          <Link href="/dashboard/settings?tab=content" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Manage topic labels"><Plus className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
        {labels.length ? <ul className="space-y-0.5">{labels.map(label => {
          const selected = current?.label === label;
          return <li key={label}><Link href={inboxHref({ folder: "inbox", tab: "stories", label })} className={cn(item, "rounded-r-md pl-6", selected && "bg-primary/10 font-semibold text-primary")} aria-current={selected ? "page" : undefined}>
            <Tag className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{label}</span>
          </Link></li>;
        })}</ul> : <p className="px-6 py-1 text-xs text-muted-foreground">Add topics in Settings to filter by label.</p>}
        <section className="mx-3 mt-auto rounded-md border border-dashed bg-card p-3 text-xs" aria-label="Your focus">
          <p className="font-semibold uppercase tracking-wide text-muted-foreground">Your focus</p>
          <p className="mt-1 line-clamp-4 text-muted-foreground">{profile.data?.focusDescription?.trim() || "Tell us what you do and who you want to reach."}</p>
          <Link href="/dashboard/settings?tab=content" className="mt-2 inline-flex min-h-8 items-center font-semibold text-primary hover:underline">Edit focus</Link>
        </section>
      </>}
    </nav>
  );
}

function PostingStatusChip({ signedIn, onOpen }: Readonly<{ signedIn: boolean; onOpen: () => void }>) {
  const status = useQuery<LinkedInConnectionStatus>({ queryKey: LINKEDIN_STATUS_KEY, enabled: signedIn, staleTime: 30_000 });
  const state = linkedInPostingState(status.data);
  const label = { ready: "Posting to LinkedIn", attention: "Reconnect LinkedIn", disconnected: "Connect LinkedIn", unknown: "LinkedIn status" }[state];
  return (
    <button type="button" onClick={onOpen} className="hidden h-9 items-center gap-2 rounded-md border bg-card px-3 text-xs font-semibold hover:bg-muted md:inline-flex" data-testid="button-linkedin-status">
      <span className={cn("h-2 w-2 rounded-full", state === "ready" ? "bg-success" : state === "unknown" ? "bg-muted-foreground" : "bg-warning")} aria-hidden="true" />
      {label}
    </button>
  );
}

const RAIL: Array<{ id: Exclude<Connector, "settings">; label: string; icon: typeof Inbox }> = [
  { id: "plan", label: "Plan", icon: CalendarDays },
  { id: "watchlist", label: "Watchlist alerts", icon: Eye },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "linkedin", label: "LinkedIn connection", icon: Linkedin },
  { id: "sources", label: "Sources you follow", icon: Rss },
  { id: "more", label: "More connectors", icon: Plus },
];

function ConnectorRail({ panel, onToggle }: Readonly<{ panel: Connector | null; onToggle: (panel: Connector) => void }>) {
  const signedIn = useIsSignedIn();
  const alerts = useQuery({ ...watchAlertsQuery(), enabled: signedIn, retry: false });
  const unseen = (alerts.data ?? []).filter(alert => !alert.seenAt).length;
  return (
    <aside aria-label="Connectors" className="hidden w-14 shrink-0 flex-col items-center gap-1 pt-1 md:flex">
      {RAIL.map(entry => {
        const badge = entry.id === "watchlist" && unseen > 0 ? unseen : 0;
        const label = badge ? `${entry.label}, ${badge} new` : entry.label;
        return <Button key={entry.id} variant="ghost" size="icon" aria-label={label} title={label} aria-pressed={panel === entry.id}
          className={cn("relative", panel === entry.id && "bg-primary/10 text-primary")} onClick={() => onToggle(entry.id)} data-testid={`button-connector-${entry.id}`}>
          <entry.icon className="h-5 w-5" aria-hidden="true" />
          {badge > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground" aria-hidden="true">{badge > 9 ? "9+" : badge}</span>}
        </Button>;
      })}
    </aside>
  );
}

/** Stories that mention someone you watch; opening one shows it in For you. */
function WatchlistPanel({ onOpenStory }: Readonly<{ onOpenStory: (inboxItemId: string) => void }>) {
  const signedIn = useIsSignedIn();
  const alerts = useQuery({ ...watchAlertsQuery(), enabled: signedIn, retry: false });
  return <>
    <WatchAlertsList limit={20} onOpenStory={onOpenStory} />
    {alerts.isLoading ? <p className="text-xs text-muted-foreground">Loading alerts…</p>
      : alerts.isError ? <p role="alert" className="text-xs text-muted-foreground">Alerts could not be loaded.</p>
      : !alerts.data?.length && <p className="text-muted-foreground">No alerts yet. When a new story mentions a company, person or topic you watch, it shows up here.</p>}
    <Button asChild variant="outline" className="w-full"><Link href="/dashboard/settings?tab=notifications">Choose what to watch</Link></Button>
  </>;
}

function ConnectorPanel({ panel, onClose }: Readonly<{ panel: Connector; onClose: () => void }>) {
  const signedIn = useIsSignedIn();
  const [, navigate] = useLocation();
  const status = useQuery<LinkedInConnectionStatus>({ queryKey: LINKEDIN_STATUS_KEY, enabled: signedIn && panel === "linkedin", staleTime: 30_000 });
  const state = linkedInPostingState(status.data);
  const title = { plan: "Plan", watchlist: "Watchlist alerts", settings: "Quick settings", linkedin: "LinkedIn connection", notes: "Notes", sources: "Sources you follow", more: "More connectors" }[panel];
  return (
    <aside aria-label={title} className="mb-2 ml-2 flex w-80 shrink-0 flex-col overflow-hidden rounded-md border bg-card" data-testid={`panel-connector-${panel}`}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b pl-4 pr-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button variant="ghost" size="icon" aria-label={`Close ${title}`} onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {panel === "linkedin" && <>
          <p className="font-semibold">{{ ready: "Posting is enabled.", attention: "Posting needs attention.", disconnected: "Posting is not connected.", unknown: "Checking your connection…" }[state]}</p>
          <p className="text-muted-foreground">{state === "ready"
            ? "Posts you publish from TheSocialPundit go to your connected LinkedIn profile. Nothing posts without your action."
            : status.data?.assessment?.reason || "Connect LinkedIn to post from TheSocialPundit. You can still read, save and write drafts without it."}</p>
          <Button asChild variant={state === "ready" ? "outline" : "default"} className="w-full"><Link href="/dashboard/settings?tab=integrations">{state === "ready" ? "Manage connection" : "Connect LinkedIn"}</Link></Button>
          <p className="text-xs text-muted-foreground">Signing in with LinkedIn does not give permission to post. Reconnecting never posts automatically.</p>
        </>}
        {panel === "notes" && <NotesPanel />}
        {panel === "sources" && <SourcesManagerContent />}
        {panel === "plan" && <PlanPanel />}
        {panel === "watchlist" && <WatchlistPanel onOpenStory={id => navigate(`/dashboard?tab=stories&story=${encodeURIComponent(id)}`)} />}
        {panel === "settings" && <QuickSettingsPanel />}
        {panel === "more" && <InputsPanel />}
      </div>
    </aside>
  );
}

const NOTES_KEY = ["/api/notes"] as const;
const NOTE_LIMIT = 1000;

/** Keep-style notes: your own experiences and results, inserted into a post or used for Help me write. */
function NotesPanel() {
  const signedIn = useIsSignedIn();
  const composer = useComposer();
  const { toast } = useToast();
  const notes = useQuery<UserNote[]>({ queryKey: NOTES_KEY, enabled: signedIn });
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const failed = (title: string) => (error: unknown) => toast({ title, description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: NOTES_KEY });
  const create = useMutation({
    mutationFn: async (value: string) => (await apiRequest("POST", "/api/notes", { text: value })).json() as Promise<UserNote>,
    onSuccess: () => { void refresh(); }, onError: failed("Couldn't save the note"),
  });
  const update = useMutation({
    mutationFn: async (note: { id: string; text: string }) => (await apiRequest("PATCH", `/api/notes/${encodeURIComponent(note.id)}`, { text: note.text })).json(),
    onSuccess: () => { setEditing(null); void refresh(); }, onError: failed("Couldn't update the note"),
  });
  const remove = useMutation({
    mutationFn: async (note: UserNote) => { await apiRequest("DELETE", `/api/notes/${encodeURIComponent(note.id)}`); return note; },
    onSuccess: note => {
      void refresh();
      toast({ title: "Note deleted", action: <ToastAction altText="Undo" onClick={() => create.mutate(note.text)}>Undo</ToastAction> });
    },
    onError: failed("Couldn't delete the note"),
  });
  const insert = (note: UserNote, into: "body" | "take") => {
    const where = composer.insertNote(note.text, into);
    toast({ title: into === "take" ? (where === "existing" ? "Added to Your take" : "Started a post from this note") : (where === "existing" ? "Added to your draft" : "Started a new post with this note"),
      description: into === "take" ? "Use Help me write to turn it into a post." : undefined });
  };
  const draftText = text.trim();
  // Clear only what was saved: Undo re-creates notes through the same mutation, and typing may continue meanwhile.
  const save = () => { if (draftText && !create.isPending) create.mutate(draftText, { onSuccess: () => setText(current => current.trim() === draftText ? "" : current) }); };

  return <div className="space-y-3">
    <p className="text-muted-foreground">Jot down experiences, results and opinions. Add one to a post, or use it for Help me write.</p>
    <div className="rounded-md border p-2 focus-within:border-input">
      <textarea value={text} onChange={event => setText(event.target.value)} maxLength={NOTE_LIMIT} rows={3} aria-label="New note" placeholder="Take a note…"
        onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); save(); } }}
        className="w-full resize-none bg-transparent text-sm outline-none" data-testid="input-new-note" />
      <div className="flex items-center justify-end gap-2">
        {text.length > NOTE_LIMIT - 100 && <span className="text-[11px] tabular-nums text-muted-foreground">{text.length}/{NOTE_LIMIT}</span>}
        <Button size="sm" disabled={!draftText || create.isPending} onClick={save} data-testid="button-save-note">{create.isPending ? "Saving…" : "Save note"}</Button>
      </div>
    </div>
    {notes.isLoading ? <p className="text-xs text-muted-foreground">Loading notes…</p>
      : notes.isError ? <div role="alert" className="text-xs"><p>Notes could not be loaded.</p><Button size="sm" variant="outline" className="mt-2" onClick={() => void notes.refetch()}>Try again</Button></div>
      : notes.data?.length ? <ul className="space-y-2" aria-label="Your notes">{notes.data.map(note => <li key={note.id} className="rounded-md border bg-card p-3" data-testid={`note-${note.id}`}>
          {editing?.id === note.id ? <>
            <textarea value={editing.text} onChange={event => setEditing({ id: note.id, text: event.target.value })} maxLength={NOTE_LIMIT} rows={4} aria-label="Edit note" autoFocus
              className="w-full resize-none rounded border bg-background p-2 text-sm outline-none focus:border-input" />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" disabled={!editing.text.trim() || update.isPending} onClick={() => update.mutate({ id: note.id, text: editing.text.trim() })}>Save</Button>
            </div>
          </> : <>
            <p className="whitespace-pre-wrap break-words text-sm">{note.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => insert(note, "body")} data-testid={`button-insert-note-${note.id}`}>Add to post</Button>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => insert(note, "take")} title="Put this note in Your take for Help me write"><Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Use as take</Button>
              <span className="ml-auto flex">
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit note" onClick={() => setEditing({ id: note.id, text: note.text })}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Delete note" disabled={remove.isPending} onClick={() => remove.mutate(note)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
              </span>
            </div>
          </>}
        </li>)}</ul>
      : <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No notes yet. Try a recent win, a lesson learned or a number you can share.</p>}
  </div>;
}
