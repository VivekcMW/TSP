import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Clock3, Database, RefreshCw, Server, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";

type QueueCounts = Record<"waiting" | "active" | "completed" | "failed" | "delayed" | "paused", number>;
interface Failure { id: string; tenantName: string; platform?: string; errorMessage?: string | null; startedAt?: string | null; }
interface PlatformMonitoring { generatedAt: string; tenantCount: number; queue: { configured: boolean; reachable: boolean; queuesReady: boolean }; scheduler: { enabled: boolean; designated: boolean }; jobs: { inbox: QueueCounts; publishing: QueueCounts }; scheduled: number; publishing: number; failed: number; overdue: number; recentFailures: Failure[]; engineFailures: Failure[]; }

function HealthBadge({ healthy, children }: Readonly<{ healthy: boolean; children: string }>) {
  return <Badge variant={healthy ? "default" : "destructive"} className="gap-1.5">{healthy ? <Activity className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{children}</Badge>;
}

function StatCard({ label, value, icon: Icon, tone = "default" }: Readonly<{ label: string; value: string | number; icon: typeof Activity; tone?: "default" | "danger" }>) {
  return <Card className={tone === "danger" ? "border-destructive/30 bg-destructive/[0.03]" : ""}><CardContent className="flex items-center justify-between p-5"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div><Icon className={`h-5 w-5 ${tone === "danger" ? "text-destructive" : "text-secondary"}`} /></CardContent></Card>;
}

export default function AdminMonitoringPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery<PlatformMonitoring>({ queryKey: ["/api/admin/monitoring"], refetchInterval: 30_000 });
  const queueHealthy = Boolean(data?.queue.configured && data.queue.reachable && data.queue.queuesReady);
  const schedulerHealthy = Boolean(data?.scheduler.enabled && data.scheduler.designated);
  const attentionCount = (data?.failed ?? 0) + (data?.overdue ?? 0);
  const allFailures = [...(data?.recentFailures ?? []), ...(data?.engineFailures ?? [])].slice(0, 10);

  return <div className="flex h-full flex-col overflow-hidden">
    <PageHeader icon={Activity} title="Platform Monitoring" subtitle="Cross-tenant infrastructure, publishing, and engine health" actions={<Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>} />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {isError ? <Card><CardContent className="p-0"><AdminQueryError onRetry={() => refetch()} message="Platform monitoring could not be loaded." /></CardContent></Card> : isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{["queue", "scheduler", "scheduled", "failures"].map((key) => <Card key={key}><CardContent className="h-24 animate-pulse p-5" /></Card>)}</div> : <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Redis queue</p><div className="mt-2"><HealthBadge healthy={queueHealthy}>{queueHealthy ? "Healthy" : data?.queue.configured ? "Unavailable" : "Not configured"}</HealthBadge></div></div><Server className="h-5 w-5 text-secondary" /></CardContent></Card>
            <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Scheduler</p><div className="mt-2"><HealthBadge healthy={schedulerHealthy}>{schedulerHealthy ? "Active" : data?.scheduler.enabled ? "Not designated" : "Disabled"}</HealthBadge></div></div><Clock3 className="h-5 w-5 text-secondary" /></CardContent></Card>
            <StatCard label="Tenants monitored" value={data?.tenantCount ?? 0} icon={Database} />
            <StatCard label="Needs attention" value={attentionCount} icon={AlertTriangle} tone={attentionCount > 0 ? "danger" : "default"} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Scheduled" value={data?.scheduled ?? 0} icon={Clock3} /><StatCard label="Publishing" value={data?.publishing ?? 0} icon={Activity} /><StatCard label="Overdue" value={data?.overdue ?? 0} icon={AlertTriangle} tone={(data?.overdue ?? 0) > 0 ? "danger" : "default"} /><StatCard label="Failed schedules" value={data?.failed ?? 0} icon={XCircle} tone={(data?.failed ?? 0) > 0 ? "danger" : "default"} /></div>
          <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Queue workload</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Inbox waiting", data?.jobs.inbox.waiting], ["Inbox active", data?.jobs.inbox.active], ["Publish waiting", data?.jobs.publishing.waiting], ["Publish failed", data?.jobs.publishing.failed]].map(([label, value]) => <div key={label} className="rounded-md border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Engine workload</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Completed inbox jobs</span><span className="font-semibold">{data?.jobs.inbox.completed ?? 0}</span></div><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Failed engine runs</span><span className="font-semibold text-destructive">{data?.engineFailures.length ?? 0}</span></div><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Last refreshed</span><span className="text-xs text-muted-foreground">{data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : "—"}</span></div></CardContent></Card></div>
          <Card><CardHeader><CardTitle className="text-base">Recent platform failures</CardTitle></CardHeader><CardContent>{allFailures.length === 0 ? <p className="text-sm text-muted-foreground">No recent publishing or engine failures across monitored tenants.</p> : <div className="space-y-3">{allFailures.map((failure) => <div key={`${failure.id}-${failure.tenantName}`} className="flex items-start justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="text-sm font-medium">{failure.platform ? `${failure.platform} publishing failure` : "Engine run failure"}</p><p className="text-xs text-muted-foreground">Tenant: {failure.tenantName}</p><p className="mt-1 truncate text-xs text-destructive">{failure.errorMessage ?? "No failure reason recorded"}</p></div><span className="shrink-0 text-xs text-muted-foreground">{failure.startedAt ? new Date(failure.startedAt).toLocaleString() : "—"}</span></div>)}</div>}</CardContent></Card>
        </>}
      </div>
    </main>
  </div>;
}
