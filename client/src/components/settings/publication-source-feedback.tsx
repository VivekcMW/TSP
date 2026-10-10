import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { PublicationSourceStatus } from "@shared/publication-preferences";

const statusLabels: Record<PublicationSourceStatus["status"], string> = {
  "needs-url": "URL needed",
  pending: "Pending",
  checking: "Checking",
  failed: "Failed",
  connected: "Connected",
  paused: "Paused",
  removed: "Removed",
};

/** Reads saved resolution results only; never starts discovery or crawls a URL. */
export function PublicationSourceFeedback() {
  const { data = [], isLoading, isError, isFetching, refetch } = useQuery<PublicationSourceStatus[]>({
    queryKey: ["/api/sources/publications"],
    retry: false,
    refetchInterval: false,
  });

  let feedback: ReactNode;
  if (isLoading) {
    feedback = <output className="text-sm text-muted-foreground">Loading publication status…</output>;
  } else if (isError) {
    feedback = <p role="alert" className="text-sm text-destructive">Publication status unavailable. Refresh publication status to try again.</p>;
  } else if (data.length === 0) {
    feedback = <p className="text-sm text-muted-foreground">No publication status yet.</p>;
  } else {
    feedback = <ul className="space-y-3" aria-label="Publication resolution results">
      {data.map((item) => <li key={item.name} className="text-sm [overflow-wrap:anywhere]">
        <p><span className="font-medium">{item.name}</span> — {statusLabels[item.status]}</p>
        {item.url && <p className="text-xs text-muted-foreground">{item.url}</p>}
        <p className="text-xs text-muted-foreground">{item.message}</p>
        {item.lastAttemptAt && <p className="text-xs text-muted-foreground">Last attempt: <time dateTime={item.lastAttemptAt}>{item.lastAttemptAt}</time></p>}
      </li>)}
    </ul>;
  }

  return <section aria-label="Publication source status" className="space-y-3 border-t pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">Publication source status</h3>
      <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>Refresh publication status</Button>
    </div>
    <p className="text-xs text-muted-foreground">Saved results from Discover refreshes. Refreshing this status does not crawl sites. A connected source does not verify publisher identity. Manage paused or removed sources in Custom Sources.</p>
    {feedback}
  </section>;
}