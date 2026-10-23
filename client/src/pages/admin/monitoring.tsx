import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, RefreshCw } from "lucide-react";
import type { AdminMonitoring } from "@shared/admin";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { ExecutionHealth } from "@/components/admin/execution-health";

export default function AdminMonitoringPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery<AdminMonitoring>({
    queryKey: ["/api/admin/monitoring"], refetchInterval: 30_000,
    queryFn: async ({ signal }) => (await apiRequest("GET", "/api/admin/monitoring", undefined,
      { signal, cache: "no-store", headers: { "x-access-reason": "Review platform monitoring signals" } })).json(),
  });
  const queueReady = !!data && data.queue.configured && data.queue.reachable && data.queue.queuesReady;
  const schedulerEligible = !!data && data.scheduler.enabled && data.scheduler.designated && data.scheduler.production;
  const failures = data ? [
    ...data.recentFailures.map(row => ({ ...row, category: "Publishing attempt" })),
    ...data.engineFailures.map(row => ({ ...row, category: "Discovery run" })),
  ].sort((a, b) => (b.startedAt ? Date.parse(b.startedAt) : 0) - (a.startedAt ? Date.parse(a.startedAt) : 0)).slice(0, 25) : [];
  return <div className="flex h-full flex-col overflow-hidden">
    <PageHeader icon={Activity} title="Platform Monitoring" subtitle="Queue readiness, scheduling configuration and recorded failures." actions={
      <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    } />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        {isError ? <AdminQueryError onRetry={() => refetch()} message="Platform monitoring could not be loaded. Current health is unknown." />
          : isLoading ? <p role="status">Loading monitoring...</p> : data && <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="info">Environment: {data.environment}</Badge>
              <Badge variant={queueReady ? "success" : "warning"}>Queues: {queueReady ? "connected and ready" : "unavailable or unconfigured"}</Badge>
              <Badge variant={schedulerEligible ? "info" : "secondary"}>Scheduler: {schedulerEligible ? "production gates enabled" : "disabled by configuration"}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{data.tenantCount} workspaces inspected. Fetched {new Date(data.generatedAt).toLocaleString()}; refreshes every 30 seconds. Scheduler configuration is not a successful-execution heartbeat.</p>
            <ExecutionHealth execution={data.execution} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[["Scheduled or queued", data.scheduled], ["Publishing", data.publishing], ["Overdue by more than 5 minutes", data.overdue], ["Failed schedules", data.failed]].map(([label, value]) => <Card key={label}><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value.toLocaleString()}</p></CardContent></Card>)}
            </div>
            <Card><CardHeader><CardTitle className="text-base">Queue workload</CardTitle></CardHeader><CardContent>
              <p className="mb-4 text-xs text-muted-foreground">Queue counts describe retained jobs, not confirmed customer outcomes. Missing queue data is unavailable, never zero.</p>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[
                ["Inbox waiting", data.jobs.inbox?.waiting ?? "Unavailable"], ["Inbox active", data.jobs.inbox?.active ?? "Unavailable"],
                ["Inbox failed", data.jobs.inbox?.failed ?? "Unavailable"], ["Inbox completed", data.jobs.inbox?.completed ?? "Unavailable"],
                ["Publish waiting", data.jobs.publishing?.waiting ?? "Unavailable"], ["Publish active", data.jobs.publishing?.active ?? "Unavailable"],
                ["Publish failed", data.jobs.publishing?.failed ?? "Unavailable"], ["Publish completed", data.jobs.publishing?.completed ?? "Unavailable"],
              ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold">{value.toLocaleString()}</dd></div>)}</dl>
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Recent recorded failures</CardTitle></CardHeader><CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Up to 25 records from bounded retained attempt logs, including historical failures. Raw provider errors and payloads are intentionally excluded.</p>
              {failures.length ? <ul className="divide-y">{failures.map(failure => <li key={`${failure.category}-${failure.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0"><p className="font-medium">{failure.category} failed{failure.platform ? ` (${failure.platform})` : ""}</p><p className="break-words text-sm text-muted-foreground">{failure.tenantName}</p><p className="break-all text-xs text-muted-foreground">Record {failure.id}</p><p className="text-xs text-muted-foreground">{failure.startedAt ? new Date(failure.startedAt).toLocaleString() : "Start not recorded"}</p></div>
                <Button variant="outline" asChild><Link href={`/admin/tenants/${failure.tenantId}`}>Investigate workspace</Link></Button>
              </li>)}</ul> : <p className="text-sm text-muted-foreground">No failures in the returned sample.</p>}
            </CardContent></Card>
          </>}
      </div>
    </main>
  </div>;
}
