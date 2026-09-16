import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminQueryError } from "@/components/admin/admin-query-error";

interface AdminTenant {
  id: string;
  kind: string;
  name: string;
  status: string;
  createdAt: string | null;
  memberCount: number;
}

export default function AdminTenantsPage() {
  const isSignedIn = useIsSignedIn();

  const { data: tenants, isLoading, isError, refetch } = useQuery<AdminTenant[]>({
    queryKey: ["/api/admin/tenants"],
    enabled: !!isSignedIn,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Building2}
        title="Tenants"
        subtitle="Every workspace on the platform — personal and corporate"
      />
      <main className="flex-1 p-6 overflow-y-auto">
        <Card className="max-w-5xl mx-auto">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-5 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : isError ? (
              <AdminQueryError onRetry={() => refetch()} message="Tenants could not be loaded. This may be a permissions or platform-service issue." />
            ) : !tenants || tenants.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                <Building2 className="w-8 h-8" />
                No tenants yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((tenant) => (
                    <TableRow key={tenant.id} data-testid={`row-tenant-${tenant.id}`}>
                      <TableCell className="font-medium">{tenant.name}</TableCell>
                      <TableCell className="capitalize">{tenant.kind}</TableCell>
                      <TableCell>
                        <Badge variant={tenant.status === "active" ? "default" : "secondary"} className="capitalize">
                          {tenant.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{tenant.memberCount}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
