import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useLocation, useSearch } from "wouter";
import { HelpCircle, Newspaper, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { inboxHref, NEWS_QUERY_MAX, parseInboxLocation } from "@shared/inbox-view";

type Scope = "inbox" | "news";
/**
 * Safari and macOS Firefox don't focus a button on click, so the input blurs with no relatedTarget
 * and the dropdown would close before the click lands. Keeping focus in the input avoids that.
 */
const keepInputFocus = (event: MouseEvent) => event.preventDefault();
const isInboxPath = (path: string) => path === "/dashboard" || path === "/dashboard/discover";

const OPERATORS: ReadonlyArray<readonly [example: string, meaning: string]> = [
  ["retail media", "Both words"],
  ["\u201cretail media\u201d", "This exact phrase"],
  ["amazon OR walmart", "Either word"],
  ["-crypto", "Leave out a word"],
  ["source:Reuters", "From a publication"],
  ["site:reuters.com", "From a website"],
  ["after:2026-01-31", "Published on or after a date"],
  ["before:2026-03-01", "Published before a date"],
  ["newer_than:7d", "Last 7 days (d, w or m)"],
];

/** Operator help for keyword news search, also linked from the empty results state. */
export function SearchOperatorsList() {
  return <>
    <dl className="space-y-1.5 text-sm">
      {OPERATORS.map(([example, meaning]) => <div key={example} className="flex items-baseline justify-between gap-3">
        <dt><code className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{example}</code></dt>
        <dd className="text-right text-xs text-muted-foreground">{meaning}</dd>
      </div>)}
    </dl>
    <p className="mt-3 text-xs text-muted-foreground">News search covers the last 30 days unless you add dates.</p>
  </>;
}

function OperatorsHelp({ className, testId }: Readonly<{ className?: string; testId: string }>) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Search operators" title="Search operators" data-testid={testId}
          className={cn("h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", className)}>
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1rem)]" aria-label="Search operators">
        <p className="mb-2 text-sm font-semibold">Search operators</p>
        <SearchOperatorsList />
      </PopoverContent>
    </Popover>
  );
}

