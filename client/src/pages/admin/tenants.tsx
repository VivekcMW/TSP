import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Building2, Search } from "lucide-react";
import { tenantDirectoryQuerySchema, type TenantDirectory } from "@shared/admin";
import { useIsSignedIn } from "@/lib/dev-auth";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminQueryError } from "@/components/admin/admin-query-error";

export default function AdminTenantsPage() {
  const signedIn = useIsSignedIn();
  const search = useSearch();
  const [, navigate] = useLocation();
  const parsed = tenantDirectoryQuerySchema.safeParse(Object.fromEntries(new URLSearchParams(search)));
  const filters = parsed.success ? parsed.data : null;
  const query = filters ? new URLSearchParams({ q: filters.q, status: filters.status, kind: filters.kind, page: String(filters.page) }).toString() : "";
  const { data, isLoading, isError, isFetching, refetch } = useQuery<TenantDirectory>({
    queryKey: ["/api/admin/tenant-directory", query],
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/admin/tenant-directory?${query}`, undefined,
      { signal, cache: "no-store", headers: { "x-access-reason": "Review platform tenant directory" } })).json(),
    enabled: signedIn && !!filters,
    staleTime: 30_000,
  });
  function goToPage(page: number) {
    if (!filters) return;
    navigate(`/admin/tenants?${new URLSearchParams({ q: filters.q, status: filters.status, kind: filters.kind, page: String(page) })}`);
  }
  const back = `/admin/tenants${search ? `?${search}` : ""}`;
  return <div className="flex h-full flex-col overflow-hidden">
    <PageHeader icon={Building2} title="Tenants" subtitle="Find a workspace, review its activity and investigate issues safely." />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <Card><CardContent className="p-4">
          <form key={search} className="flex flex-wrap items-end gap-4" onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            navigate(`/admin/tenants?${new URLSearchParams({ q: String(form.get("q") ?? "").trim(), status: String(form.get("status")), kind: String(form.get("kind")), page: "1" })}`);
          }}>
            <div className="min-w-0 flex-1 basis-64 space-y-2"><Label htmlFor="tenant-search">Workspace name or exact ID</Label><Input id="tenant-search" name="q" maxLength={120} defaultValue={filters?.q ?? ""} placeholder="Search workspaces" /></div>
            <div className="space-y-2"><Label htmlFor="tenant-status">Status</Label><select id="tenant-status" name="status" defaultValue={filters?.status ?? "all"} className="flex h-11 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deleted">Deleted</option></select></div>
            <div className="space-y-2"><Label htmlFor="tenant-kind">Workspace type</Label><select id="tenant-kind" name="kind" defaultValue={filters?.kind ?? "all"} className="flex h-11 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All types</option><option value="personal">Personal</option><option value="corporate">Corporate</option></select></div>
            <Button type="submit"><Search className="mr-2 h-4 w-4" />Search</Button>
            <Button variant="outline" asChild><Link href="/admin/tenants">Clear filters</Link></Button>
          </form>
        </CardContent></Card>
        {!filters ? <p role="alert">These directory filters are invalid. Clear filters or submit a valid search.</p> : <Card><CardContent className="p-0">
          {isLoading ? <div role="status" className="space-y-2 p-5"><span className="sr-only">Loading tenants</span>{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
            : isError ? <AdminQueryError onRetry={() => refetch()} message="Tenant directory could not be loaded. No results have been assumed." />
            : data ? <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                <p role="status" className="text-sm text-muted-foreground">{data.total.toLocaleString()} matching workspaces{isFetching ? " - refreshing" : ""}</p>
                <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>Refresh results</Button>
              </div>
              {data.items.length === 0 ? <p className="p-8 text-center text-muted-foreground">No workspaces on this page. Change filters or return to the previous page.</p> : <Table>
                <TableHeader><TableRow><TableHead>Workspace</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Members</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                <TableBody>{data.items.map(tenant => <TableRow key={tenant.id}>
                  <TableCell className="min-w-48"><Link href={`/admin/tenants/${tenant.id}?back=${encodeURIComponent(back)}`} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">{tenant.name}</Link><p className="text-xs text-muted-foreground">{tenant.id}</p></TableCell>
                  <TableCell className="capitalize">{tenant.kind}</TableCell><TableCell><Badge variant={tenant.status === "active" ? "success" : "secondary"}>{tenant.status}</Badge></TableCell>
                  <TableCell>{tenant.memberCount}</TableCell><TableCell>{new Date(tenant.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>)}</TableBody>
              </Table>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
                <p className="text-sm text-muted-foreground">Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</p>
                <div className="flex gap-2"><Button variant="outline" disabled={data.page <= 1 || isFetching} onClick={() => goToPage(data.page - 1)}>Previous</Button><Button variant="outline" disabled={data.page * data.pageSize >= data.total || data.page >= 10000 || isFetching} onClick={() => goToPage(data.page + 1)}>Next</Button></div>
              </div>
            </> : null}
        </CardContent></Card>}
      </div>
    </main>
  </div>;
}
