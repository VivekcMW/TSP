import { useQuery, useMutation } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminQueryError } from "@/components/admin/admin-query-error";

interface EngineRun {
  id: string;
  tenantId: string;
  industry: string;
  userId: string | null;
  status: string;
  articlesProcessed: number | null;
  articlesMatched: number | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export default function AdminEngineRunsPage() {
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();

  const { data: runs, isLoading, isError, refetch } = useQuery<EngineRun[]>({
    queryKey: ["/api/admin/engine-runs"],
    enabled: !!isSignedIn,
  });

  const rerunMutation = useMutation({
    mutationFn: async (run: EngineRun) => {
      const res = await apiRequest("POST", `/api/admin/engine-runs/${run.id}/rerun`, { tenantId: run.tenantId }, { headers: { "x-tenant-id": run.tenantId, "x-access-reason": "Admin requested a pipeline rerun from the Engine Runs dashboard" } });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/engine-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/usage"] });
      toast({ title: data.queued ? "Engine re-run queued" : "Engine re-run complete", description: data.queued ? "The worker will process it shortly." : "Refresh the list to see the new run." });
    },
    onError: () => {
      toast({ title: "Re-run failed", description: "Please try again.", variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Activity}
        title="Pipeline"
        subtitle="Content-engine runs across every tenant — re-run any past run for its original user"
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
              <AdminQueryError onRetry={() => refetch()} message="Pipeline runs could not be loaded." />
            ) : !runs || runs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                <Activity className="w-8 h-8" />
                No engine runs recorded yet — they're logged the next time any user refreshes their inbox.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Industry</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Processed</TableHead>
                    <TableHead>Matched</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id} data-testid={`row-engine-run-${run.id}`}>
                      <TableCell className="font-medium capitalize">{run.industry.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <Badge variant={run.status === "success" ? "default" : "destructive"} className="capitalize">
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{run.articlesProcessed ?? 0}</TableCell>
                      <TableCell>{run.articlesMatched ?? 0}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {run.durationMs ? `${run.durationMs}ms` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => rerunMutation.mutate(run)}
                          disabled={rerunMutation.isPending || !run.userId}
                          data-testid={`button-rerun-${run.id}`}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${rerunMutation.isPending ? "animate-spin" : ""}`} />
                          Re-run
                        </Button>
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
