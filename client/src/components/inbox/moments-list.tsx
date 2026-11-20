import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { localDate, momentsQuery, shortDate, whenLabel } from "@/lib/moments-queries";

/**
 * Upcoming industry moments for the person (GET /api/moments): a compact "Coming up" list.
 * Renders nothing while loading, on error or when there are none. `onDraft` receives a suggested angle
 * so callers can open the composer.
 */
export function UpcomingMoments({ days = 60, limit = 5, onDraft }: Readonly<{ days?: number; limit?: number; onDraft?: (angle: string) => void }>) {
  const today = localDate();
  const { data } = useQuery(momentsQuery(days, today));
  const moments = (data ?? []).slice(0, Math.max(0, limit));
  if (!moments.length) return null;
  return (
    <section aria-labelledby="upcoming-moments-heading" className="min-w-0" data-testid="upcoming-moments">
      <h3 id="upcoming-moments-heading" className="text-sm font-semibold">Coming up</h3>
      <ul className="mt-1 divide-y">
        {moments.map(moment => (
          <li key={moment.id} className="min-w-0 py-2" data-testid={`moment-${moment.id}`}>
            <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-muted-foreground">
              <time dateTime={moment.date}>{shortDate(moment.date)}{moment.endDate && moment.endDate !== moment.date ? ` – ${shortDate(moment.endDate)}` : ""}</time>
              <span>{whenLabel(moment, today)}</span>
            </p>
            <p className="mt-0.5 text-sm font-medium [overflow-wrap:anywhere]">{moment.title}</p>
            {moment.inLeadWindow && <Badge variant="info" className="mt-1">Good time to post</Badge>}
            {(onDraft || moment.url) && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {onDraft && <Button type="button" size="sm" variant="outline" onClick={() => onDraft(moment.suggestedAngle)} data-testid={`button-draft-moment-${moment.id}`}>
                Draft a post<span className="sr-only"> about {moment.title}</span>
              </Button>}
              {moment.url && <a href={moment.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-8 items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Details<span className="sr-only"> about {moment.title} (opens in a new tab)</span><ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>}
            </div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
