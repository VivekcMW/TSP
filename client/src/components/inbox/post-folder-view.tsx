import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, CalendarDays, Copy, ExternalLink, Pencil, Trash2, XCircle } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useToast } from "@/hooks/use-toast";
import { usePostRows } from "@/hooks/use-post-rows";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useComposer } from "@/components/inbox/composer";
import { useInboxShell } from "@/components/inbox/inbox-shell";
import { apiRequest } from "@/lib/queryClient";
import { ignoreInboxShortcut } from "@/lib/inbox-shortcuts";
import { cancelLinkedInSchedule, scheduleLabel } from "@/lib/linkedin-compose";
import { canChangeSchedule, invalidatePublishingQueries, publishingStatus } from "@/lib/publishing";
import { postsIn, type PostRow } from "@/lib/post-folders";
import { cn } from "@/lib/utils";
import type { PostFolder } from "@shared/inbox-view";

const FOLDERS: Record<PostFolder, { title: string; note: string; empty: string }> = {
  drafts: { title: "Drafts", note: "Saved posts. Continue one in the composer and post it in one click.", empty: "No drafts. Press Compose, or draft your take on a story." },
  scheduled: { title: "Scheduled", note: "Posts waiting to send to LinkedIn. Nothing posts before its time.", empty: "Nothing scheduled. Use the arrow next to Post to pick a time." },
  posted: { title: "Posted", note: "Posts LinkedIn confirmed, plus demo runs marked Demo only (those were never sent).", empty: "Nothing posted yet." },
  outbox: { title: "Outbox", note: "Delivery failed or isn't confirmed. Check LinkedIn before trying again so nothing is posted twice.", empty: "Nothing needs attention." },
};
const PLATFORM_NAMES: Record<string, string> = { linkedin: "LinkedIn", twitter: "X", x: "X", facebook: "Facebook", instagram: "Instagram", threads: "Threads", bluesky: "Bluesky", mastodon: "Mastodon" };
const platformName = (platform: string) => PLATFORM_NAMES[platform] ?? platform;
const contentHref = (id: string) => `/dashboard/content?draft=${encodeURIComponent(id)}`;
const firstLine = (text: string) => text.trim().split(/\n+/)[0] ?? "";
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

function listTime(at: number, folder: PostFolder, now = new Date()): string {
  if (!at) return "";
  const date = new Date(at);
  if (folder === "scheduled") return date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", ...(at - now.getTime() > 6 * 86_400_000 ? { month: "short", day: "numeric", weekday: undefined } : {}) });
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "2-digit" }) });
}

