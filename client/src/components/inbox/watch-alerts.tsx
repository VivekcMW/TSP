import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { markWatchAlertsSeen, WATCH_ALERTS_KEY, watchAlertsQuery, type WatchAlertView } from "@/lib/moments-queries";

/**
 * Stories that mention someone on the person's watchlist, unseen first. Renders nothing while loading,
 * on error or when there are none. With `onOpenStory` the headline opens the story in the Inbox;
 * otherwise it links to the article. Opening an alert marks it seen.
 */
export function WatchAlertsList({ limit = 10, onOpenStory }: Readonly<{ limit?: number; onOpenStory?: (inboxItemId: string) => void }>) {
  const cache = useQueryClient();
  const { data } = useQuery(watchAlertsQuery());
  const seen = useMutation({
    mutationFn: markWatchAlertsSeen,
    onMutate: ids => {
      const at = new Date().toISOString();
      cache.setQueryData<WatchAlertView[]>(WATCH_ALERTS_KEY, rows => rows?.map(row => !row.seenAt && (ids === "all" || ids.includes(row.id)) ? { ...row, seenAt: at } : row));
    },
    onSettled: () => cache.invalidateQueries({ queryKey: WATCH_ALERTS_KEY }),
  });
  const alerts = (data ?? []).slice(0, Math.max(0, limit));
  if (!alerts.length) return null;
  const unseen = alerts.filter(alert => !alert.seenAt).length;
  const open = (alert: WatchAlertView) => { if (!alert.seenAt) seen.mutate([alert.id]); };
  return (
    <section aria-labelledby="watch-alerts-heading" className="min-w-0" data-testid="watch-alerts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="watch-alerts-heading" className="text-sm font-semibold">Watchlist{unseen ? <> <span className="font-normal text-muted-foreground">({unseen} new)</span></> : null}</h3>
        {unseen > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => seen.mutate("all")} data-testid="button-watch-alerts-seen">Mark all as seen</Button>}
      </div>
      <ul className="mt-1 divide-y">
        {alerts.map(alert => (
          <li key={alert.id} className="min-w-0 py-2" data-testid={`watch-alert-${alert.id}`}>
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {!alert.seenAt && <span className="mr-1 font-semibold text-foreground">New ·</span>}Mentions {alert.term} · {alert.source}
            </p>
            {onOpenStory
              ? <button type="button" onClick={() => { open(alert); onOpenStory(alert.inboxItemId); }}
                className={cn("mt-0.5 rounded-sm text-left text-sm [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", !alert.seenAt && "font-semibold")}>
                {alert.headline}
              </button>
              : <a href={alert.articleUrl} target="_blank" rel="noopener noreferrer" onClick={() => open(alert)}
                className={cn("mt-0.5 inline-flex items-start gap-1 rounded-sm text-sm [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", !alert.seenAt && "font-semibold")}>
                {alert.headline}<span className="sr-only"> (opens in a new tab)</span><ExternalLink className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />
              </a>}
          </li>
        ))}
      </ul>
    </section>
  );
}
