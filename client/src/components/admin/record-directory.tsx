import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ScrollText, Users } from "lucide-react";
import { adminRecordsQuerySchema, type AdminRecordPage, type AdminAuditRecord, type AdminUserRecord } from "@shared/admin";
import { apiRequest } from "@/lib/queryClient";
import { useIsSignedIn } from "@/lib/dev-auth";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { AdminQueryError } from "./admin-query-error";

export function AdminRecordDirectory({ kind }: { kind: "users" | "audit" }) {
  const signedIn = useIsSignedIn();
  const search = useSearch();
  const [location, navigate] = useLocation();
  const parsed = adminRecordsQuerySchema.safeParse(Object.fromEntries(new URLSearchParams(search)));
  const filters = parsed.success ? parsed.data : null;
  const query = filters ? new URLSearchParams({ ...filters, page: String(filters.page) }).toString() : "";
  const users = useQuery<AdminRecordPage<AdminUserRecord>>({
    queryKey: ["/api/admin/users-directory", query], enabled: signedIn && kind === "users" && !!filters,
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/users-directory?${query}`, undefined, { signal, cache: "no-store", headers: { "x-access-reason": "Review platform account directory" } })).json(),
  });
  const audit = useQuery<AdminRecordPage<AdminAuditRecord>>({
    queryKey: ["/api/admin/audit-directory", query], enabled: signedIn && kind === "audit" && !!filters,
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/audit-directory?${query}`, undefined, { signal, cache: "no-store", headers: { "x-access-reason": "Review privileged access audit records" } })).json(),
  });
  const result = kind === "users" ? users : audit;
  const data = result.data;
  function paginate(page: number) {
    if (filters) navigate(`${location}?${new URLSearchParams({ ...filters, page: String(page) })}`);
  }
  return <div className="flex h-full flex-col overflow-hidden">
    <PageHeader icon={kind === "users" ? Users : ScrollText} title={kind === "users" ? "Users" : "Audit Log"}
      subtitle={kind === "users" ? "Search accounts and investigate workspace membership." : "Search privileged access records. Authorization records do not prove operation completion."} />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl space-y-4">
      <Card><CardContent className="p-4"><form key={search} className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        navigate(`${location}?${new URLSearchParams({ q: String(form.get("q") ?? "").trim(), actor: String(form.get("actor") ?? "").trim(),
          tenant: String(form.get("tenant") ?? "").trim(), action: String(form.get("action") ?? "").trim(), page: "1" })}`);
      }}>
        <div className="min-w-0 flex-1 basis-64 space-y-2"><Label htmlFor="record-search">{kind === "users" ? "Name, email or exact user ID" : "Resource path, exact event or correlation ID"}</Label><Input id="record-search" name="q" defaultValue={filters?.q} maxLength={120} /></div>
        {kind === "audit" && <>
          <div className="min-w-0 flex-1 basis-48 space-y-2"><Label htmlFor="record-actor">Actor user ID</Label><Input id="record-actor" name="actor" defaultValue={filters?.actor} maxLength={100} /></div>
          <div className="min-w-0 flex-1 basis-48 space-y-2"><Label htmlFor="record-tenant">Tenant ID</Label><Input id="record-tenant" name="tenant" defaultValue={filters?.tenant} maxLength={36} /></div>
          <div className="min-w-0 flex-1 basis-48 space-y-2"><Label htmlFor="record-action">Exact action</Label><Input id="record-action" name="action" defaultValue={filters?.action} maxLength={100} placeholder="tenant:read:all" /></div>
        </>}
        <Button type="submit">Search records</Button><Button asChild variant="outline"><Link href={location}>Clear filters</Link></Button>
      </form></CardContent></Card>
      {!filters ? <p role="alert">Invalid filters. Tenant ID must be a UUID and page must be a positive whole number.</p> : result.isError ? <AdminQueryError onRetry={() => result.refetch()} message="Records could not be loaded. No empty result has been assumed." />
        : result.isLoading ? <p role="status">Loading records...</p> : data && <Card><CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap justify-between gap-3"><p role="status" className="text-sm text-muted-foreground">{data.total.toLocaleString()} matching records</p><Button variant="outline" size="sm" disabled={result.isFetching} onClick={() => result.refetch()}>Refresh records</Button></div>
          {data.items.length === 0 && <p className="text-sm text-muted-foreground">No records on this page.</p>}
          {kind === "users" && users.data && <ul className="divide-y">{users.data.items.map(user => <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0"><Link className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4" href={`/admin/users/${encodeURIComponent(user.id)}`}>{user.name || user.email}</Link><p className="break-all text-sm">{user.email}</p><p className="break-all text-xs text-muted-foreground">ID: {user.id}</p></div>
            <div className="text-sm text-muted-foreground"><p>{user.emailVerified ? "Email verified" : "Email unverified"}</p><p>{user.platformRole ?? "Member"}</p><p>{user.registrationCompleted ? "Registration complete" : "Registration pending"}</p></div>
          </li>)}</ul>}
          {kind === "audit" && audit.data && <ul className="divide-y">{audit.data.items.map(entry => <li key={entry.id} className="space-y-2 py-4">
            <div className="flex flex-wrap justify-between gap-2"><p className="break-all font-mono text-sm">{entry.action}</p><time className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</time></div>
            <p className="break-all text-sm">{entry.resourceType} {entry.resourceId}</p><p className="break-words text-sm text-muted-foreground">Reason: {entry.justification ?? "Not recorded"}</p>
            <div className="flex flex-wrap gap-4 text-xs">{entry.actorUserId && <Link className="text-primary underline" href={`/admin/users/${encodeURIComponent(entry.actorUserId)}`}>Actor: {entry.actorUserId}</Link>}{entry.tenantId && <Link className="text-primary underline" href={`/admin/tenants/${entry.tenantId}`}>Tenant: {entry.tenantId}</Link>}</div>
            <p className="break-all text-xs text-muted-foreground">Event: {entry.id} / Correlation: {entry.correlationId ?? "Not recorded"}</p>
          </li>)}</ul>}
          <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</p><div className="flex gap-2">
            <Button variant="outline" disabled={data.page <= 1 || result.isFetching} onClick={() => paginate(data.page - 1)}>Previous</Button>
            <Button variant="outline" disabled={data.page * data.pageSize >= data.total || data.page >= 10000 || result.isFetching} onClick={() => paginate(data.page + 1)}>Next</Button>
          </div></div>
        </CardContent></Card>}
    </div></main>
  </div>;
}
