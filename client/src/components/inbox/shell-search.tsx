import type { RefObject } from "react";
import { useLocation } from "wouter";
import { Search, X } from "lucide-react";

const isInboxPath = (path: string) => path === "/dashboard" || path === "/dashboard/discover";

/** Phase 3A owns this: the Gmail-style search bar (Inbox filter today; keyword news search next). */
export function ShellSearch({ query, setQuery, inputRef }: Readonly<{ query: string; setQuery: (query: string) => void; inputRef: RefObject<HTMLInputElement> }>) {
  const [location, navigate] = useLocation();
  return (
    <form role="search" className="flex h-11 min-w-0 max-w-3xl flex-1 items-center gap-2 rounded-md border border-transparent bg-muted px-3 focus-within:border-input focus-within:bg-card focus-within:shadow-sm"
      onSubmit={event => { event.preventDefault(); if (!isInboxPath(location)) navigate("/dashboard"); }}>
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }}
        placeholder="Search stories, sources and topics" aria-label="Search your Inbox" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" data-testid="input-inbox-search" />
      {query && <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search" onClick={() => setQuery("")}><X className="h-4 w-4" aria-hidden="true" /></button>}
    </form>
  );
}
