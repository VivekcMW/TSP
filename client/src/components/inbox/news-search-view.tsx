import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, BellPlus, BellRing, ExternalLink, Reply, Star } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastAction } from "@/components/ui/toast";
import { useComposer } from "@/components/inbox/composer";
import { SearchOperatorsList } from "@/components/inbox/shell-search";
import { ignoreInboxShortcut } from "@/lib/inbox-shortcuts";
import {
  findFollowed, followSearch, inboxCopyOf, inboxStateLabel, markSearchViewed, newsSearchQuery, refreshSavedSearches, saveNewsResult, savedSearchesQuery, unfollowSearch,
  type NewsSearchResponse, type NewsSearchResult,
} from "@/lib/news-search-queries";
import { cn } from "@/lib/utils";
import { hasSearchTerms, newsQueryChips, parseNewsQuery } from "@shared/news-search";

const PROVIDER_NAMES: Record<keyof NewsSearchResponse["providers"], string> = { pool: "Our story index", google: "Google News", bing: "Bing News" };
const message = (error: unknown, fallback = "Try again.") => error instanceof Error && error.message ? error.message : fallback;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase()).join("") || "?";
const quoted = (text: string) => `\u201c${text}\u201d`;
/** Not yet yours, or marked not relevant earlier: saving moves it to the Shortlist. */
const canSave = (row: NewsSearchResult) => !row.inInbox || row.inInbox.status === "dismissed";

function listTime(publishedAt: string | null, now = new Date()): string {
  if (!publishedAt) return "";
  const date = new Date(publishedAt);
  if (!Number.isFinite(date.getTime())) return "";
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "2-digit" }) });
}
const publishedLabel = (publishedAt: string | null) => {
  const date = publishedAt ? new Date(publishedAt) : null;
  return date && Number.isFinite(date.getTime()) ? `Published ${date.toLocaleDateString(undefined, { dateStyle: "medium" })}` : "Publication date unknown";
};

