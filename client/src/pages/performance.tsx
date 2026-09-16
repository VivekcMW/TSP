import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Eye, FileText, Send, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { getPlatformMeta } from "@/lib/platforms";
import type { Draft } from "@shared/schema";

interface AnalyticsSummary { combined: { impressions: number; engagements: number; engagementRate: number }; }

function Metric({ label, value, icon: Icon }: Readonly<{ label: string; value: string | number; icon: typeof BarChart3 }>) {
  return <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">{label}</p><p className="font-serif text-2xl font-semibold tracking-tight">{value}</p></div><Icon className="h-5 w-5 text-muted-foreground" /></CardContent></Card>;
}

export default function PerformancePage() {
  const [rangeDays, setRangeDays] = useState(30);
  const { data: drafts = [], isLoading } = useQuery<Draft[]>({ queryKey: ["/api/drafts"] });
  const { data: summary } = useQuery<AnalyticsSummary>({ queryKey: ["/api/analytics/summary"] });
  const published = useMemo(() => drafts.filter((draft) => {
    if (draft.publishStatus !== "published" || !draft.publishedAt) return false;
    const age = Date.now() - new Date(draft.publishedAt).getTime();
    return age >= 0 && age <= rangeDays * 86_400_000;
  }), [drafts, rangeDays]);
  const activity = useMemo(() => Array.from({ length: rangeDays }, (_, index) => { const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (rangeDays - 1 - index)); const next = new Date(day); next.setDate(next.getDate() + 1); return { day: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }), published: published.filter((draft) => draft.publishedAt && new Date(draft.publishedAt) >= day && new Date(draft.publishedAt) < next).length }; }), [published, rangeDays]);
  const platforms = useMemo(() => { const counts = new Map<string, number>(); published.forEach((draft) => counts.set(draft.platform, (counts.get(draft.platform) ?? 0) + 1)); return Array.from(counts, ([platform, posts]) => ({ platform: getPlatformMeta(platform).label, posts })); }, [published]);
  const chartMetrics = [{ label: "Reach", value: summary?.combined.impressions ?? 0 }, { label: "Engagement", value: summary?.combined.engagements ?? 0 }];
  return <div className="flex h-full flex-col overflow-hidden"><PageHeader icon={TrendingUp} title="Performance" subtitle="See how your published content is performing" actions={<div className="flex rounded-md border bg-muted/30 p-1">{[7, 30, 90].map((days) => <Button key={days} size="sm" variant={rangeDays === days ? "secondary" : "ghost"} onClick={() => setRangeDays(days)}>{days}d</Button>)}</div>} /><main className="flex-1 overflow-y-auto p-6"><div className="mx-auto max-w-6xl space-y-6">{isLoading ? <p className="text-muted-foreground">Loading performance…</p> : <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Published posts" value={published.length} icon={Send} /><Metric label="Drafts in progress" value={drafts.filter((draft) => draft.publishStatus !== "published").length} icon={FileText} /><Metric label="Impressions" value={summary?.combined.impressions ?? 0} icon={Eye} /><Metric label="Engagement rate" value={`${summary?.combined.engagementRate ?? 0}%`} icon={BarChart3} /></section>{published.length === 0 ? <DashboardEmptyState icon={TrendingUp} title="Your first post is the baseline" description="Publish one post, then return here to see your consistency and engagement trend." /> : <><section className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Publishing consistency</CardTitle></CardHeader><CardContent className="h-60"><ResponsiveContainer width="100%" height="100%"><LineChart data={activity}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" /><YAxis allowDecimals={false} /><Tooltip /><Line dataKey="published" stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Reach and engagement</CardTitle></CardHeader><CardContent className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartMetrics}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></CardContent></Card></section><section><h2 className="mb-4 font-serif text-xl font-semibold">Published by platform</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{platforms.map((item) => <Card key={item.platform}><CardContent className="flex justify-between p-4"><span className="text-sm">{item.platform}</span><span className="font-semibold">{item.posts} posts</span></CardContent></Card>)}</div></section></>}</>}</div></main></div>;
}
