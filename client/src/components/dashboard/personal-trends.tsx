import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsSignedIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import type { PersonalTrend } from "@shared/article-quality";

function velocityLabel(trend: PersonalTrend) {
  if (trend.velocityPercent === null) return "New in this window";
  const sign = trend.velocityPercent > 0 ? "+" : "";
  return `${sign}${trend.velocityPercent}% versus previous 7 days`;
}

export function PersonalTrends() {
  const signedIn = useIsSignedIn();
  const [open, setOpen] = useState(false);
  const trends = useQuery<PersonalTrend[]>({ queryKey: ["/api/trends"], enabled: !!signedIn && open });
  if (!signedIn) return null;
  return <section className="shrink-0 border-b bg-muted/30 px-4 py-2" aria-label="Personal article trends">
    <Button variant="ghost" size="sm" aria-expanded={open} aria-controls="personal-trends" onClick={() => setOpen(!open)}>Topics in your recent articles</Button>
    {open && <div id="personal-trends" className="max-h-52 overflow-y-auto space-y-2 py-2 text-sm">
      <p className="text-xs text-muted-foreground">Your admitted articles: last 7 days versus the previous 7, including saved and dismissed. At most the first 5,000 scored admissions in those windows. Limited by refreshes and inbox capacity—not market trends.</p>
      {trends.isLoading && <p>Loading topics…</p>}
      {trends.isError && <p>Topics unavailable. <Button variant="ghost" onClick={() => void trends.refetch()}>Retry topics</Button></p>}
      {!trends.isLoading && !trends.isError && !trends.data?.length && <p>No topics with at least two newly discovered articles yet.</p>}
      {!trends.isLoading && !trends.isError && !!trends.data?.length &&
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{trends.data.map(trend => <li key={trend.topic} className="rounded-md border bg-card p-3">
          <p className="font-medium">{trend.topic} <span className="font-normal text-muted-foreground">· {trend.count} articles</span></p>
          <p className="text-xs text-muted-foreground">{velocityLabel(trend)} · {trend.sourceCount} known source{trend.sourceCount === 1 ? "" : "s"}{trend.unknownSourceCount > 0 ? ` · ${trend.unknownSourceCount} unknown origins` : ""}</p>
          {trend.windowStart && trend.windowEnd && <p className="text-xs text-muted-foreground">Discovery window (UTC): {trend.windowStart.slice(0, 10)} – {trend.windowEnd.slice(0, 10)}</p>}
          {trend.coverage.partial && <p className="text-xs text-muted-foreground">Partial coverage: first {trend.coverage.rowLimit} admitted rows in the two windows.</p>}
          <ul>{trend.articles.map(article => <li key={article.link}><a className="inline-block max-w-full truncate text-xs underline" href={article.link} target="_blank" rel="noopener noreferrer">{article.title}<span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>
        </li>)}</ul>}
    </div>}
  </section>;
}