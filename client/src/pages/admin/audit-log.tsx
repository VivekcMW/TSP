import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminQueryError } from "@/components/admin/admin-query-error";

interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorPlatformRole: string | null;
  tenantId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  justification: string | null;
  createdAt: string | null;
}

export default function AdminAuditLogPage() {
  const isSignedIn = useIsSignedIn();

  const { data: entries, isLoading, isError, refetch } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/admin/audit-log"],
    enabled: !!isSignedIn,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={ScrollText}
        title="Audit Log"
        subtitle="Every privileged or cross-tenant action, written automatically by the permission middleware"
      />
      <main className="flex-1 p-6 overflow-y-auto">
        <Card className="max-w-6xl mx-auto">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-5 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : isError ? (
              <AdminQueryError onRetry={() => refetch()} message="Audit events could not be loaded. Do not assume the platform is healthy until this is resolved." />
            ) : !entries || entries.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                <ScrollText className="w-8 h-8" />
                No audited actions yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor Role</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Justification</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id} data-testid={`row-audit-${entry.id}`}>
                      <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">
                          {entry.actorPlatformRole?.replace("platform_", "") ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {entry.resourceType} {entry.resourceId?.slice(0, 40)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-xs truncate">
                        {entry.justification ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
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
