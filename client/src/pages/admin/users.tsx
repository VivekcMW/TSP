import { useQuery } from "@tanstack/react-query";
import { Users as UsersIcon } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminQueryError } from "@/components/admin/admin-query-error";

interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  industry: string | null;
  platformRole: string | null;
  registrationCompleted: string | null;
  createdAt: string | null;
}

export default function AdminUsersPage() {
  const isSignedIn = useIsSignedIn();

  const { data: users, isLoading, isError, refetch } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: !!isSignedIn,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={UsersIcon}
        title="Users"
        subtitle="Every account on the platform, across every tenant"
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
              <AdminQueryError onRetry={() => refetch()} message="Users could not be loaded. This may be a permissions or platform-service issue." />
            ) : !users || users.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                <UsersIcon className="w-8 h-8" />
                No users yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium">
                        {user.firstName || user.lastName ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{user.industry ?? "—"}</TableCell>
                      <TableCell>
                        {user.platformRole ? (
                          <Badge className="capitalize">{user.platformRole.replace("platform_", "")}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Member</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.registrationCompleted ? "default" : "outline"} className="text-xs">
                          {user.registrationCompleted ? "Complete" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
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
