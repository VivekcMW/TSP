import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "wouter";
import { Building2 } from "lucide-react";
import type { TenantOverview } from "@shared/admin";
import { useIsSignedIn } from "@/lib/dev-auth";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdminQueryError } from "@/components/admin/admin-query-error";

export default function AdminTenantDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  return <TenantInvestigation key={id} id={id} />;
}

function TenantInvestigation({ id }: { id: string }) {
  const signedIn = useIsSignedIn();
  const [reason, setReason] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const search = useSearch();
  const requestedBack = new URLSearchParams(search).get("back") ?? "";
  const back = requestedBack === "/admin/tenants" || requestedBack.startsWith("/admin/tenants?") ? requestedBack : "/admin/tenants";
  const { data, isLoading, isError, isFetching, refetch } = useQuery<TenantOverview>({
    queryKey: ["/api/admin/tenants", id, "overview", reason, memberPage],
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/tenants/${encodeURIComponent(id)}/overview${memberPage > 1 ? `?memberPage=${memberPage}` : ""}`, undefined,
      { signal, cache: "no-store", headers: { "x-tenant-id": id, "x-access-reason": reason } })).json(),
    enabled: signedIn && !!id && !!reason,
    staleTime: 0,
    gcTime: 0,
  });
  return <div className="flex h-full flex-col overflow-hidden">
    <PageHeader icon={Building2} title="Tenant 360" subtitle="Read-only workspace investigation. Access is scoped and audited." />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <Button variant="outline" asChild><Link href={back}>Back to tenants</Link></Button>
        <Card><CardContent className="space-y-3 p-5">
          <p className="break-all text-sm text-muted-foreground">Target workspace: {id}</p>
          <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
            event.preventDefault();
            const value = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
            if (value) setReason(value);
          }}>
            <div className="min-w-0 flex-1 basis-64 space-y-2"><Label htmlFor="investigation-reason">Reason for accessing this workspace</Label><Input id="investigation-reason" name="reason" required maxLength={500} placeholder="For example: investigate a reported publishing failure" disabled={!!reason} /></div>
            {!reason && <Button type="submit">Open investigation</Button>}
            {reason && <Button type="button" variant="outline" disabled={isFetching} onClick={() => refetch()}>Refresh investigation</Button>}
          </form>
          <p className="text-xs text-muted-foreground">Do not enter passwords, tokens or other secrets. This reason is recorded in the audit log. This view cannot change customer data.</p>
        </CardContent></Card>
        {isLoading && <p role="status">Loading scoped workspace activity...</p>}
        {isError ? <AdminQueryError onRetry={() => refetch()} message="Tenant investigation could not be loaded. The workspace may be unavailable or your access may have changed." /> : data && <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><h2 className="break-words text-xl font-semibold">{data.tenant.name}</h2><p className="text-sm text-muted-foreground">{data.tenant.kind} workspace - created {new Date(data.tenant.createdAt).toLocaleDateString()}</p></div>
            <Badge variant={data.tenant.status === "active" ? "success" : "warning"}>{data.tenant.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Snapshot fetched {new Date(data.generatedAt).toLocaleString()}. Totals reflect retained records, not an immutable activity history. Times use your browser timezone.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[["Members", data.counts.members], ["Inbox articles", data.counts.inboxItems], ["Drafts", data.counts.drafts], ["Failed schedules", data.counts.failedSchedules], ["Overdue schedules", data.counts.overdueSchedules]].map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value.toLocaleString()}</p></CardContent></Card>)}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Billing record</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              {data.latestSubscription ? <><p>Status: <strong>{data.latestSubscription.status}</strong></p><p className="break-all">Plan ID: {data.latestSubscription.planId}</p><p>Period end: {data.latestSubscription.currentPeriodEnd ? new Date(data.latestSubscription.currentPeriodEnd).toLocaleString() : "Not recorded"}</p><p>{data.latestSubscription.cancelAtPeriodEnd ? "Cancellation scheduled at period end" : "No period-end cancellation recorded"}</p><p className="text-xs text-muted-foreground">Latest stored subscription, not a live provider check or entitlement decision.</p></> : <p className="text-muted-foreground">No subscription record. This does not imply a billing failure.</p>}
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Investigation guidance</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
              <p>Overdue means scheduled or queued more than five minutes past the intended publish time.</p>
              <p>Run and schedule statuses are recorded workflow states, not proof of provider delivery. This read-only view deliberately offers no blind retry.</p>
              <Button variant="outline" asChild><Link href="/admin/monitoring">Open platform monitoring</Link></Button>
            </CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle className="text-base">Members and onboarding</CardTitle></CardHeader><CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Member page {memberPage} of {Math.max(1, Math.ceil(data.counts.members / 50))}; up to 50 members per page.</p>
            {data.members.length ? <ul className="divide-y">{data.members.map(member => <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words font-medium">{member.name}</p><p className="break-all text-sm text-muted-foreground">{member.email}</p></div><div className="flex flex-wrap gap-2"><Badge variant="secondary">{member.role}</Badge><Badge variant="outline">{member.onboardingStatus ?? "No profile"}</Badge></div></li>)}</ul> : <p className="text-sm text-muted-foreground">No members recorded.</p>}
            <div className="mt-4 flex gap-2"><Button variant="outline" disabled={memberPage <= 1 || isFetching} onClick={() => setMemberPage(page => page - 1)}>Previous members</Button><Button variant="outline" disabled={!data.membersTruncated || memberPage >= 10000 || isFetching} onClick={() => setMemberPage(page => page + 1)}>Next members</Button></div>
          </CardContent></Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Source fetch health</CardTitle></CardHeader><CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Up to 50 configured sources. Recorded fetch state is not an external availability check; source URLs and errors are not exposed.</p>
              {data.sourcesTruncated && <p className="text-sm text-muted-foreground">Additional sources are not shown.</p>}
              {data.sources?.length ? <ul className="divide-y">{data.sources.map(source => <li key={source.id} className="space-y-1 py-3"><p className="break-words font-medium">{source.name}</p><p className="text-sm text-muted-foreground">{source.active ? "Enabled" : "Paused"} / {source.lastFetchStatus ?? "No fetch status"}</p><p className="text-xs text-muted-foreground">Last fetch: {source.lastFetchedAt ? new Date(source.lastFetchedAt).toLocaleString() : "Not recorded"}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No configured sources recorded.</p>}
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Social connection records</CardTitle></CardHeader><CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Up to 50 connections. Enabled does not certify token validity. Credentials are never selected or displayed.</p>
              {data.connectionsTruncated && <p className="text-sm text-muted-foreground">Additional connections are not shown.</p>}
              {data.connections?.length ? <ul className="divide-y">{data.connections.map(connection => <li key={connection.id} className="space-y-1 py-3"><p className="font-medium">{connection.provider}</p><p className="text-sm text-muted-foreground">{connection.active ? "Enabled" : "Inactive"}</p><p className="text-xs text-muted-foreground">Last sync: {connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : "Not recorded"}</p><p className="text-xs text-muted-foreground">Recorded token expiry: {connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).toLocaleString() : "Not recorded"}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No social connection records.</p>}
            </CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle className="text-base">Recent payment records</CardTitle></CardHeader><CardContent>
            <p className="mb-3 text-xs text-muted-foreground">Latest ten payments. Amounts are stored minor currency units. These records are not a revenue total or a live provider reconciliation.</p>
            {data.recentPayments?.length ? <ul className="divide-y">{data.recentPayments.map(payment => <li key={payment.id} className="flex flex-wrap justify-between gap-3 py-3"><div><p className="font-medium">{payment.amount.toLocaleString()} {payment.currency} minor units</p><p className="break-all text-xs text-muted-foreground">Record {payment.id}</p></div><div><Badge variant={payment.status === "failed" ? "warning" : "secondary"}>{payment.status}</Badge><p className="text-xs text-muted-foreground">{payment.createdAt ? new Date(payment.createdAt).toLocaleString() : "Date not recorded"}</p></div></li>)}</ul> : <p className="text-sm text-muted-foreground">No payment records.</p>}
          </CardContent></Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Recent discovery runs</CardTitle></CardHeader><CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Latest 10 runs by start time. Provider errors and payloads are not exposed.</p>
              {data.recentRuns.length ? <ul className="divide-y">{data.recentRuns.map(run => <li key={run.id} className="space-y-1 py-3"><div className="flex flex-wrap justify-between gap-2"><Badge variant={run.status === "failed" ? "error" : "secondary"}>{run.status}</Badge><span className="text-xs text-muted-foreground">{run.startedAt ? new Date(run.startedAt).toLocaleString() : "Start not recorded"}</span></div><p className="break-all text-xs text-muted-foreground">Run {run.id}</p><p className="text-sm">{run.articlesProcessed ?? "Not recorded"} processed / {run.articlesMatched ?? "Not recorded"} matched</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No discovery runs recorded.</p>}
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Recent publishing schedules</CardTitle></CardHeader><CardContent>
              <p className="mb-3 text-xs text-muted-foreground">Latest 10 schedules by creation time, including cancelled and historical records.</p>
              {data.recentSchedules.length ? <ul className="divide-y">{data.recentSchedules.map(schedule => <li key={schedule.id} className="space-y-1 py-3"><div className="flex flex-wrap justify-between gap-2"><Badge variant={schedule.status === "failed" ? "error" : "secondary"}>{schedule.status}</Badge><span className="text-xs text-muted-foreground">{new Date(schedule.scheduledPublishAt).toLocaleString()}</span></div><p className="break-all text-xs text-muted-foreground">Schedule {schedule.id}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No publishing schedules recorded.</p>}
            </CardContent></Card>
          </div>
        </>}
      </div>
    </main>
  </div>;
}
