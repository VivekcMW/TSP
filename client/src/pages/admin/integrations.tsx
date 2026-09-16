import { useQuery, useMutation } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getPlatformMeta } from "@/lib/platforms";
import { AdminQueryError } from "@/components/admin/admin-query-error";

interface PlatformIntegration {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  notes: string | null;
  updatedAt: string | null;
}

export default function AdminIntegrationsPage() {
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();

  const { data: integrations, isLoading, isError, refetch } = useQuery<PlatformIntegration[]>({
    queryKey: ["/api/admin/integrations"],
    enabled: !!isSignedIn,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/integrations/${key}`, { enabled });
      return res.json();
    },
    onSuccess: (_data, { key, enabled }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      toast({
        title: enabled ? "Integration enabled" : "Integration disabled",
        description: `${key} is now ${enabled ? "available" : "unavailable"} platform-wide.`,
      });
    },
    onError: () => {
      toast({ title: "Failed to update integration", variant: "destructive" });
    },
  });

  const enabledCount = integrations?.filter((i) => i.enabled).length ?? 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Plug}
        title="Integration Management"
        subtitle={
          integrations
            ? `${enabledCount} of ${integrations.length} platforms available platform-wide`
            : "Platform-wide kill switch for each posting integration"
        }
      />
      <main className="flex-1 p-6 overflow-y-auto">
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto mb-6">
          Turning a platform off here makes it unavailable to every tenant immediately —
          it overrides each user's own Plugins preference and is rejected server-side if
          bypassed. Use this for outages or policy changes, not routine per-user preference.
        </p>

        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <Card className="mx-auto max-w-5xl"><CardContent className="p-0"><AdminQueryError onRetry={() => refetch()} message="Integration settings could not be loaded." /></CardContent></Card>
        ) : !integrations || integrations.length === 0 ? (
          <Card className="max-w-5xl mx-auto">
            <CardContent className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
              <Plug className="w-8 h-8" />
              No integrations configured yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {integrations.map((integration) => {
              const Icon = getPlatformMeta(integration.key).icon;
              return (
                <Card key={integration.id} className="hover-elevate" data-testid={`card-integration-${integration.key}`}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-md bg-secondary/15 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-secondary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{integration.label}</p>
                        <Badge variant={integration.enabled ? "default" : "destructive"} className="text-xs mt-0.5">
                          {integration.enabled ? "Available" : "Disabled"}
                        </Badge>
                      </div>
                    </div>
                    <Switch
                      checked={integration.enabled}
                      onCheckedChange={(enabled) => toggleMutation.mutate({ key: integration.key, enabled })}
                      data-testid={`switch-integration-${integration.key}`}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