/** Gmail's Drafts / Scheduled / Sent / Outbox for your LinkedIn posts. Full controls stay in Content. */
export function PostFolderView({ folder }: Readonly<{ folder: PostFolder }>) {
  const signedIn = Boolean(useIsSignedIn());
  const { query } = useInboxShell();
  const { rows: all, drafts, schedules } = usePostRows(signedIn, true);
  const rows = useMemo(() => postsIn(all, folder, query), [all, folder, query]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);
  useEffect(() => { setReadingOpen(false); setSelectedId(null); }, [folder]);
  const selected = rows.find(row => row.draft.id === selectedId) ?? null;
  useEffect(() => { if (!selected && rows.length) setSelectedId(rows[0].draft.id); }, [selected, rows]);
  const info = FOLDERS[folder];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ignoreInboxShortcut(event) || !["j", "k", "o", "u"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "u") { setReadingOpen(false); return; }
      if (event.key === "o") { if (selected) setReadingOpen(true); return; }
      const index = rows.findIndex(row => row.draft.id === selectedId);
      const next = rows[Math.max(0, Math.min(rows.length - 1, (index < 0 ? -1 : index) + (event.key === "j" ? 1 : -1)))];
      if (!next) return;
      setSelectedId(next.draft.id);
      setReadingOpen(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="row-post-${CSS.escape(next.draft.id)}"]`)?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedId, selected]);

  const loading = drafts.isLoading || schedules.isLoading;
  return (
    <main className="flex h-full min-h-0" aria-label={info.title}>
      <section aria-label={`${info.title} list`} data-inbox-list className={cn("min-h-0 min-w-0 flex-col border-r lg:flex lg:w-[min(46%,36rem)] lg:shrink-0", readingOpen ? "hidden" : "flex w-full")}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <h2 className="text-sm font-semibold">{info.title}</h2>
          <Link href="/dashboard/content" className="ml-2 text-xs font-medium text-primary hover:underline">All content</Link>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">{loading ? "Loading…" : rows.length ? `1–${rows.length} of ${rows.length}` : "0"}</span>
        </div>
        <p className="shrink-0 border-b px-4 py-2.5 text-xs text-muted-foreground">{info.note}</p>
        {schedules.isError && <p role="alert" className="flex shrink-0 items-start gap-2 border-b bg-warning-subtle px-4 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />Delivery status couldn’t be loaded, so these folders may be incomplete. Check Content before posting again.
        </p>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? <div className="space-y-px" aria-label="Loading">{[0, 1, 2].map(index => <div key={index} className="space-y-2 border-b p-4"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-4 w-4/5" /></div>)}</div>
            : drafts.isError ? <div role="alert" className="p-6 text-sm"><p className="font-medium">Your posts could not be loaded.</p><Button variant="outline" className="mt-3" onClick={() => void drafts.refetch()}>Try again</Button></div>
            : rows.length ? <ul aria-label={`${info.title} posts`}>{rows.map(row => {
                const isSelected = row.draft.id === selected?.draft.id;
                const status = row.schedule && folder !== "drafts" ? publishingStatus(row.schedule) : null;
                return <li key={row.draft.id} className={cn("border-b", isSelected && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                  <button type="button" onClick={() => { setSelectedId(row.draft.id); setReadingOpen(true); }} aria-current={isSelected ? "true" : undefined}
                    className="block w-full px-4 py-2.5 text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" data-testid={`row-post-${row.draft.id}`}>
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {folder === "drafts" ? <span className="font-medium text-destructive">Draft</span> : status ? <span className={cn("font-medium", status.key === "attention" ? "text-warning" : "text-muted-foreground")}>{status.label}</span> : null}
                        {row.draft.platform !== "linkedin" && <span className="ml-2 rounded border px-1.5 text-[11px] font-medium">{platformName(row.draft.platform)}</span>}
                      </span>
                      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{listTime(row.at, folder)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-semibold">{firstLine(row.draft.content) || "(No text)"}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.draft.content.trim().split(/\n+/).slice(1).join(" ")}</span>
                  </button>
                </li>;
              })}</ul>
            : <div className="flex flex-col items-center px-6 py-14 text-center">
                <h3 className="text-base font-semibold">{query.trim() ? "No matching posts" : `No ${info.title.toLowerCase()}`}</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">{query.trim() ? "Try another search." : info.empty}</p>
              </div>}
        </div>
      </section>
      <section aria-label="Reading pane" className={cn("min-h-0 min-w-0 flex-1 flex-col lg:flex", readingOpen ? "flex" : "hidden")}>
        {selected ? <PostPane key={selected.draft.id} row={selected} folder={folder} schedulesReady={schedules.isSuccess} onBack={() => setReadingOpen(false)} />
          : <div className="m-auto max-w-sm px-6 text-center text-sm text-muted-foreground"><p className="font-medium text-foreground">{info.title}</p><p className="mt-1">{info.note}</p></div>}
      </section>
    </main>
  );
}

function PostPane({ row, folder, schedulesReady, onBack }: Readonly<{ row: PostRow; folder: PostFolder; schedulesReady: boolean; onBack: () => void }>) {
  const composer = useComposer();
  const { toast } = useToast();
  const [working, setWorking] = useState(false);
  const { draft, schedule } = row;
  const linkedin = draft.platform === "linkedin";
  const status = schedule && folder !== "drafts" ? publishingStatus(schedule) : null;
  const failure = schedule?.lastError ?? schedule?.targets?.find(target => target.lastError)?.lastError ?? null;

  const run = async (action: () => Promise<void>, success: { title: string; description?: string }, fallback: string) => {
    setWorking(true);
    try { await action(); toast(success); }
    catch (error) { toast({ title: fallback, description: message(error, "Try again, or use Content."), variant: "destructive" }); }
    finally { setWorking(false); void invalidatePublishingQueries(); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(draft.content); toast({ title: "Post text copied" }); }
    catch { toast({ title: "Couldn't copy", description: "Select the text and copy it instead.", variant: "destructive" }); }
  };

  const meta: ReactNode = folder === "drafts" ? `Last saved ${row.at ? scheduleLabel(new Date(row.at)) : "—"}`
    : folder === "scheduled" ? <>Sends {schedule ? <span className="font-semibold text-foreground">{scheduleLabel(new Date(schedule.scheduledPublishAt))}</span> : "at the scheduled time"}</>
    : status ? <span className={cn("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium", status.className)}><span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} aria-hidden="true" />{status.label}</span>
    : null;

  return <>
    <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2" aria-label="Post actions">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Back to list" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Button>
      <Button variant="ghost" size="icon" aria-label="Copy post text" title="Copy post text" onClick={() => void copy()}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
      <Link href={contentHref(draft.id)} className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" data-testid={`link-content-${draft.id}`}>
        Open in Content<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
    <article className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded border px-1.5 font-medium text-foreground">{platformName(draft.platform)}</span>{meta}
      </p>
      {folder === "outbox" && <div role="alert" className="mt-4 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm">
        <p className="font-medium">Delivery needs checking</p>
        <p className="mt-1 text-muted-foreground">{failure ?? "LinkedIn did not confirm this post."} Check your LinkedIn profile before retrying in Content, so it is not posted twice.</p>
      </div>}
      {status?.key === "simulated" && <p className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Demo only: publishing was in sandbox mode, so nothing was sent to LinkedIn.</p>}
      <div className="mt-4 rounded-md border bg-background p-4">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-testid="text-post-content">{draft.content}</p>
      </div>
      <p className="mt-2 text-right text-[11px] tabular-nums text-muted-foreground">{draft.content.length.toLocaleString()} characters</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {folder === "drafts" && (linkedin
          ? <Button onClick={() => composer.openDraft(draft)} data-testid="button-continue-draft"><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Continue in composer</Button>
          : <Button asChild><Link href={contentHref(draft.id)}>Edit in Content</Link></Button>)}
        {folder === "drafts" && <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="outline" disabled={working}><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Discard draft</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Discard this draft?</AlertDialogTitle><AlertDialogDescription>It is deleted permanently. This can’t be undone.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Keep draft</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(async () => { await apiRequest("DELETE", `/api/drafts/${encodeURIComponent(draft.id)}`); }, { title: "Draft discarded" }, "Couldn't discard the draft")}>Discard</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>}
        {folder === "scheduled" && schedulesReady && canChangeSchedule(schedule) && <Button variant="outline" disabled={working} data-testid="button-cancel-schedule"
          onClick={() => void run(() => cancelLinkedInSchedule(draft.id), { title: "Schedule cancelled", description: "Nothing was sent. The post is back in Drafts." }, "Couldn't cancel the schedule")}>
          <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />Cancel schedule
        </Button>}
        {folder === "scheduled" && <Button variant="outline" asChild><Link href="/dashboard/calendar"><CalendarDays className="mr-2 h-4 w-4" aria-hidden="true" />Open Calendar</Link></Button>}
        {folder === "outbox" && <Button asChild><Link href={contentHref(draft.id)}>Review in Content</Link></Button>}
        {folder === "posted" && <Button variant="outline" onClick={() => void copy()}><Copy className="mr-2 h-4 w-4" aria-hidden="true" />Copy text</Button>}
      </div>
      {folder === "scheduled" && schedulesReady && !canChangeSchedule(schedule) && <p className="mt-3 text-xs text-muted-foreground">This post is already sending, so it can’t be cancelled here. Check its status in Content.</p>}
    </article>
  </>;
}
