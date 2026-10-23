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
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { Label } from "@/components/ui/label";
import { flagPolicySchema } from "@shared/admin-controls";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface FeatureFlag {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  createdAt: string | null;
  owner: string | null;
  expiresAt: string | null;
  tenantIds: string[];
  revision: number;
}

export default function AdminFeatureFlagsPage() {
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<FeatureFlag | null>(null);
  const [remove, setRemove] = useState<FeatureFlag | null>(null);
  const [owner, setOwner] = useState("");
  const [expiry, setExpiry] = useState("");
  const [targets, setTargets] = useState("");
  const headers = { "x-access-reason": reason.trim() };
  const history = useQuery<{ id: string; operation: string; reason: string; actorId: string; createdAt: string }[]>({
    queryKey: ["/api/admin/feature-flag-history", policy?.key], enabled: !!policy,
    queryFn: async () => (await apiRequest("GET", `/api/admin/feature-flag-history?key=${encodeURIComponent(policy!.key)}`, undefined,
      { cache: "no-store", headers: { "x-access-reason": "Review feature rollout history" } })).json(),
  });

  const { data: flags, isLoading, isError, refetch } = useQuery<FeatureFlag[]>({
    queryKey: ["/api/admin/feature-flags"],
    enabled: !!isSignedIn,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled, revision }: { id: string; enabled: boolean; revision: number }) => {
      const res = await apiRequest("PATCH", `/api/admin/feature-flags/${id}`, { enabled, revision }, { headers });
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
      }, { headers });
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
    mutationFn: async (flag: FeatureFlag) => {
      const res = await apiRequest("DELETE", `/api/admin/feature-flags/${flag.id}?revision=${flag.revision}`, undefined, { headers });
      return res.json();
    },
    onSuccess: () => { setRemove(null); queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] }); },
    onError: () => toast({ title: "Failed to delete flag", variant: "destructive" }),
  });
  const policyMutation = useMutation({
    mutationFn: async () => {
      if (!policy) throw new Error("Choose a flag");
      const date = new Date(expiry);
      if (!Number.isFinite(date.getTime())) throw new Error("Choose a valid expiry");
      const body = flagPolicySchema.parse({ owner, expiresAt: date.toISOString(), tenantIds: targets.split(/[\s,]+/).filter(Boolean), revision: policy.revision });
      return (await apiRequest("PATCH", `/api/admin/feature-flags/${policy.id}/policy`, body, { headers })).json();
    },
    onSuccess: () => { setPolicy(null); queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] }); },
    onError: (error: Error) => toast({ title: "Policy update failed", description: error.message, variant: "destructive" }),
  });
  const busy = toggleMutation.isPending || createMutation.isPending || deleteMutation.isPending || policyMutation.isPending;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Flag}
        title="Feature Flags"
        subtitle="Owned, expiring controls. Only wired keys affect runtime. Deleting a flag restores its shipped default, which may enable it."
        actions={
          <Button disabled={!reason.trim() || busy} onClick={() => setIsCreateOpen(true)} data-testid="button-new-flag">
            <Plus className="w-4 h-4 mr-2" />
            New Flag
          </Button>
        }
      />
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="mx-auto mb-4 max-w-4xl space-y-2"><Label htmlFor="flag-change-reason">Flag change reason</Label><Input id="flag-change-reason" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /><p className="text-xs text-muted-foreground">Wired key: team_workspaces. Enabled targeted flags allow only listed workspaces; an empty list is global. Expired rows deny access until renewed. Other instances may cache policy for up to 30 seconds.</p></div>
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
                      <p className="mt-1 break-all text-xs text-muted-foreground">Owner: {flag.owner ?? "unassigned"} / Expires: {flag.expiresAt ? new Date(flag.expiresAt).toLocaleString() : "unset"} / {flag.tenantIds.length ? `${flag.tenantIds.length} target workspaces` : "global"} / revision {flag.revision}</p>
                      <Button variant="ghost" className="px-0" onClick={() => { setPolicy(flag); setOwner(flag.owner ?? ""); setExpiry(flag.expiresAt ? new Date(new Date(flag.expiresAt).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ""); setTargets(flag.tenantIds.join(", ")); }}>Ownership, rollout and history</Button>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Switch
                        checked={flag.enabled}
                        aria-label={`Enable ${flag.key}`}
                        disabled={!reason.trim() || busy}
                        onCheckedChange={(enabled) => toggleMutation.mutate({ id: flag.id, enabled, revision: flag.revision })}
                        data-testid={`switch-flag-${flag.key}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!reason.trim() || busy}
                        aria-label={`Delete ${flag.key}`}
                        onClick={() => setRemove(flag)}
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
            <Field label="Flag key" render={controlProps => <Input
              {...controlProps}
              placeholder="flag_key_like_this"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              data-testid="input-flag-key"
            />} />
            <Field label="Description (optional)" render={controlProps => <Input
              {...controlProps}
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              data-testid="input-flag-description"
            />} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newKey.trim() || !reason.trim() || busy}
              data-testid="button-create-flag"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!policy} onOpenChange={open => { if (!open) setPolicy(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Flag ownership and rollout</DialogTitle></DialogHeader>
        <p className="break-all text-sm">{policy?.key}</p>
        <div className="space-y-2"><Label htmlFor="flag-owner">Owner email</Label><Input id="flag-owner" type="email" value={owner} onChange={event => setOwner(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="flag-expiry">Policy expiry (local time)</Label><Input id="flag-expiry" type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="flag-targets">Target workspace UUIDs (comma-separated; blank for global)</Label><Input id="flag-targets" value={targets} onChange={event => setTargets(event.target.value)} /></div>
        <p className="text-xs text-muted-foreground">Expiry must be within 30 days. Changing targeting does not change the enabled switch. Only shipped consumers enforce these policies.</p>
        <Button disabled={!reason.trim() || busy} onClick={() => policyMutation.mutate()}>Save rollout policy</Button>
        <h3 className="font-medium">Latest 50 immutable changes</h3>
        {history.isError ? <AdminQueryError onRetry={() => history.refetch()} message="Flag history unavailable." /> : history.data && <ul className="divide-y">{history.data.map(event => <li key={event.id} className="space-y-1 py-2"><p className="text-sm">{event.operation} / {new Date(event.createdAt).toLocaleString()}</p><p className="break-words text-xs text-muted-foreground">{event.actorId} / {event.reason}</p></li>)}</ul>}
      </DialogContent></Dialog>
      <AlertDialog open={!!remove} onOpenChange={open => { if (!open) setRemove(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this runtime control?</AlertDialogTitle><AlertDialogDescription>Deleting the row restores the shipped fallback, which defaults to enabled. This is not the same as disabling a feature. Immutable history is retained.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy || !reason.trim()} onClick={event => { event.preventDefault(); if (remove) deleteMutation.mutate(remove); }}>Confirm delete and restore fallback</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
