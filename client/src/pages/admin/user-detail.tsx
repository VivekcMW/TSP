import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Users } from "lucide-react";
import type { AdminUserOverview } from "@shared/admin";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AdminQueryError } from "@/components/admin/admin-query-error";

export default function AdminUserDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  return <UserInvestigation key={id} id={id} />;
}
function UserInvestigation({ id }: { id: string }) {
  const [reason, setReason] = useState("");
  const [membershipPage, setMembershipPage] = useState(1);
  const result = useQuery<AdminUserOverview>({
    queryKey: ["/api/admin/users", id, "overview", reason, membershipPage], enabled: !!reason, gcTime: 0, staleTime: 0,
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/users/${encodeURIComponent(id)}/overview?membershipPage=${membershipPage}`, undefined,
      { signal, cache: "no-store", headers: { "x-access-reason": reason } })).json(),
  });
  const { data } = result;
  return <div className="flex h-full flex-col overflow-hidden"><PageHeader icon={Users} title="Account investigation" subtitle="Read-only account identity and workspace membership." />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-4">
      <Button variant="outline" asChild><Link href="/admin/users">Back to users</Link></Button>
      <Card><CardContent className="space-y-3 p-5"><p className="break-all text-sm text-muted-foreground">Target user: {id}</p>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); setReason(String(new FormData(event.currentTarget).get("reason") ?? "").trim()); }}>
          <Label htmlFor="user-reason">Investigation reason</Label><Input id="user-reason" name="reason" required maxLength={500} disabled={!!reason} />
          {!reason && <Button type="submit">Open account investigation</Button>}
          {reason && <Button type="button" variant="outline" disabled={result.isFetching} onClick={() => result.refetch()}>Refresh investigation</Button>}
        </form><p className="text-xs text-muted-foreground">Access is audited. Do not enter credentials or secrets.</p>
      </CardContent></Card>
      {!result.isError && data && <Card><CardHeader><CardTitle className="text-base">Account email activity</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Latest 20 attributable account deliveries across workspaces. Provider acceptance is not inbox arrival. Unknown outcomes must not be blindly replayed.</p>
        <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/admin/email-deliveries?user=${encodeURIComponent(id)}`}>Search all account deliveries</Link>
        {data.preferences ? <p className="text-sm text-muted-foreground">Daily digest: {data.preferences.dailyDigest ? "on" : "off"} / Weekly summary: {data.preferences.weeklySummary ? "on" : "off"} / Product updates: {data.preferences.productUpdates ? "on" : "off"} / Global unsubscribe: {data.preferences.unsubscribedAt ? "recorded" : "not recorded"}</p> : <p className="text-sm text-muted-foreground">No saved preference row; delivery policy defaults apply.</p>}
        {data.emailHistory.length ? <ul className="divide-y">{data.emailHistory.map(email => <li key={email.id} className="flex flex-wrap justify-between gap-3 py-3"><div><p className="font-medium">{email.type}</p><p className="text-xs text-muted-foreground">{new Date(email.createdAt).toLocaleString()}</p></div><p className="text-sm text-muted-foreground">{email.status} / {email.attempts} attempts</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No attributable account delivery records. This does not establish that no email was ever sent.</p>}
      </CardContent></Card>}
      {result.isLoading && <p role="status">Loading account...</p>}
      {result.isError ? <AdminQueryError onRetry={() => result.refetch()} message="Account investigation unavailable." /> : data && <>
        <Card><CardHeader><CardTitle>{data.user.name || data.user.email}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          <p className="break-all">{data.user.email}</p><p>{data.user.emailVerified ? "Email verified" : "Email unverified"}</p><p>Effective staff role: {data.user.platformRole ?? "None"}</p>
          <p>Registered: {data.user.registrationCompleted ? new Date(data.user.registrationCompleted).toLocaleString() : "Incomplete"}</p>
          <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/admin/audit-log?actor=${encodeURIComponent(id)}`}>Review actor audit history</Link>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Workspaces</CardTitle></CardHeader><CardContent>
          <p className="text-sm text-muted-foreground">Membership page {membershipPage}; up to 100 records per page.</p>
          {data.memberships.length ? <ul className="divide-y">{data.memberships.map(member => <li key={member.tenantId} className="flex flex-wrap justify-between gap-3 py-3">
            <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/admin/tenants/${member.tenantId}`}>{member.name}</Link><p className="text-sm text-muted-foreground">{member.role} / {member.status}</p>
          </li>)}</ul> : <p className="text-sm text-muted-foreground">No workspace memberships recorded.</p>}
          <div className="mt-4 flex gap-2"><Button variant="outline" disabled={membershipPage <= 1 || result.isFetching} onClick={() => setMembershipPage(page => page - 1)}>Previous memberships</Button><Button variant="outline" disabled={!data.membershipsTruncated || membershipPage >= 10000 || result.isFetching} onClick={() => setMembershipPage(page => page + 1)}>Next memberships</Button></div>
        </CardContent></Card>
      </>}
    </div></main>
  </div>;
}
