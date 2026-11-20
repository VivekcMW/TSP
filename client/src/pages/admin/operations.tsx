import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity } from "lucide-react";
import type { AdminIncident, AdminJobRecord, AdminOperationalHealth, AdminQuotaGrant, AdminTenantInsights } from "@shared/admin-controls";
import { quotaGrantSchema } from "@shared/admin-controls";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export default function AdminOperationsPage() {
  const [reason, setReason] = useState("");
  const [queue, setQueue] = useState<"inbox" | "publishing">("inbox");
  const [state, setState] = useState("failed");
  const [page, setPage] = useState(1);
  const [incidentPage, setIncidentPage] = useState(1);
  const [recovery, setRecovery] = useState<AdminJobRecord | null>(null);
  const [message, setMessage] = useState("");
  const headers = { "x-access-reason": reason.trim() };
  const health = useQuery<AdminOperationalHealth>({ queryKey: ["/api/admin/operations/health"],
    queryFn: async ({ signal }) => (await apiRequest("GET", "/api/admin/operations/health", undefined, { signal, cache: "no-store", headers: { "x-access-reason": "Review operational liveness" } })).json(), refetchInterval: 30_000 });
  const jobs = useQuery<{ items: AdminJobRecord[]; page: number; hasMore: boolean }>({ queryKey: ["/api/admin/operations/jobs", queue, state, page],
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/operations/jobs?queue=${queue}&state=${state}&page=${page}`, undefined,
      { signal, cache: "no-store", headers: { "x-access-reason": "Investigate retained background jobs" } })).json() });
  const incidents = useQuery<{ items: AdminIncident[]; hasMore: boolean }>({ queryKey: ["/api/admin/operations/incidents", incidentPage],
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/operations/incidents?page=${incidentPage}`, undefined,
      { signal, cache: "no-store", headers: { "x-access-reason": "Review platform incidents" } })).json(), refetchInterval: 30_000 });
  const action = useMutation({
    mutationFn: async (input: { path: string; body: object; tenant?: string; method?: string }) =>
      (await apiRequest(input.method ?? "POST", input.path, input.body, { headers: { ...headers, ...(input.tenant ? { "x-tenant-id": input.tenant } : {}) } })).json(),
    onSuccess: result => {
      setMessage(result.outcome ? `Observed recovery state: ${result.outcome}. Admission is not completion; refresh to verify progress.` : "Control state saved. Refresh observations to verify.");
      setRecovery(null); void jobs.refetch(); void incidents.refetch(); void health.refetch();
    },
    onError: (error: Error) => setMessage(`Action not confirmed: ${error.message} Inspect the same record before retrying.`),
  });
  return <div className="flex h-full flex-col overflow-hidden"><PageHeader icon={Activity} title="Operations" subtitle="Observed health, persistent incidents and conservative retained-job recovery." />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl space-y-5">
      <Card><CardContent className="space-y-2 p-5"><Label htmlFor="operation-reason">Reason for control changes</Label><Input id="operation-reason" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
        <p className="text-xs text-muted-foreground">All actions are audited. Never enter credentials. Payments, publications and unknown email outcomes are investigation-only.</p>
        {message && <p role="status" className="break-words text-sm">{message}</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Worker and queue observations</CardTitle></CardHeader><CardContent className="space-y-3">
        {health.isError ? <AdminQueryError onRetry={() => health.refetch()} message="Operational health unavailable." /> : !health.data ? <p role="status">Loading health...</p> : <>
          <p>{health.data.expected ? "Production workers expected" : "Automatic production health enforcement is inactive in this environment"}</p>
          <p>Queue: {health.data.queue.reachable && health.data.queue.queuesReady ? "reachable and initialized" : "unavailable or uninitialized"}</p>
          <p className="text-xs text-muted-foreground">Worker heartbeats expire after 60 seconds and are written every 15 seconds after handler registration. They show a responsive process, not successful jobs.</p>
          {(["inbox", "publishing"] as const).map(kind => <div key={kind} className="rounded-md border p-3">
            <p className="font-medium">{kind}: {health.data!.workers.available ? `${health.data!.workers[kind]} recent worker processes` : "worker observations unavailable"}</p>
            <p className="text-sm text-muted-foreground">{health.data!.ages?.[kind].available ? health.data!.ages[kind].oldestMs === null ? "No waiting jobs observed" : `Oldest ${health.data!.ages[kind].complete ? "observed" : "sampled"} waiting age: ${Math.floor(health.data!.ages[kind].oldestMs! / 60_000)} minutes` : "Waiting age unavailable"}</p>
          </div>)}
          <p className="text-xs text-muted-foreground">Waiting scans cover at most 5,000 retained jobs and can race queue movement. Incomplete scans never establish a healthy full backlog.</p>
        </>}
        <Button variant="outline" disabled={health.isFetching} onClick={() => health.refetch()}>Refresh health</Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>In-app incidents</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">No external alerts. Evaluation uses required queues, observed worker absence, waiting work over fifteen minutes and failed/stale scheduler cycles. A manually resolved active signal will reopen on the next evaluation.</p>
        <Button variant="outline" disabled={!reason.trim() || action.isPending} onClick={() => action.mutate({ path: "/api/admin/operations/evaluate", body: { confirm: true } })}>Evaluate current signals</Button>
        {incidents.isError ? <AdminQueryError onRetry={() => incidents.refetch()} message="Incident history unavailable." /> : !incidents.data ? <p role="status">Loading incidents...</p> : <>
          {!incidents.data.items.length && <p>No retained incidents on this page. This is not proof of healthy infrastructure.</p>}
          <ul className="divide-y">{incidents.data.items.map(incident => <li key={incident.id} className="space-y-2 py-4">
            <p className="break-words font-medium">{incident.summary}</p><p className="text-sm">{incident.severity} / {incident.state} / Last observed {new Date(incident.lastSeenAt).toLocaleString()}</p>
            <div className="flex flex-wrap gap-2">{incident.state === "open" && <Button variant="outline" disabled={!reason.trim() || action.isPending} onClick={() => action.mutate({ path: `/api/admin/operations/incidents/${incident.id}`, method: "PATCH", body: { state: "acknowledged", version: incident.version } })}>Acknowledge incident</Button>}
              {incident.state !== "resolved" && <Button variant="outline" disabled={!reason.trim() || action.isPending} onClick={() => action.mutate({ path: `/api/admin/operations/incidents/${incident.id}`, method: "PATCH", body: { state: "resolved", version: incident.version } })}>Resolve incident</Button>}</div>
          </li>)}</ul>
          <div className="flex gap-2"><Button variant="outline" disabled={incidentPage <= 1 || incidents.isFetching} onClick={() => setIncidentPage(value => value - 1)}>Previous incidents</Button><Button variant="outline" disabled={incidentPage >= 10000 || !incidents.data.hasMore || incidents.isFetching} onClick={() => setIncidentPage(value => value + 1)}>Next incidents</Button></div>
        </>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Retained jobs</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3"><div className="space-y-2"><Label htmlFor="jobs-queue">Queue</Label><select id="jobs-queue" value={queue} onChange={event => { setQueue(event.target.value === "inbox" ? "inbox" : "publishing"); setPage(1); }} className="h-11 rounded-md border bg-background px-3"><option value="inbox">Discovery</option><option value="publishing">Publishing (read-only)</option></select></div>
          <div className="space-y-2"><Label htmlFor="jobs-state">Job state</Label><select id="jobs-state" value={state} onChange={event => { setState(event.target.value); setPage(1); }} className="h-11 rounded-md border bg-background px-3">{["failed", "waiting", "active", "delayed"].map(value => <option key={value}>{value}</option>)}</select></div>
          <Button variant="outline" disabled={jobs.isFetching} onClick={() => jobs.refetch()}>Refresh jobs</Button>
        </div>
        {jobs.isError ? <AdminQueryError onRetry={() => jobs.refetch()} message="Retained jobs unavailable." /> : !jobs.data ? <p role="status">Loading jobs...</p> : <>
          {!jobs.data.items.length && <p>No retained jobs on this page. Expired evidence cannot be recovered.</p>}
          <ul className="divide-y">{jobs.data.items.map(job => <li key={job.id} className="space-y-2 py-4">
            <p className="break-all font-mono text-sm">{job.id}</p><p className="text-sm">{job.state} / {job.attemptsMade} attempts / Created {new Date(job.createdAt).toLocaleString()}</p>
            <Link href={`/admin/tenants/${job.tenantId}`} className="inline-flex min-h-11 items-center break-all text-primary underline">Investigate workspace {job.tenantId}</Link>
            {job.recoveryEligible && <Button className="ml-2" variant="outline" disabled={!reason.trim() || action.isPending} onClick={() => setRecovery(job)}>Review discovery recovery</Button>}
          </li>)}</ul>
          <div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || jobs.isFetching} onClick={() => setPage(value => value - 1)}>Previous jobs</Button><Button variant="outline" disabled={page >= 10000 || !jobs.data.hasMore || jobs.isFetching} onClick={() => setPage(value => value + 1)}>Next jobs</Button></div>
        </>}
      </CardContent></Card>
      <RollupDirectory reason={reason} />
      <TenantControls reason={reason} />
    </div></main>
    <AlertDialog open={!!recovery} onOpenChange={open => { if (!open) setRecovery(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Recover this discovery operation?</AlertDialogTitle><AlertDialogDescription>Only the retained job and its original operation identity are reused. The existing two-reservation recovery budget applies. No new payment, publication or email operation is created. Admission does not prove completion.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={action.isPending || !reason.trim()} onClick={event => { event.preventDefault(); if (recovery?.operationId) action.mutate({ path: `/api/admin/operations/jobs/inbox/${encodeURIComponent(recovery.id)}/recover`, tenant: recovery.tenantId, body: { tenantId: recovery.tenantId, operationId: recovery.operationId, confirm: true } }); }}>Confirm discovery recovery</AlertDialogAction>
    </AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function RollupDirectory({ reason }: { reason: string }) {
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const result = useQuery<{ items: { tenantId: string; name: string; inboxItems: number | null; drafts: number | null; engineRuns: number | null; failedSchedules: number | null; observedAt: string | null }[]; hasMore: boolean; total: number; staleAfterMinutes: number }>({
    queryKey: ["/api/admin/operations/rollups", page],
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/operations/rollups?page=${page}`, undefined,
      { signal, cache: "no-store", headers: { "x-access-reason": "Review count-only workspace observations" } })).json(),
  });
  const refresh = useMutation({
    mutationFn: async (tenantId: string) => (await apiRequest("POST", `/api/admin/operations/rollups/${tenantId}/refresh`, { confirm: true },
      { headers: { "x-access-reason": reason.trim(), "x-tenant-id": tenantId } })).json(),
    onSuccess: () => { setMessage("Workspace snapshot persisted."); void result.refetch(); },
    onError: (error: Error) => setMessage(`Snapshot not confirmed: ${error.message}`),
  });
  return <Card><CardHeader><CardTitle>Count-only workspace read model</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-xs text-muted-foreground">Durable snapshots avoid customer-table scans during directory reads. Automatic collection requires ADMIN_ROLLUPS_ENABLED and production scheduler gates. Missing or older-than-30-minute snapshots do not imply zero usage.</p>
    {message && <p role="status">{message}</p>}
    {result.isError ? <AdminQueryError onRetry={() => result.refetch()} message="Workspace read model unavailable." /> : !result.data ? <p role="status">Loading workspace observations...</p> : <>
      <p className="text-sm">{result.data.total} workspaces / Page {page}</p>
      <ul className="divide-y">{result.data.items.map(row => <li key={row.tenantId} className="space-y-2 py-3">
        <Link className="inline-flex min-h-11 items-center break-all text-primary underline" href={`/admin/tenants/${row.tenantId}`}>{row.name}</Link>
        <p className="text-sm">Articles {row.inboxItems ?? "unavailable"} / Drafts {row.drafts ?? "unavailable"} / Runs {row.engineRuns ?? "unavailable"} / Failed schedules {row.failedSchedules ?? "unavailable"}</p>
        <p className="text-xs text-muted-foreground">{row.observedAt ? `${Date.now() - Date.parse(row.observedAt) > 30 * 60_000 ? "Stale" : "Observed"} ${new Date(row.observedAt).toLocaleString()}` : "Never observed"}</p>
        <Button variant="outline" disabled={!reason.trim() || refresh.isPending} onClick={() => refresh.mutate(row.tenantId)}>Refresh workspace snapshot</Button>
      </li>)}</ul>
      <div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || result.isFetching} onClick={() => setPage(value => value - 1)}>Previous observations</Button><Button variant="outline" disabled={page >= 10000 || !result.data.hasMore || result.isFetching} onClick={() => setPage(value => value + 1)}>Next observations</Button></div>
    </>}
  </CardContent></Card>;
}

function TenantControls({ reason }: { reason: string }) {
  const [tenant, setTenant] = useState("");
  const [target, setTarget] = useState<{ tenant: string; reason: string } | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [additional, setAdditional] = useState("10");
  const [expiresAt, setExpiresAt] = useState("");
  const [notice, setNotice] = useState("");
  const headers = target ? { "x-tenant-id": target.tenant, "x-access-reason": target.reason } : undefined;
  const insight = useQuery<AdminTenantInsights>({
    queryKey: ["/api/admin/operations/insights", target], enabled: !!target, gcTime: 0,
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/operations/insights/${target!.tenant}`, undefined, { signal, headers, cache: "no-store" })).json(),
  });
  const grants = useQuery<AdminQuotaGrant[]>({
    queryKey: ["/api/admin/operations/quotas", target], enabled: !!target, gcTime: 0,
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/operations/quotas/${target!.tenant}`, undefined, { signal, headers, cache: "no-store" })).json(),
  });
  const mutation = useMutation({
    mutationFn: async (id?: string) => {
      if (!target) throw new Error("Open a workspace investigation");
      const expiry = new Date(expiresAt);
      if (!id && !Number.isFinite(expiry.getTime())) throw new Error("Choose a valid expiry");
      const body = id ? { confirm: true } : quotaGrantSchema.parse({ operationId, additional: Number(additional), expiresAt: expiry.toISOString() });
      return (await apiRequest("POST", `/api/admin/operations/quotas/${target.tenant}${id ? `/${id}/revoke` : ""}`, body, { headers })).json();
    },
    onSuccess: () => { setNotice("Allowance record saved. Existing paid plan and consumed operations are unchanged."); void grants.refetch(); },
    onError: (error: Error) => setNotice(`Allowance not confirmed: ${error.message} Reuse the same operation ID and inspect records before creating another intent.`),
  });
  const data = insight.isError ? undefined : insight.data;
  return <Card><CardHeader><CardTitle>Workspace billing, quality and allowance controls</CardTitle></CardHeader><CardContent className="space-y-4">
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (reason.trim() && /^[0-9a-f-]{36}$/i.test(tenant.trim())) setTarget({ tenant: tenant.trim(), reason: reason.trim() }); else setNotice("Enter a workspace UUID and an investigation reason."); }}>
      <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="insight-tenant">Workspace UUID</Label><Input id="insight-tenant" value={tenant} onChange={event => setTenant(event.target.value)} required /></div><Button type="submit" disabled={!reason.trim()}>Open workspace controls</Button>
    </form>
    {notice && <p role="status" className="break-words text-sm">{notice}</p>}
    {insight.isError && <AdminQueryError onRetry={() => insight.refetch()} message="Workspace insights unavailable." />}
    {data && <>
      <p className="text-xs text-muted-foreground">Last 30 days since {new Date(data.windowStart).toLocaleString()}. No live provider reconciliation. Monetary currencies remain separate. Counts are retained observations, not inferred revenue or customer outcomes.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2 rounded-md border p-4"><h3 className="font-medium">Stored payment states</h3>{data.payments.length ? <ul>{data.payments.map(row => <li key={`${row.currency}:${row.status}`} className="text-sm">{row.currency} / {row.status}: {row.count} payments, {row.minorUnits} minor units</li>)}</ul> : <p className="text-sm">No retained payments in window.</p>}</section>
        <section className="space-y-2 rounded-md border p-4"><h3 className="font-medium">Generation attempts</h3>{data.generation.length ? <ul>{data.generation.map(row => <li key={row.status} className="text-sm">{row.status}: {row.count}</li>)}</ul> : <p className="text-sm">No retained attempts in window.</p>}<p className="text-xs text-muted-foreground">Started means in progress or unknown, never safe automatic replay.</p></section>
        <section className="space-y-2 rounded-md border p-4"><h3 className="font-medium">Content coverage</h3><p className="text-sm">{data.content.articles} discovered records / {data.content.fresh} published within 48 hours / {data.content.qualityMeasured} quality metadata records</p><p className="text-sm">{data.content.canonicalIdentified} identified URLs / {data.content.distinctCanonicals} distinct across workspace accounts</p><p className="text-sm">Average stored relevance: {data.content.averageRelevance ?? "unavailable"}</p><p className="text-xs text-muted-foreground">Shared URLs across users are not necessarily erroneous duplicates. Relevance scores are policy, not verified quality.</p></section>
        <section className="space-y-2 rounded-md border p-4"><h3 className="font-medium">Source fetch and feedback signals</h3><ul>{data.sourceStates.map(row => <li key={`${row.active}:${row.status}`} className="text-sm">{row.active ? "Enabled" : "Inactive"} / {row.status ?? "unobserved"}: {row.count} sources</li>)}{data.feedback?.map(row => <li key={row.event} className="text-sm">{row.event}: {row.count} feedback events</li>)}</ul>{data.feedback === null && <p role="status" className="text-sm">Feedback measurement unavailable: migration 0053 requires reviewed ledger reconciliation.</p>}<p className="text-xs text-muted-foreground">Source state is current, not a historical fetch success rate. Feedback events are not unique drafts or a satisfaction score.</p></section>
      </div>
      <section className="space-y-2 rounded-md border p-4"><h3 className="font-medium">Measured AI provider attempts</h3><p className="text-xs text-muted-foreground">Telemetry must be enabled separately. Failed/unscoped/unrecorded attempts may be absent. Costs are only provider-reported USD, not price estimates, complete spend or unit economics.</p>
        {data.ai.length ? <ul className="divide-y">{data.ai.map(row => <li key={`${row.provider}:${row.model}:${row.outcome}`} className="space-y-1 py-3"><p className="break-all text-sm">{row.provider} / {row.model ?? "model unavailable"} / {row.outcome}: {row.count} attempts, average {row.averageMs}ms</p><p className="text-xs text-muted-foreground">Tokens observed for {row.tokenObserved}/{row.count}: input {row.inputTokens ?? "unavailable"}, output {row.outputTokens ?? "unavailable"}. Cost observed for {row.costObserved}/{row.count}: {row.providerCostUsd ?? "unavailable"} USD.</p></li>)}</ul> : <p className="text-sm">No measured AI attempts. This is not zero usage or zero cost.</p>}
      </section>
    </>}
    {target && <section className="space-y-3 border-t pt-4"><h3 className="font-medium">Temporary additional generation allowance</h3><p className="break-words text-xs text-muted-foreground">Opened workspace: {target.tenant}. Captured investigation reason: {target.reason}. Reopen workspace controls to change this context.</p><p className="text-xs text-muted-foreground">Adds to finite, valid generation limits only. Does not unlock a denied plan, alter a paid plan or charge the customer. Active additions are capped at 1,000 and expire within 30 days. Existing consumption is never reset. The addition applies in each normal allowance period while active.</p>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="quota-additional">Additional attempts per allowance period</Label><Input id="quota-additional" type="number" min={1} max={1000} value={additional} onChange={event => setAdditional(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="quota-expiry">Allowance expiry (local time)</Label><Input id="quota-expiry" type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></div></div>
      <p className="break-all text-xs text-muted-foreground">Stable request: {operationId}</p>
      <div className="flex flex-wrap gap-2"><Button disabled={mutation.isPending || !expiresAt || !reason.trim()} onClick={() => mutation.mutate(undefined)}>Confirm additional allowance</Button><Button variant="outline" disabled={mutation.isPending} onClick={() => { setOperationId(crypto.randomUUID()); setNotice("New request identity prepared. Check existing grants first; a new identity creates an additional grant."); }}>Prepare a distinct grant intent</Button></div>
      {grants.isError ? <AdminQueryError onRetry={() => grants.refetch()} message="Allowance records unavailable." /> : grants.data && <ul className="divide-y">{grants.data.map(grant => <li key={grant.id} className="space-y-2 py-3"><p className="text-sm">+{grant.additional} / {grant.revokedAt ? "revoked" : new Date(grant.expiresAt).getTime() <= Date.now() ? "expired" : "active"} / expires {new Date(grant.expiresAt).toLocaleString()}</p><p className="break-all text-xs text-muted-foreground">{grant.id} / {grant.reason}</p>{!grant.revokedAt && <Button variant="outline" disabled={mutation.isPending || !reason.trim()} onClick={() => mutation.mutate(grant.id)}>Revoke allowance</Button>}</li>)}</ul>}
    </section>}
  </CardContent></Card>;
}
