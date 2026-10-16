import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PersonalTrend } from "@shared/article-quality";

function velocityLabel(trend: PersonalTrend) {
  if (trend.velocityPercent === null) return "New topic compared with the previous 7 days";
  if (trend.velocityPercent === 0) return "Same article count as the previous 7 days";
  return `${Math.abs(trend.velocityPercent)}% ${trend.velocityPercent > 0 ? "more" : "fewer"} articles than the previous 7 days`;
}

export function PersonalTrends() {
  const signedIn = useIsSignedIn();
  const [open, setOpen] = useState(false);
  const trends = useQuery<PersonalTrend[]>({ queryKey: ["/api/trends"], enabled: !!signedIn && open });
  if (!signedIn) return null;
  return <Popover open={open} onOpenChange={setOpen}>
    <div className="min-w-0 max-w-full" aria-label="Personal article trends">
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-controls="personal-trends">
          Topics in your recent articles
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
    </div>
    <PopoverContent id="personal-trends" aria-labelledby="personal-trends-heading" align="start" collisionPadding={16} className="z-50 max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-md border bg-card p-4 shadow-md space-y-3 text-sm">
      <div className="space-y-1">
        <h2 id="personal-trends-heading" className="font-medium">Topics in your recent articles</h2>
        <p className="text-xs text-muted-foreground">See which subjects appear in your discovered articles to help choose your next post topic.</p>
        <p className="text-xs text-muted-foreground">Counts cover the last 7 days. Changes compare with the previous 7 days.</p>
      </div>
      {trends.isLoading && <p role="status">Loading topics…</p>}
      {trends.isError && <p role="alert">Topics unavailable. <Button variant="ghost" onClick={() => void trends.refetch()}>Retry topics</Button></p>}
      {!trends.isLoading && !trends.isError && !trends.data?.length && <p>No topics with at least two newly discovered articles yet.</p>}
      {!trends.isLoading && !trends.isError && !!trends.data?.length &&
        <ul aria-label="Recent article topics" className="divide-y">{trends.data.map(trend => <li key={trend.topic} className="space-y-1 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 break-words font-medium">{trend.topic}</p>
            <p className="text-xs text-muted-foreground">{trend.count} {trend.count === 1 ? "article" : "articles"} in the last 7 days</p>
          </div>
          <p className="text-xs text-muted-foreground">{velocityLabel(trend)}</p>
          <p className="text-xs text-muted-foreground">{trend.sourceCount} known source{trend.sourceCount === 1 ? "" : "s"}{trend.unknownSourceCount > 0 ? ` · ${trend.unknownSourceCount} unknown origins` : ""}</p>
          {trend.windowStart && trend.windowEnd && <p className="text-xs text-muted-foreground">Discovery window (UTC): {trend.windowStart.slice(0, 10)} – {trend.windowEnd.slice(0, 10)}</p>}
          {trend.coverage.partial && <p className="text-xs text-muted-foreground">Partial coverage: first {trend.coverage.rowLimit} admitted rows in the two windows.</p>}
          {trend.articles.length > 0 && <div>
            <p className="text-xs font-medium">Example articles</p>
            <ul>{trend.articles.map(article => <li key={article.link}><a className="flex min-h-8 items-center break-words py-1 text-xs underline max-md:min-h-11 [@media(any-pointer:coarse)]:min-h-11" href={article.link} target="_blank" rel="noopener noreferrer">{article.title}<span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>
          </div>}
        </li>)}</ul>}
      <p className="border-t pt-3 text-xs text-muted-foreground">Based on articles discovered for you, including saved and dismissed articles—not market trends or post performance. Coverage depends on refreshes and inbox capacity, with at most the first 5,000 scored articles across both periods.</p>
    </PopoverContent>
  </Popover>;
}