import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { WorkflowStatus } from "@/components/dashboard/workflow-status";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useSettingsDraft } from "./use-settings-draft";

export function AccountSettings() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const { toast } = useToast();
  const fullNameFromUser = user ? `${user.firstName} ${user.lastName}`.trim() : "";
  const { draft, setDraft, dirty, acknowledge } = useSettingsDraft({ fullName: fullNameFromUser });
  const mutation = useMutation({
    mutationFn: async (values: typeof draft) => {
      const fullName = values.fullName.trim();
      const response = await fetch("/api/account/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName }),
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Failed to update account" }));
        throw new Error(error.message ?? "Failed to update account");
      }
      return values;
    },
    onSuccess: (saved) => {
      acknowledge(saved);
      void cache.invalidateQueries({ queryKey: ["/api/me"] });
      toast({ title: "Account saved", description: "Your name has been updated." });
    },
    onError: (error: Error) => toast({ title: "Could not save account", description: error.message, variant: "destructive" }),
  });
  return <Card>
    <CardHeader><CardTitle as="h2" help="Update your name. Email and profile photo are managed by your sign-in provider.">Account information</CardTitle></CardHeader>
    <CardContent>
      <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); if (user && dirty && !mutation.isPending) mutation.mutate(draft); }}>
        <Avatar className="h-16 w-16"><AvatarImage src={user?.imageUrl ?? undefined} alt="Account photo" /><AvatarFallback>{user?.firstName?.[0] ?? "U"}</AvatarFallback></Avatar>
        <fieldset disabled={!user || mutation.isPending} className="min-w-0 space-y-4">
          <Field id="fullName" label="Full Name" render={props => <Input {...props} required maxLength={200} autoComplete="name" value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} data-testid="input-full-name" />} />
        </fieldset>
        <Field id="email" label="Email" help="Email cannot be changed here." render={props => <Input {...props} type="email" readOnly value={user?.email ?? ""} data-testid="input-email" />} />
        {mutation.isError && <WorkflowStatus tone="error" title="Account changes were not saved.">{mutation.error.message} Your changes are retained; try Save Account again.</WorkflowStatus>}
        {mutation.isPending && <WorkflowStatus tone="info">Saving account changes…</WorkflowStatus>}
        {mutation.isSuccess && !dirty && <WorkflowStatus tone="success">Account changes saved.</WorkflowStatus>}
        <Button type="submit" disabled={!user || !dirty || !draft.fullName.trim() || mutation.isPending} data-testid="button-save-account">{mutation.isPending ? "Saving…" : "Save Account"}</Button>
      </form>
    </CardContent>
  </Card>;
}