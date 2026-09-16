import { useQuery } from "@tanstack/react-query";
import { Building2, Users, Inbox, FileText, Activity, LayoutDashboard } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminQueryError } from "@/components/admin/admin-query-error";

interface PlatformUsage {
  tenants: number;
  users: number;
  inboxItems: number;
  drafts: number;
  engineRuns: number;
}

function StatTile({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <Card data-testid={`card-admin-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-5 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-semibold heading-dashboard mt-1">{value.toLocaleString()}</p>
        </div>
        <div className="w-10 h-10 rounded-md bg-secondary/15 flex items-center justify-center">
          <Icon className="w-5 h-5 text-secondary" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const isSignedIn = useIsSignedIn();

  const { data, isLoading, isError, refetch } = useQuery<PlatformUsage>({
    queryKey: ["/api/admin/usage"],
    enabled: !!isSignedIn,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={LayoutDashboard}
        title="Platform Overview"
        subtitle="Cumulative usage across every tenant on the platform"
      />
      <main className="flex-1 p-6 overflow-y-auto">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5 max-w-5xl mx-auto">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <Card className="mx-auto max-w-5xl"><CardContent className="p-0"><AdminQueryError onRetry={() => refetch()} message="Platform usage could not be loaded." /></CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5 max-w-5xl mx-auto">
            <StatTile label="Tenants" value={data?.tenants ?? 0} icon={Building2} />
            <StatTile label="Users" value={data?.users ?? 0} icon={Users} />
            <StatTile label="Inbox Items" value={data?.inboxItems ?? 0} icon={Inbox} />
            <StatTile label="Drafts" value={data?.drafts ?? 0} icon={FileText} />
            <StatTile label="Engine Runs" value={data?.engineRuns ?? 0} icon={Activity} />
          </div>
        )}
      </main>
    </div>
  );
}
