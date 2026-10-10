import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BarChart3, FileText, Send, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { getPlatformMeta } from "@/lib/platforms";
import { buildPublishingActivity } from "@/lib/publishing-activity";
import type { Draft } from "@shared/schema";
import { ANALYTICS_FIELDS, analyticsDisplayMetric, normalizeAnalytics, type AnalyticsSummary } from "@shared/analytics-availability";

function Metric({ label, value, icon: Icon }: Readonly<{ label: string; value: string | number; icon: typeof BarChart3 }>) {
  return <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">{label}</p><p className="font-serif text-2xl font-semibold tracking-tight">{value}</p></div><Icon className="h-5 w-5 text-muted-foreground" /></CardContent></Card>;
}

export default function PerformancePage() {
  const [rangeDays, setRangeDays] = useState(30);
  const draftsQuery = useQuery<Draft[]>({ queryKey: ["/api/drafts"] });
  const summaryQuery = useQuery<AnalyticsSummary>({ queryKey: ["/api/analytics/summary"] });
  const validDrafts = Array.isArray(draftsQuery.data) && draftsQuery.data.every(draft => draft && typeof draft.publishStatus === "string" && typeof draft.platform === "string");
  const drafts = validDrafts ? draftsQuery.data! : [];
  const now = new Date();
  const { start, published, activity, platforms, missingDates } = buildPublishingActivity(drafts, rangeDays, now);
  const summary = summaryQuery.data;
  const validSummary = summary && typeof summary.connected?.linkedin === "boolean" && typeof summary.connected?.twitter === "boolean";
  const connected = summary?.connected?.linkedin || summary?.connected?.twitter;
  const displayMetrics = ANALYTICS_FIELDS.map(field => ({ field, ...analyticsDisplayMetric(field, summary?.combined?.[field], summary?.availability?.[field], now) }));
  const hasEngagement = displayMetrics.some(item => ["impressions", "engagements", "engagementRate", "likes", "comments", "shares", "clicks"].includes(item.field) && item.value !== null);
  const partialEngagement = displayMetrics.some(item => ["impressions", "engagements", "engagementRate", "likes", "comments", "shares", "clicks"].includes(item.field) && (item.coverage?.measuredAccounts ?? 0) > 0);
  const unavailableEngagementLabel = partialEngagement ? "Engagement coverage incomplete" : "Engagement data unavailable";

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <PageHeader icon={TrendingUp} title="Performance" subtitle="Publishing activity recorded in this workspace" actions={
        <fieldset className="flex rounded-md border bg-muted/30 p-1" aria-label="Publishing date range">
          {[7, 30, 90].map((days) => <Button key={days} size="sm" aria-pressed={rangeDays === days} aria-label={`Last ${days} calendar days`} variant={rangeDays === days ? "secondary" : "ghost"} onClick={() => setRangeDays(days)}>{days}d</Button>)}
        </fieldset>
      } />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl space-y-6">
        <p className="text-sm text-muted-foreground">{start.toLocaleDateString()} – {now.toLocaleDateString()} · Local timezone · Today through now. The date filter applies only to publishing activity.</p>
        {draftsQuery.isLoading && <output>Loading publishing activity…</output>}
        {!draftsQuery.isLoading && (draftsQuery.isError || !validDrafts) && (
          <Card><CardContent className="p-5" role="alert"><p>Couldn't load publishing activity. Counts are unavailable, not zero.</p><Button variant="outline" className="mt-3" onClick={() => void draftsQuery.refetch()}>Retry activity</Button></CardContent></Card>
        )}
        {!draftsQuery.isLoading && !draftsQuery.isError && validDrafts && <>
          <section className="grid gap-4 sm:grid-cols-2">
            <Metric label={`Published records · ${rangeDays} days`} value={published.length} icon={Send} />
            <Metric label="Drafts ready to edit · all dates" value={drafts.filter((draft) => draft.publishStatus === "draft").length} icon={FileText} />
          </section>
          <p className="text-xs text-muted-foreground">Based on your loaded draft records in this workspace (up to 500), not a complete account history. Each live published draft counts once; simulated publishing and individual multi-platform deliveries are not counted separately.</p>
          {missingDates > 0 && <p className="text-sm text-muted-foreground">{missingDates} published record{missingDates === 1 ? " has" : "s have"} no valid publication date and cannot be included in this date range.</p>}
          {published.length === 0 ? <Card><CardContent className="p-6"><h2 className="font-medium">No published records in this period</h2><p className="mt-2 text-sm text-muted-foreground">Try a wider range, or review a draft when you're ready to publish. Publishing activity is separate from provider engagement measurement.</p><Link href="/dashboard/drafts" className="mt-3 inline-block text-sm underline">Review drafts</Link></CardContent></Card> : <>
            <Card className="min-w-0"><CardHeader><CardTitle className="text-base">Publishing consistency</CardTitle></CardHeader><CardContent>
              <div className="h-60 min-w-0 w-full" role="img" aria-label={`${published.length} published records across the last ${rangeDays} calendar days`}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}><LineChart data={activity}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" /><YAxis allowDecimals={false} width={32} /><Tooltip /><Line dataKey="published" name="Published records" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
              </div>
              <details className="mt-3 text-sm"><summary className="cursor-pointer">View daily counts</summary><ul className="mt-2 grid gap-1 sm:grid-cols-3">{activity.map((day) => <li key={day.day}>{day.day}: {day.published}</li>)}</ul></details>
            </CardContent></Card>
            <section><h2 className="mb-3 font-serif text-xl font-semibold">Published by draft platform · {rangeDays} days</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{platforms.map((item) => <Card key={item.platform}><CardContent className="flex justify-between gap-3 p-4"><span className="text-sm">{getPlatformMeta(item.platform).label}</span><span className="font-semibold">{item.posts}</span></CardContent></Card>)}</div></section>
          </>}
        </>}
        <Card><CardHeader><CardTitle className="text-base">Audience and engagement</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground">
          {summaryQuery.isLoading && <output>Checking analytics availability…</output>}
          {!summaryQuery.isLoading && (summaryQuery.isError || !validSummary) && <div role="alert"><p>Couldn't check analytics availability. This is not a zero-engagement result.</p><Button className="mt-2" size="sm" variant="outline" onClick={() => void summaryQuery.refetch()}>Retry analytics</Button></div>}
          {!summaryQuery.isLoading && !summaryQuery.isError && validSummary && <>
            <p className="font-medium text-foreground">{hasEngagement ? "Available engagement measurements" : unavailableEngagementLabel}</p>
            {!hasEngagement && !partialEngagement && <p>{connected ? "Connecting an account does not enable engagement measurement. LinkedIn sync currently refreshes profile details only; X engagement collection is not implemented." : "No LinkedIn or X analytics account is connected. Connecting enables supported publishing features, not engagement measurement."}</p>}
            {partialEngagement && !hasEngagement && <p>Some provider measurements are available below, but cannot be presented as a complete combined total.</p>}
            <p>Stored legacy zero-filled snapshots are placeholders, not measured zeroes. Unverified values remain unknown. Profile sync is not a measurement timestamp. The summary uses latest snapshots, not the selected date range.</p>
            <ul className="space-y-2" aria-label="Analytics metric availability">{displayMetrics.map(({ field, value, measuredAt, reason, coverage }) => <li key={field}>
              <span className="font-medium text-foreground">{field.replaceAll(/([A-Z])/g, " $1")}: </span>
              {value !== null ? <>{value}{field === "engagementRate" ? "%" : ""} · Measured <time dateTime={measuredAt!}>{measuredAt}</time> (UTC)</> : <>Unavailable · {reason?.replaceAll("_", " ") ?? "unverified"}</>}
              {coverage && <span> · {coverage.measuredAccounts}/{coverage.expectedAccounts} connected accounts measured</span>}
            </li>)}</ul>
            {(["linkedin", "twitter"] as const).map(provider => {
              const raw = summary[provider];
              if (!raw) return null;
              const data = normalizeAnalytics({ metrics: raw.metrics, metricAvailability: raw.availability }, now);
              return <div key={provider}><p>{provider === "linkedin" ? "LinkedIn" : "X"}: {data.supportedFields.length ? `Supported fields: ${data.supportedFields.join(", ")}` : "No supported metric fields in this snapshot"}.</p>
                {Object.values(data.availability).some(item => item.reason === "fetch_failed") && <span role="alert"> Snapshot lookup failed. Other provider results are unaffected. <Button size="sm" variant="outline" onClick={() => void summaryQuery.refetch()}>Retry analytics</Button></span>}
                {data.supportedFields.length > 0 && <ul aria-label={`${provider} supported metrics`}>{data.supportedFields.map(field => <li key={field}>
                  {field}: {data.metrics[field] !== null ? <>{data.metrics[field]}{field === "engagementRate" ? "%" : ""} · Measured <time dateTime={data.availability[field].measuredAt!}>{data.availability[field].measuredAt}</time> (UTC)</> : <>Unavailable · {data.availability[field].reason?.replaceAll("_", " ")}</>}
                  {data.availability[field].period && <span> · Period {data.availability[field].period!.start} – {data.availability[field].period!.end} (UTC, end exclusive)</span>}
                </li>)}</ul>}
              </div>;
            })}
          </>}
        </CardContent></Card>
      </div></main>
    </div>
  );
}
