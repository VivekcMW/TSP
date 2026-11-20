import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, Building2, Clock3, LayoutDashboard, RefreshCw, Server } from "lucide-react";
import type { AdminMonitoring } from "@shared/admin";
import { useIsSignedIn } from "@/lib/dev-auth";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { ExecutionHealth } from "@/components/admin/execution-health";

export default function AdminOverviewPage() {
  const signedIn = useIsSignedIn();
  const { data, isLoading, isError, isFetching, refetch } = useQuery<AdminMonitoring>({
    queryKey: ["/api/admin/monitoring"],
    queryFn: async ({ signal }) => (await apiRequest("GET", "/api/admin/monitoring", undefined,
      { signal, cache: "no-store", headers: { "x-access-reason": "Review platform operational health" } })).json(),
    enabled: signedIn, refetchInterval: 60_000, staleTime: 30_000,
  });
  const queueReady = !!data && data.queue.configured && data.queue.reachable && data.queue.queuesReady;
  const schedulerEligible = !!data && data.scheduler.enabled && data.scheduler.designated && data.scheduler.production;
  const failures = data ? [
    ...data.recentFailures.map(row => ({ ...row, category: "Publishing attempt" })),
    ...data.engineFailures.map(row => ({ ...row, category: "Discovery run" })),
  ].sort((a, b) => (b.startedAt ? Date.parse(b.startedAt) : 0) - (a.startedAt ? Date.parse(a.startedAt) : 0)).slice(0, 10) : [];
  return <div className="flex h-full flex-col overflow-hidden">
    <PageHeader icon={LayoutDashboard} title="Command Center" subtitle="Operational signals, affected workspaces and the next safe investigation." actions={
      <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh health</Button>
    } />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        {isError ? <Card><CardContent className="p-0"><AdminQueryError onRetry={() => refetch()} message="Operational health could not be loaded. Platform health is unknown, not healthy." /></CardContent></Card>
          : isLoading ? <div role="status" className="grid gap-4 sm:grid-cols-3"><span className="sr-only">Loading platform health</span>{[1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}</div>
          : data && <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2"><Badge variant={data.environment === "production" ? "warning" : "info"}>Environment: {data.environment}</Badge><span className="text-xs text-muted-foreground">{data.tenantCount} workspaces inspected</span></div>
              <p className="text-xs text-muted-foreground">Fetched {new Date(data.generatedAt).toLocaleString()} - refreshes every minute</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4 text-primary" />Queue infrastructure</CardTitle></CardHeader><CardContent className="space-y-3">
                <Badge variant={queueReady ? "success" : "warning"}>{queueReady ? "Connected and ready" : data.queue.configured ? "Unavailable or incomplete" : "Not configured"}</Badge>
                <p className="text-sm text-muted-foreground">Connection and queue readiness only; not a guarantee that every worker is progressing.</p>
              </CardContent></Card>
              <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-primary" />Scheduler configuration</CardTitle></CardHeader><CardContent className="space-y-3">
                <Badge variant={schedulerEligible ? "info" : "secondary"}>{schedulerEligible ? "Production gates enabled" : "Automatic scheduling disabled"}</Badge>
                <p className="text-sm text-muted-foreground">{schedulerEligible ? "Configuration allows scheduling. Last successful execution is not yet tracked here." : "Requires production mode, background jobs enabled and a designated scheduler process."}</p>
              </CardContent></Card>
              <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary" />Publishing workload</CardTitle></CardHeader><CardContent>
                <p className="text-2xl font-semibold">{data.scheduled.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">scheduled or queued</span></p>
                <p className="mt-3 text-sm text-muted-foreground">{data.publishing.toLocaleString()} schedules in publishing state. Stored workflow state is not proof of provider delivery.</p>
              </CardContent></Card>
            </div>
            <ExecutionHealth execution={data.execution} />
            <Card><CardHeader><CardTitle className="text-base">Needs investigation</CardTitle></CardHeader><CardContent className="space-y-3">
              {!queueReady && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"><div><p className="font-medium">Queue readiness is unavailable</p><p className="text-sm text-muted-foreground">Review infrastructure before attempting operational recovery.</p></div><Button variant="outline" asChild><Link href="/admin/monitoring">Inspect monitoring</Link></Button></div>}
              {data.overdue > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning p-4"><div><p className="font-medium">{data.overdue} overdue schedules</p><p className="text-sm text-muted-foreground">Scheduled or queued more than five minutes past their intended time.</p></div><Button variant="outline" asChild><Link href="/admin/monitoring">Inspect overdue workload</Link></Button></div>}
              {data.failed > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"><div><p className="font-medium">{data.failed} failed schedules</p><p className="text-sm text-muted-foreground">Retained failure states may include historical issues. Investigate before retrying.</p></div><Button variant="outline" asChild><Link href="/admin/tenants">Find affected workspace</Link></Button></div>}
              {queueReady && data.overdue === 0 && data.failed === 0 && <p className="text-sm text-muted-foreground">No queue-readiness, overdue-schedule or failed-schedule signals in this snapshot. This is not a complete platform health certification.</p>}
            </CardContent></Card>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card><CardHeader><CardTitle className="text-base">Queue backlog</CardTitle></CardHeader><CardContent>
                {queueReady ? <dl className="grid grid-cols-2 gap-4">{[
                  ["Discovery waiting", data.jobs.inbox?.waiting ?? "Unavailable"], ["Discovery active", data.jobs.inbox?.active ?? "Unavailable"],
                  ["Publishing waiting", data.jobs.publishing?.waiting ?? "Unavailable"], ["Publishing active", data.jobs.publishing?.active ?? "Unavailable"],
                ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value.toLocaleString()}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">Backlog is unavailable. Missing queues are not represented as zero work.</p>}
              </CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-primary" />Customer investigation</CardTitle></CardHeader><CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">Search workspaces and open an audited, read-only view of membership, onboarding, billing records and recent workflow activity.</p>
                <Button asChild><Link href="/admin/tenants">Find a workspace</Link></Button>
                <p className="text-xs text-muted-foreground">Email delivery, provider health and revenue trends are not measured in this command-center release.</p>
              </CardContent></Card>
            </div>
            {data.tenantSignals.length > 0 && <Card><CardHeader><CardTitle className="text-base">Affected workspaces</CardTitle></CardHeader><CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Up to 25 workspaces, ordered by overdue schedules then failed schedules. Counts are retained current states.</p>
              <ul className="divide-y">{data.tenantSignals.map(tenant => <li key={tenant.tenantId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0"><p className="break-words font-medium">{tenant.tenantName}</p><p className="text-sm text-muted-foreground">{tenant.overdue} overdue / {tenant.failed} failed schedules</p></div>
                <Button variant="outline" asChild><Link href={`/admin/tenants/${tenant.tenantId}`}>Investigate workspace</Link></Button>
              </li>)}</ul>
            </CardContent></Card>}
            <Card><CardHeader><CardTitle className="text-base">Recent recorded failures</CardTitle></CardHeader><CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Latest 10 from bounded retained discovery and publishing attempt logs; not a list of confirmed unresolved incidents. Times use your browser timezone.</p>
              {failures.length ? <ul className="divide-y">{failures.map(failure => <li key={`${failure.category}-${failure.id}`} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0"><p className="font-medium">{failure.category} failed</p><p className="break-words text-sm text-muted-foreground">{failure.tenantName}</p><p className="break-all text-xs text-muted-foreground">Record {failure.id}</p><p className="text-xs text-muted-foreground">{failure.startedAt ? new Date(failure.startedAt).toLocaleString() : "Start time not recorded"}</p></div>
                <Button variant="outline" asChild><Link href={`/admin/tenants/${failure.tenantId}`}>Investigate workspace</Link></Button>
              </li>)}</ul> : <p className="text-sm text-muted-foreground">No recorded failures in the returned sample.</p>}
            </CardContent></Card>
          </>}
      </div>
    </main>
  </div>;
}