/** Keyword news search results: Gmail-style list and reading pane, opened from the search bar (?news=). */
export function NewsSearchView({ query, savedId }: Readonly<{ query: string; savedId: string | null }>) {
  const signedIn = Boolean(useIsSignedIn());
  const composer = useComposer();
  const { toast } = useToast();
  const parsed = useMemo(() => parseNewsQuery(query), [query]);
  const chips = useMemo(() => newsQueryChips(parsed), [parsed]);
  const searchable = hasSearchTerms(parsed);
  const search = useQuery(newsSearchQuery(query, signedIn && searchable));
  const saved = useQuery(savedSearchesQuery(signedIn));
  const followed = findFollowed(saved.data, query);
  const rows = useMemo(() => search.data?.results ?? [], [search.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [followBusy, setFollowBusy] = useState(false);
  const selected = rows.find(row => row.id === selectedId) ?? null;
  useEffect(() => { if (!selected && rows.length) setSelectedId(rows[0].id); }, [selected, rows]);

  const viewed = useRef<string | null>(null);
  useEffect(() => {
    if (!signedIn || !savedId || viewed.current === savedId) return;
    viewed.current = savedId;
    markSearchViewed(savedId).catch(() => undefined);
  }, [savedId, signedIn]);

  const save = useCallback(async (row: NewsSearchResult, quiet = false) => {
    setSaving(current => new Set(current).add(row.id));
    try {
      const item = await saveNewsResult(row);
      if (!quiet) toast({ title: "Saved to Shortlist", description: "Find it in Shortlist when you're ready to write." });
      return item;
    } catch (error) {
      toast({ title: "Couldn't save the story", description: message(error), variant: "destructive" });
      return null;
    } finally {
      setSaving(current => { const next = new Set(current); next.delete(row.id); return next; });
    }
  }, [toast]);

  const draft = useCallback(async (row: NewsSearchResult) => {
    // Already in For you or the Shortlist (maybe as another outlet's copy): write about that item, don't save again.
    if (row.inInbox && row.inInbox.status !== "dismissed") {
      composer.openForStory({ id: row.inInbox.id, headline: row.title, source: inboxCopyOf(row).source, articleUrl: row.inInbox.url }, false);
      return;
    }
    const item = await save(row, true);
    if (!item) return;
    if (!row.inInbox && item.status === "saved") toast({ title: "Saved to Shortlist", description: "Your draft stays linked to this story." });
    composer.openForStory({ id: item.id, headline: item.headline, source: item.source, articleUrl: item.articleUrl }, false);
  }, [save, composer, toast]);

  const toggleFollow = async () => {
    if (followBusy || !searchable) return;
    setFollowBusy(true);
    const current = followed;
    try {
      if (current) {
        await unfollowSearch(current.id);
        toast({ title: "Stopped following this search", action: <ToastAction altText="Undo" onClick={() => void followSearch(current.query, current.name).catch(() => undefined).finally(() => void refreshSavedSearches())}>Undo</ToastAction> });
      } else {
        await followSearch(parsed.normalized);
        toast({ title: "Following this search", description: "Find it under Searches in the folder list." });
      }
    } catch (error) {
      toast({ title: current ? "Couldn't stop following" : "Couldn't follow this search", description: message(error), variant: "destructive" });
    } finally {
      await refreshSavedSearches();
      setFollowBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ignoreInboxShortcut(event) || !["j", "k", "o", "u", "s", "r"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "u") { setReadingOpen(false); return; }
      if (event.key === "o") { if (selected) setReadingOpen(true); return; }
      if (event.key === "s") { if (selected && canSave(selected)) void save(selected); return; }
      if (event.key === "r") { if (selected) void draft(selected); return; }
      const index = rows.findIndex(row => row.id === selectedId);
      const next = rows[Math.max(0, Math.min(rows.length - 1, (index < 0 ? -1 : index) + (event.key === "j" ? 1 : -1)))];
      if (!next) return;
      setSelectedId(next.id);
      setReadingOpen(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="row-news-${CSS.escape(next.id)}"]`)?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedId, selected, save, draft]);

  const failedProviders = search.data ? (Object.keys(search.data.providers) as Array<keyof NewsSearchResponse["providers"]>).filter(name => search.data!.providers[name] === "failed") : [];
  const allFailed = search.data && failedProviders.length > 0 && Object.values(search.data.providers).every(status => status !== "ok");
  const heading = parsed.normalized || query;

  return (
    <main className="flex h-full min-h-0" aria-label="News search">
      <section aria-label="News results" data-inbox-list className={cn("min-h-0 min-w-0 flex-col border-r lg:flex lg:w-[min(46%,36rem)] lg:shrink-0", readingOpen ? "hidden" : "flex w-full")}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b pl-4 pr-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={heading}>News: {heading}</h2>
          {searchable && <Button variant={followed ? "secondary" : "outline"} size="sm" className="h-8 shrink-0 gap-1.5 px-2.5 text-xs" aria-pressed={Boolean(followed)}
            disabled={followBusy || saved.isLoading} onClick={() => void toggleFollow()} data-testid="button-follow-search">
            {followed ? <BellRing className="h-3.5 w-3.5" aria-hidden="true" /> : <BellPlus className="h-3.5 w-3.5" aria-hidden="true" />}
            {followed ? "Following" : "Follow this search"}
          </Button>}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">{search.isLoading ? "Searching…" : rows.length ? `1–${rows.length} of ${rows.length}` : "0"}</span>
        </div>
        {(chips.length > 0 || parsed.warnings.length > 0 || (failedProviders.length > 0 && !allFailed)) && <div className="shrink-0 space-y-2 border-b px-4 py-2.5 text-xs">
          {chips.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label="Search operators used">
            {chips.map(chip => <li key={chip.label} className={cn("rounded border px-1.5 py-0.5 font-medium", chip.kind === "exclude" && "border-dashed")}>{chip.label}</li>)}
          </ul>}
          {parsed.warnings.map(warning => <p key={warning} role="status" className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />{warning}</p>)}
          {failedProviders.length > 0 && !allFailed && <p role="status" className="text-muted-foreground" data-testid="text-provider-note">
            {failedProviders.map(name => PROVIDER_NAMES[name]).join(" and ")} didn’t answer in time, so some stories may be missing. Try again in a minute.
          </p>}
        </div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!searchable ? <EmptyResults title="Add a word to search" body="Search needs at least one word, a “phrase” or source:." />
            : search.isLoading ? <div className="space-y-px" aria-label="Loading">{[0, 1, 2, 3].map(index => <div key={index} className="space-y-2 border-b p-4"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-2/3" /></div>)}</div>
            : search.isError || allFailed ? <div role="alert" className="p-6 text-sm">
                <p className="font-medium">{search.isError ? "Search didn’t work." : "News sources didn’t answer."}</p>
                <p className="mt-1 text-muted-foreground">{search.isError ? message(search.error, "Try again in a moment.") : "Try again in a minute."}</p>
                <Button variant="outline" className="mt-3" onClick={() => void search.refetch()}>Try again</Button>
              </div>
            : rows.length ? <ul aria-label="News stories">{rows.map(row => {
                const isSelected = row.id === selected?.id;
                return <li key={row.id} className={cn("border-b", isSelected && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                  <button type="button" onClick={() => { setSelectedId(row.id); setReadingOpen(true); }} aria-current={isSelected ? "true" : undefined}
                    className="block w-full px-4 py-2.5 text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" data-testid={`row-news-${row.id}`}>
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{row.source}{row.alsoCoveredBy.length > 0 && <span className="text-xs"> +{row.alsoCoveredBy.length} more</span>}</span>
                      {row.inInbox && <span className="shrink-0 rounded bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">{inboxStateLabel(row.inInbox.status)}</span>}
                      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{listTime(row.publishedAt)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-semibold">{row.title}</span>
                    {row.snippet && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.snippet}</span>}
                  </button>
                </li>;
              })}</ul>
            : <EmptyResults title={`No stories match ${quoted(heading)}`} body="Try fewer words, remove an operator or widen the dates." tips />}
        </div>
      </section>
      <section aria-label="Reading pane" className={cn("min-h-0 min-w-0 flex-1 flex-col lg:flex", readingOpen ? "flex" : "hidden")}>
        {selected ? <ResultPane key={selected.id} row={selected} saving={saving.has(selected.id)} onBack={() => setReadingOpen(false)} onSave={() => void save(selected)} onDraft={() => void draft(selected)} />
          : <div className="m-auto max-w-sm px-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Search the news</p>
              <p className="mt-1">Open a story to read it, save it to your Shortlist or draft your take.</p>
            </div>}
      </section>
    </main>
  );
}

function EmptyResults({ title, body, tips = false }: Readonly<{ title: string; body: string; tips?: boolean }>) {
  return <div className="flex flex-col items-center px-6 py-12 text-center">
    <h3 className="text-base font-semibold">{title}</h3>
    <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
    {tips && <div className="mt-5 w-full max-w-xs rounded-md border p-3 text-left"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search tips</p><SearchOperatorsList /></div>}
  </div>;
}

function ResultPane({ row, saving, onBack, onSave, onDraft }: Readonly<{ row: NewsSearchResult; saving: boolean; onBack: () => void; onSave: () => void; onDraft: () => void }>) {
  const state = row.inInbox && !canSave(row) ? inboxStateLabel(row.inInbox.status) : null;
  return <>
    <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2" aria-label="Story actions">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Back to results" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Button>
      <Button variant="ghost" size="icon" aria-label={state ?? "Save to Shortlist"} title={state ?? "Save to Shortlist (s)"} disabled={Boolean(state) || saving} onClick={onSave}>
        <Star className={cn("h-4 w-4", row.inInbox?.status === "saved" && "fill-warning text-warning")} aria-hidden="true" />
      </Button>
      <a href={row.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" data-testid={`link-news-original-${row.id}`}>
        Open original<span className="sr-only"> (opens in a new tab)</span><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </div>
    <article className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
      <h2 className="break-words text-xl font-semibold leading-snug" data-testid={`text-news-headline-${row.id}`}>{row.title}</h2>
      {row.matchedTerms.length > 0 && <p className="mt-2 flex flex-wrap gap-1.5" aria-label="Matched words">{row.matchedTerms.slice(0, 6).map(term => <span key={term} className="rounded border px-1.5 text-[11px] font-medium">{term}</span>)}</p>}
      <div className="mt-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold" aria-hidden="true">{initials(row.source)}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span className="font-semibold">{row.source}</span><span className="text-xs text-muted-foreground">{publishedLabel(row.publishedAt)}</span></p>
          {row.snippet ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{row.snippet}</p>
            : <p className="mt-2 text-sm text-muted-foreground">No preview from the source. Open the original to read it.</p>}
        </div>
      </div>
      {row.alsoCoveredBy.length > 0 && <section className="mt-5" aria-label="Also covered by">
        <h3 className="text-sm font-semibold">Also covered by</h3>
        <ul className="mt-1">{row.alsoCoveredBy.map(entry => <li key={entry.url}>
          <a className="inline-flex min-h-9 items-center gap-1.5 break-all py-1 text-sm underline-offset-2 hover:underline" href={entry.url} target="_blank" rel="noopener noreferrer">
            {entry.source}<span className="sr-only"> (opens in a new tab)</span><ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        </li>)}</ul>
      </section>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={onDraft} disabled={saving} data-testid={`button-news-draft-${row.id}`}><Reply className="mr-2 h-4 w-4" aria-hidden="true" />Draft my take</Button>
        {state ? <span className="inline-flex h-10 items-center gap-1.5 rounded-md border bg-muted/40 px-3 text-sm" role="status" data-testid={`text-news-state-${row.id}`}>
            <Star className={cn("h-4 w-4", row.inInbox?.status === "saved" && "fill-warning text-warning")} aria-hidden="true" />{state}
          </span>
          : <Button variant="outline" onClick={onSave} disabled={saving} data-testid={`button-news-save-${row.id}`}><Star className="mr-2 h-4 w-4" aria-hidden="true" />{saving ? "Saving…" : "Save to Shortlist"}</Button>}
        <Button variant="outline" asChild><a href={row.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />Open original<span className="sr-only"> (opens in a new tab)</span></a></Button>
      </div>
      {row.inInbox?.status === "dismissed" && <p className="mt-3 text-xs text-muted-foreground">You marked this story not relevant earlier. Saving moves it to your Shortlist.</p>}
      <p className="mt-4 text-xs text-muted-foreground">Found by keyword search. Relevance to your topics hasn’t been scored.</p>
    </article>
  </>;
}