function ScopeSwitch({ scope, onChange, className, testId }: Readonly<{ scope: Scope; onChange: (scope: Scope) => void; className?: string; testId: string }>) {
  return (
    <div role="group" aria-label="Search in" className={cn("shrink-0 items-center rounded-md bg-background/70 p-0.5 text-xs", className)} onMouseDown={keepInputFocus}>
      {(["inbox", "news"] as const).map(option => <button key={option} type="button" aria-pressed={scope === option} onClick={() => onChange(option)}
        className={cn("h-7 rounded px-2.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", scope === option ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
        data-testid={`${testId}-${option}`}>
        {option === "inbox" ? "Inbox" : "News"}
      </button>)}
    </div>
  );
}

/**
 * Gmail-style search bar. Inbox scope filters the current list as you type (the shell's query);
 * News scope searches news by keyword on its own results page (?news=).
 */
export function ShellSearch({ query, setQuery, inputRef }: Readonly<{ query: string; setQuery: (query: string) => void; inputRef: RefObject<HTMLInputElement> }>) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const newsQuery = isInboxPath(location) ? parseInboxLocation(search).news : null;
  const [scope, setScope] = useState<Scope>(newsQuery ? "news" : "inbox");
  const [newsText, setNewsText] = useState(newsQuery ?? "");
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const suggestionRef = useRef<HTMLButtonElement>(null);
  const previousNews = useRef(newsQuery);

  // A results page shows its query in News; leaving results returns the bar to the Inbox.
  useEffect(() => {
    if (newsQuery) { setScope("news"); setNewsText(newsQuery); }
    else if (previousNews.current) { setScope("inbox"); setNewsText(""); }
    previousNews.current = newsQuery;
    setOpen(false);
  }, [newsQuery]);

  const text = scope === "news" ? newsText : query;
  const trimmed = text.trim();
  const setText = (value: string) => { if (scope === "news") setNewsText(value); else setQuery(value); setOpen(true); };

  const searchNews = (value: string) => {
    const wanted = value.trim().slice(0, NEWS_QUERY_MAX);
    if (!wanted) return;
    if (scope === "inbox") setQuery("");
    setScope("news");
    setNewsText(wanted);
    setOpen(false);
    inputRef.current?.blur();
    navigate(inboxHref({ news: wanted }));
  };
  const switchScope = (next: Scope) => {
    if (next === scope) return;
    // The text follows you: an Inbox filter becomes a news search and back.
    if (next === "news") { setNewsText(query); setQuery(""); } else setQuery(newsText);
    setScope(next);
    inputRef.current?.focus();
  };

  return (
    <form ref={formRef} role="search" aria-label={scope === "news" ? "Search news" : "Search your Inbox"}
      className="relative flex h-11 min-w-0 max-w-3xl flex-1 items-center gap-2 rounded-md border border-transparent bg-muted pl-3 pr-1 focus-within:border-input focus-within:bg-card focus-within:shadow-sm"
      onBlur={event => {
        const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        // The operators popover renders in a portal; opening it from the suggestions must keep them open.
        if (!formRef.current?.contains(next) && !next?.closest("[data-radix-popper-content-wrapper]")) setOpen(false);
      }}
      onSubmit={event => {
        event.preventDefault();
        if (scope === "news") searchNews(text);
        else if (!isInboxPath(location) || newsQuery) navigate("/dashboard");
      }}>
      {scope === "news" ? <Newspaper className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <input ref={inputRef} value={text} maxLength={scope === "news" ? NEWS_QUERY_MAX : undefined}
        onChange={event => setText(event.target.value)} onFocus={() => setOpen(true)}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); setText(""); setOpen(false); event.currentTarget.blur(); }
          else if (event.key === "ArrowDown" && trimmed) { event.preventDefault(); setOpen(true); requestAnimationFrame(() => suggestionRef.current?.focus()); }
        }}
        placeholder={scope === "news" ? "Search news: words, \u201cphrases\u201d, source:" : "Search stories, sources and topics"}
        aria-label={scope === "news" ? "Search news" : "Search your Inbox"}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" data-testid="input-inbox-search" />
      {text && <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search" onClick={() => { setText(""); inputRef.current?.focus(); }}><X className="h-4 w-4" aria-hidden="true" /></button>}
      {scope === "news" && <OperatorsHelp className="hidden sm:flex" testId="button-search-operators" />}
      <ScopeSwitch scope={scope} onChange={switchScope} className="hidden sm:flex" testId="button-search-scope" />
      {open && trimmed && <div className="fixed inset-x-2 top-14 z-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg sm:absolute sm:inset-x-0 sm:top-full sm:mt-1"
        onMouseDown={keepInputFocus} data-testid="search-suggestions">
        <div className="mb-1 flex items-center justify-between gap-2 sm:hidden">
          <ScopeSwitch scope={scope} onChange={switchScope} className="flex" testId="button-suggestion-scope" />
          {scope === "news" && <OperatorsHelp className="flex" testId="button-suggestion-operators" />}
        </div>
        <button ref={suggestionRef} type="button" onClick={() => searchNews(text)}
          onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "Escape") { event.preventDefault(); inputRef.current?.focus(); if (event.key === "Escape") setOpen(false); } }}
          className="flex min-h-10 w-full items-center gap-3 rounded px-3 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="button-search-news">
          <Newspaper className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Search news for <span className="font-semibold">{`\u201c${trimmed}\u201d`}</span></span>
          {scope === "news" && <kbd className="hidden rounded border px-1.5 font-mono text-[11px] text-muted-foreground sm:inline">Enter</kbd>}
        </button>
      </div>}
    </form>
  );
}
