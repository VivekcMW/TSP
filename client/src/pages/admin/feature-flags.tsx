import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Flag, Plus, Trash2 } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { AdminQueryError } from "@/components/admin/admin-query-error";

interface FeatureFlag {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  createdAt: string | null;
}

export default function AdminFeatureFlagsPage() {
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const { data: flags, isLoading, isError, refetch } = useQuery<FeatureFlag[]>({
    queryKey: ["/api/admin/feature-flags"],
    enabled: !!isSignedIn,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/feature-flags/${id}`, { enabled });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] }),
    onError: () => toast({ title: "Failed to update flag", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/feature-flags", {
        key: newKey.trim(),
        description: newDescription.trim() || undefined,
        enabled: false,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
      setIsCreateOpen(false);
      setNewKey("");
      setNewDescription("");
      toast({ title: "Feature flag created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create flag", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/feature-flags/${id}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] }),
    onError: () => toast({ title: "Failed to delete flag", variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Flag}
        title="Feature Flags"
        subtitle="Platform-wide toggles. Not yet wired into any code path that reads them"
        actions={
          <Button onClick={() => setIsCreateOpen(true)} data-testid="button-new-flag">
            <Plus className="w-4 h-4 mr-2" />
            New Flag
          </Button>
        }
      />
      <main className="flex-1 p-6 overflow-y-auto">
        <Card className="max-w-4xl mx-auto">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-5 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : isError ? (
              <AdminQueryError onRetry={() => refetch()} message="Feature flags could not be loaded." />
            ) : !flags || flags.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                <Flag className="w-8 h-8" />
                No feature flags yet.
              </div>
            ) : (
              <div className="divide-y">
                {flags.map((flag) => (
                  <div key={flag.id} className="p-4 flex items-center justify-between gap-4" data-testid={`row-flag-${flag.key}`}>
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-medium">{flag.key}</p>
                      {flag.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{flag.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Switch
                        checked={flag.enabled}
                        onCheckedChange={(enabled) => toggleMutation.mutate({ id: flag.id, enabled })}
                        data-testid={`switch-flag-${flag.key}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(flag.id)}
                        data-testid={`button-delete-flag-${flag.key}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Feature Flag</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="flag_key_like_this"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              data-testid="input-flag-key"
            />
            <Input
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              data-testid="input-flag-description"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newKey.trim() || createMutation.isPending}
              data-testid="button-create-flag"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
