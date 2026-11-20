import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Mail } from "lucide-react";
import { emailDirectoryQuerySchema, type AdminEmailRecord, type AdminRecordPage } from "@shared/admin";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AdminQueryError } from "@/components/admin/admin-query-error";

export default function AdminEmailDeliveriesPage() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const parsed = emailDirectoryQuerySchema.safeParse(Object.fromEntries(new URLSearchParams(search)));
  const filters = parsed.success ? parsed.data : null;
  const query = filters ? new URLSearchParams({ ...filters, page: String(filters.page) }).toString() : "";
  const result = useQuery<AdminRecordPage<AdminEmailRecord>>({
    queryKey: ["/api/admin/email-directory", query], enabled: !!filters,
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/email-directory?${query}`, undefined,
      { signal, cache: "no-store", headers: { "x-access-reason": "Investigate global email delivery records" } })).json(),
  });
  const { data } = result;
  function paginate(page: number) {
    if (filters) navigate(`${location}?${new URLSearchParams({ ...filters, page: String(page) })}`);
  }
  return <div className="flex h-full flex-col overflow-hidden">
    <PageHeader icon={Mail} title="Email delivery history" subtitle="Search retained account-wide delivery records. Provider acceptance does not prove inbox arrival." />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl space-y-4">
      <Card><CardContent className="p-4"><form key={search} className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        navigate(`${location}?${new URLSearchParams({ q: String(form.get("q") ?? "").trim(), user: String(form.get("user") ?? "").trim(),
          type: String(form.get("type") ?? "").trim(), status: String(form.get("status") ?? ""), page: "1" })}`);
      }}>
        <div className="min-w-0 flex-1 basis-60 space-y-2"><Label htmlFor="delivery-search">Recipient or exact delivery ID</Label><Input id="delivery-search" name="q" maxLength={120} defaultValue={filters?.q} /></div>
        <div className="min-w-0 flex-1 basis-48 space-y-2"><Label htmlFor="delivery-user">Account ID</Label><Input id="delivery-user" name="user" maxLength={100} defaultValue={filters?.user} /></div>
        <div className="min-w-0 flex-1 basis-40 space-y-2"><Label htmlFor="delivery-type">Exact email type</Label><Input id="delivery-type" name="type" maxLength={60} defaultValue={filters?.type} placeholder="daily_digest" /></div>
        <div className="space-y-2"><Label htmlFor="delivery-status">Delivery status</Label><select id="delivery-status" name="status" defaultValue={filters?.status} className="h-11 rounded-md border bg-background px-3">
          <option value="">All statuses</option>{["pending", "sending", "sent", "failed", "unknown", "suppressed"].map(status => <option key={status} value={status}>{status}</option>)}
        </select></div>
        <Button type="submit">Search deliveries</Button><Button variant="outline" asChild><Link href={location}>Clear filters</Link></Button>
      </form></CardContent></Card>
      <p className="text-sm text-muted-foreground">Unknown outcomes require investigation, never blind replay. This view exposes no content, security links, provider errors or deduplication keys. Retention limits apply.</p>
      {!filters ? <p role="alert">Invalid delivery filters.</p> : result.isError ? <AdminQueryError onRetry={() => result.refetch()} message="Delivery history unavailable. No empty result has been assumed." />
        : result.isLoading ? <p role="status">Loading deliveries...</p> : data && <Card><CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap justify-between gap-3"><p role="status">{data.total.toLocaleString()} matching deliveries</p><Button variant="outline" disabled={result.isFetching} onClick={() => result.refetch()}>Refresh deliveries</Button></div>
          {data.items.length ? <ul className="divide-y">{data.items.map(row => <li key={row.id} className="space-y-2 py-4">
            <div className="flex flex-wrap justify-between gap-3"><p className="break-all font-medium">{row.recipient}</p><p className="text-sm">{row.status} / {row.attempts} attempts</p></div>
            <p className="break-all text-sm">{row.type} / {row.id}</p>
            <p className="text-xs text-muted-foreground">Created {new Date(row.createdAt).toLocaleString()}{row.sentAt ? ` / Accepted ${new Date(row.sentAt).toLocaleString()}` : ""}{row.retryAt ? ` / Retry eligible ${new Date(row.retryAt).toLocaleString()}` : ""}</p>
            {row.userId ? <Link className="inline-flex min-h-11 items-center break-all text-primary underline" href={`/admin/users/${encodeURIComponent(row.userId)}`}>Investigate account {row.userId}</Link> : <p className="text-xs text-muted-foreground">No attributable account</p>}
          </li>)}</ul> : <p>No deliveries on this page.</p>}
          <div className="flex flex-wrap justify-between gap-3 border-t pt-4"><p>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</p><div className="flex gap-2">
            <Button variant="outline" disabled={data.page <= 1 || result.isFetching} onClick={() => paginate(data.page - 1)}>Previous</Button>
            <Button variant="outline" disabled={data.page * data.pageSize >= data.total || data.page >= 10000 || result.isFetching} onClick={() => paginate(data.page + 1)}>Next</Button>
          </div></div>
        </CardContent></Card>}
    </div></main>
  </div>;
}
