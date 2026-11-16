import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Archive, CalendarDays, FileText, Inbox, Linkedin, Menu, Pencil, Plus, Rss, Search, Send, Settings, Star, Tag, X, CalendarClock,
} from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { ComposerProvider, useComposer } from "@/components/inbox/composer";
import { AccountMenu } from "@/components/dashboard/navbar";
import { HelpButton } from "@/components/help-panel";
import { SourcesManagerContent } from "@/components/dashboard/sources-manager";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { setClassicLayoutPreference } from "@/hooks/use-client-features";
import { ignoreInboxShortcut, INBOX_SHORTCUTS } from "@/lib/inbox-shortcuts";
import { inboxStatusQuery, LINKEDIN_STATUS_KEY, linkedInPostingState, type LinkedInConnectionStatus } from "@/lib/inbox-queries";
import { cn } from "@/lib/utils";
import { inboxHref, parseInboxLocation, topicLabels } from "@shared/inbox-view";
import type { UserProfile } from "@shared/schema";

type Connector = "linkedin" | "sources" | "more";
interface InboxShellContextValue { query: string; setQuery: (query: string) => void; openShortcuts: () => void }
const InboxShellContext = createContext<InboxShellContextValue>({ query: "", setQuery: () => {}, openShortcuts: () => {} });
export const useInboxShell = () => useContext(InboxShellContext);

const isInboxPath = (path: string) => path === "/dashboard" || path === "/dashboard/discover";

/** Gmail-style workspace frame: search bar, folders, labels and connector side panel around every signed-in page. */
export function InboxShell({ children }: Readonly<{ children: ReactNode }>) {
  const [panel, setPanel] = useState<Connector | null>(null);
  return (
    <ComposerProvider onConnectLinkedIn={() => setPanel("linkedin")}>
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
          <form role="search" className="flex h-11 min-w-0 max-w-3xl flex-1 items-center gap-2 rounded-md border border-transparent bg-muted px-3 focus-within:border-input focus-within:bg-card focus-within:shadow-sm"
            onSubmit={event => { event.preventDefault(); if (!isInboxPath(location)) navigate("/dashboard"); }}>
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }}
              placeholder="Search stories, sources and topics" aria-label="Search your Inbox" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" data-testid="input-inbox-search" />
            {query && <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search" onClick={() => setQuery("")}><X className="h-4 w-4" aria-hidden="true" /></button>}
          </form>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <PostingStatusChip signedIn={signedIn} onOpen={() => setPanel("linkedin")} />
            <HelpButton />
            <Button variant="ghost" size="icon" asChild><Link href="/dashboard/settings" aria-label="Settings"><Settings className="h-5 w-5" aria-hidden="true" /></Link></Button>
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
  const unread = (active.data ?? []).filter(item => item.status === "active" && !item.readAt).length;
  const current = isInboxPath(location) ? parseInboxLocation(search) : null;
  const view = new URLSearchParams(search).get("view");
  const labels = topicLabels(profile.data?.keywords);
  const folders: Array<{ label: string; href: string; icon: typeof Inbox; count?: number; strong?: boolean; active: boolean }> = [
    { label: "For you", href: inboxHref(), icon: Inbox, count: unread, strong: unread > 0, active: current?.folder === "inbox" && !current.label },
    { label: "Shortlist", href: inboxHref({ folder: "shortlist" }), icon: Star, count: saved.data?.length, active: current?.folder === "shortlist" },
    { label: "Drafts", href: "/dashboard/content?view=ready", icon: FileText, active: location === "/dashboard/content" && (view === "ready" || !view) },
    { label: "Scheduled", href: "/dashboard/content?view=scheduled", icon: CalendarClock, active: location === "/dashboard/content" && view === "scheduled" },
    { label: "Posted", href: "/dashboard/content?view=published", icon: Send, active: location === "/dashboard/content" && view === "published" },
    { label: "Not relevant", href: inboxHref({ folder: "dismissed" }), icon: Archive, active: current?.folder === "dismissed" },
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

const RAIL: Array<{ id: Connector | "plan"; label: string; icon: typeof Inbox }> = [
  { id: "plan", label: "Plan (Calendar)", icon: CalendarDays },
  { id: "linkedin", label: "LinkedIn connection", icon: Linkedin },
  { id: "sources", label: "Sources you follow", icon: Rss },
  { id: "more", label: "More connectors", icon: Plus },
];

function ConnectorRail({ panel, onToggle }: Readonly<{ panel: Connector | null; onToggle: (panel: Connector) => void }>) {
  return (
    <aside aria-label="Connectors" className="hidden w-14 shrink-0 flex-col items-center gap-1 pt-1 md:flex">
      {RAIL.map(entry => entry.id === "plan"
        ? <Button key={entry.id} variant="ghost" size="icon" asChild><Link href="/dashboard/calendar" aria-label={entry.label} title={entry.label}><entry.icon className="h-5 w-5" aria-hidden="true" /></Link></Button>
        : <Button key={entry.id} variant="ghost" size="icon" aria-label={entry.label} title={entry.label} aria-pressed={panel === entry.id}
            className={cn(panel === entry.id && "bg-primary/10 text-primary")} onClick={() => onToggle(entry.id as Connector)} data-testid={`button-connector-${entry.id}`}>
            <entry.icon className="h-5 w-5" aria-hidden="true" />
          </Button>)}
    </aside>
  );
}

function ConnectorPanel({ panel, onClose }: Readonly<{ panel: Connector; onClose: () => void }>) {
  const signedIn = useIsSignedIn();
  const status = useQuery<LinkedInConnectionStatus>({ queryKey: LINKEDIN_STATUS_KEY, enabled: signedIn && panel === "linkedin", staleTime: 30_000 });
  const state = linkedInPostingState(status.data);
  const title = { linkedin: "LinkedIn connection", sources: "Sources you follow", more: "More connectors" }[panel];
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
        {panel === "sources" && <SourcesManagerContent />}
        {panel === "more" && <>
          <p className="text-muted-foreground">LinkedIn is the focus today. Other platforms stay available in Settings and will return here later.</p>
          <Button asChild variant="outline" className="w-full"><Link href="/dashboard/settings?tab=integrations">Open integrations</Link></Button>
          {["Notes for your experiences", "Newsletter forwarding", "Save from any page"].map(name => <div key={name} className="rounded-md border p-3">
            <p className="font-medium">{name}</p><p className="text-xs text-muted-foreground">Coming in a later phase.</p>
          </div>)}
        </>}
      </div>
    </aside>
  );
}
