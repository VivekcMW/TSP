import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Search } from "lucide-react";
import { z } from "zod";
import type { AdminRecordPage, AdminUserRecord, AdminAuditRecord, AdminEmailRecord, TenantDirectory } from "@shared/admin";
import { savedViewSchema, savedViewsSchema, type AdminSavedView } from "@shared/admin-saved-views";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminQueryError } from "@/components/admin/admin-query-error";

const querySchema = z.object({ q: z.string().trim().max(120).default("") }).strict();
export default function AdminSearchPage() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const parsed = querySchema.safeParse(Object.fromEntries(new URLSearchParams(search)));
  const q = parsed.success ? parsed.data.q : "";
  const me = useQuery<{ id: string }>({ queryKey: ["/api/me"] });
  const key = me.data && !me.isError ? `tsp:admin:saved-views:${me.data.id}` : null;
  const [storedViews, setStoredViews] = useState<{ key: string; items: AdminSavedView[] } | null>(null);
  const views = storedViews?.key === key ? storedViews.items : null;
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const results = useQuery({
    queryKey: ["/api/admin/global-search", q], enabled: parsed.success && q.length > 0, gcTime: 0,
    queryFn: async ({ signal }) => {
      const paths = ["tenant-directory", "users-directory", "audit-directory", "email-directory"];
      const responses = await Promise.all(paths.map(path => apiRequest("GET", `/api/admin/${path}?q=${encodeURIComponent(q)}`, undefined,
        { signal, cache: "no-store", headers: { "x-access-reason": "Search platform investigation records" } })));
      const [tenants, users, audit, emails] = await Promise.all(responses.map(response => response.json())) as
        [TenantDirectory, AdminRecordPage<AdminUserRecord>, AdminRecordPage<AdminAuditRecord>, AdminRecordPage<AdminEmailRecord>];
      return { tenants, users, audit, emails };
    },
  });
  function loadViews(): AdminSavedView[] | null {
    if (!key) return null;
    try {
      const result = savedViewsSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "[]"));
      if (!result.success) { setMessage("Saved view data is invalid; it has not been overwritten."); return null; }
      setStoredViews({ key, items: result.data }); return result.data;
    } catch { setMessage("Saved views unavailable in this browser."); return null; }
  }
  function save(next: AdminSavedView[]) {
    if (!key) return;
    const checked = savedViewsSchema.safeParse(next);
    if (!checked.success) { setMessage("Use at most ten named views."); return; }
    try { localStorage.setItem(key, JSON.stringify(checked.data)); setStoredViews({ key, items: checked.data }); setMessage("Views saved only in this browser for this account."); }
    catch { setMessage("Could not persist saved views. Nothing has been reported as saved."); }
  }
  const data = results.isError ? undefined : results.data;
  return <div className="flex h-full flex-col overflow-hidden"><PageHeader icon={Search} title="Platform search" subtitle="Find workspace, account, audit and delivery records. Every source query retains its own audited authorization." />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-4">
      <Card><CardContent className="space-y-4 p-5"><form key={search} className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); const value = String(new FormData(event.currentTarget).get("q") ?? "").trim(); navigate(`${location}?q=${encodeURIComponent(value)}`);
      }}><div className="min-w-0 flex-1 space-y-2"><Label htmlFor="global-search">Name, email, record ID or resource path</Label><Input id="global-search" name="q" maxLength={120} defaultValue={q} required /></div><Button type="submit">Search platform</Button></form>
        {!parsed.success && <p role="alert">Invalid search filters.</p>}
        <p className="text-xs text-muted-foreground">Shows the first five matches per source. Open a directory for full pagination. Results exclude job payloads, content and provider credentials.</p>
      </CardContent></Card>
      {results.isError && <AdminQueryError onRetry={() => results.refetch()} message="Platform search unavailable. A failed source has not been presented as empty." />}
      {results.isLoading && <p role="status">Searching platform records...</p>}
      {data && <>
        <Card><CardHeader><CardTitle>Workspaces ({data.tenants.total})</CardTitle></CardHeader><CardContent><ul>{data.tenants.items.slice(0,5).map(row => <li key={row.id}><Link className="inline-flex min-h-11 items-center break-all text-primary underline" href={`/admin/tenants/${row.id}`}>{row.name}</Link></li>)}</ul><Link className="inline-flex min-h-11 items-center text-primary underline" href={`/admin/tenants?q=${encodeURIComponent(q)}`}>Open workspace directory</Link></CardContent></Card>
        <Card><CardHeader><CardTitle>Accounts ({data.users.total})</CardTitle></CardHeader><CardContent><ul>{data.users.items.slice(0,5).map(row => <li key={row.id}><Link className="inline-flex min-h-11 items-center break-all text-primary underline" href={`/admin/users/${encodeURIComponent(row.id)}`}>{row.name || row.email}</Link></li>)}</ul><Link className="inline-flex min-h-11 items-center text-primary underline" href={`/admin/users?q=${encodeURIComponent(q)}`}>Open account directory</Link></CardContent></Card>
        <Card><CardHeader><CardTitle>Audit events ({data.audit.total})</CardTitle></CardHeader><CardContent><ul>{data.audit.items.slice(0,5).map(row => <li key={row.id} className="break-all py-2 text-sm">{row.action} / {row.resourceId}</li>)}</ul><Link className="inline-flex min-h-11 items-center text-primary underline" href={`/admin/audit-log?q=${encodeURIComponent(q)}`}>Open audit directory</Link></CardContent></Card>
        <Card><CardHeader><CardTitle>Deliveries ({data.emails.total})</CardTitle></CardHeader><CardContent><ul>{data.emails.items.slice(0,5).map(row => <li key={row.id} className="break-all py-2 text-sm">{row.recipient} / {row.type} / {row.status}</li>)}</ul><Link className="inline-flex min-h-11 items-center text-primary underline" href={`/admin/email-deliveries?q=${encodeURIComponent(q)}`}>Open delivery directory</Link></CardContent></Card>
      </>}
      <Card><CardHeader><CardTitle>Saved investigation views</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Account-scoped, browser-local shortcuts, not shared team configuration. Do not save secrets or sensitive case notes on shared devices.</p>
        <Button variant="outline" disabled={!key} onClick={() => loadViews()}>Load saved views</Button>
        <div className="space-y-2"><Label htmlFor="saved-view-name">View name</Label><Input id="saved-view-name" maxLength={60} value={name} onChange={event => setName(event.target.value)} /></div>
        <Button disabled={!q || !key || !name.trim()} onClick={() => {
          const view = savedViewSchema.safeParse({ name, href: `/admin/search?q=${encodeURIComponent(q)}` });
          const previous = views ?? loadViews();
          if (view.success && previous) save([...previous.filter(item => item.name !== view.data.name), view.data]);
        }}>Save current search</Button>
        {message && <p role="status" className="text-sm">{message}</p>}
        {views && <ul className="divide-y">{views.map((view,index) => <li key={view.name} className="flex flex-wrap justify-between gap-3 py-2"><Link className="inline-flex min-h-11 items-center text-primary underline" href={view.href}>{view.name}</Link><Button variant="outline" aria-label={`Remove saved view ${view.name}`} onClick={() => save(views.filter((_,item) => item !== index))}>Remove</Button></li>)}</ul>}
      </CardContent></Card>
    </div></main>
  </div>;
}
