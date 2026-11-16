import { useId, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { followSearch, refreshSavedSearches, savedSearchesQuery, unfollowSearch, type FollowedSearch } from "@/lib/news-search-queries";
import { cn } from "@/lib/utils";
import { inboxHref } from "@shared/inbox-view";

const message = (error: unknown) => error instanceof Error && error.message ? error.message : "Try again.";

/** Followed news searches in the folder nav, like Gmail labels. Hidden until you follow one. */
export function SavedSearchesNav({ collapsed, currentSavedId, itemClassName }: Readonly<{ collapsed: boolean; currentSavedId: string | null; itemClassName: string }>) {
  const signedIn = Boolean(useIsSignedIn());
  const { toast } = useToast();
  const headingId = useId();
  const searches = useQuery(savedSearchesQuery(signedIn));
  const [removing, setRemoving] = useState<ReadonlySet<string>>(() => new Set());
  const list = (searches.data ?? []).filter(search => !removing.has(search.id));
  if (!list.length) return null;

  const undo = async (search: FollowedSearch) => {
    try { await followSearch(search.query, search.name); }
    catch (error) { toast({ title: "Couldn't follow the search again", description: message(error), variant: "destructive" }); }
    finally { void refreshSavedSearches(); }
  };
  const remove = async (search: FollowedSearch) => {
    setRemoving(current => new Set(current).add(search.id));
    try {
      await unfollowSearch(search.id);
      toast({ title: `Stopped following \u201c${search.name}\u201d`, action: <ToastAction altText="Undo" onClick={() => void undo(search)}>Undo</ToastAction> });
    } catch (error) {
      toast({ title: "Couldn't stop following the search", description: message(error), variant: "destructive" });
    } finally {
      await refreshSavedSearches();
      setRemoving(current => { const next = new Set(current); next.delete(search.id); return next; });
    }
  };

  return (
    <div className="mt-4" data-testid="nav-saved-searches">
      {!collapsed && <p id={headingId} className="flex h-8 items-center pl-6 pr-1 text-sm font-semibold">Searches</p>}
      <ul className="space-y-0.5" aria-labelledby={collapsed ? undefined : headingId} aria-label={collapsed ? "Searches" : undefined}>
        {list.map(search => {
          const active = currentSavedId === search.id;
          return <li key={search.id} className="group relative">
            <Link href={inboxHref({ news: search.query, saved: search.id })} title={search.query} aria-current={active ? "page" : undefined}
              aria-label={collapsed ? `Search: ${search.name}` : undefined} data-testid={`nav-search-${search.id}`}
              className={cn(itemClassName, collapsed ? "justify-center rounded-md px-0" : "rounded-r-md pl-6 pr-9", active && "bg-primary/10 font-semibold text-primary")}>
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{search.name}</span>}
            </Link>
            {!collapsed && <button type="button" aria-label={`Stop following ${search.name}`} title="Stop following" onClick={() => void remove(search)}
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
              data-testid={`button-unfollow-${search.id}`}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>}
          </li>;
        })}
      </ul>
    </div>
  );
}
