import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useSettingsDraft } from "./use-settings-draft";

export function AccountSettings() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const { toast } = useToast();
  const { draft, setDraft, dirty, acknowledge } = useSettingsDraft({ firstName: user?.firstName ?? "", lastName: user?.lastName ?? "" });
  const mutation = useMutation({
    mutationFn: async (values: typeof draft) => {
      // Use custom endpoint to update firstName/lastName separately
      // This ensures proper round-trip storage without name-field corruption
      const response = await fetch("/api/auth/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
        }),
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
      toast({ title: "Account saved", description: "Your account name has been updated." });
    },
    onError: (error: Error) => toast({ title: "Could not save account", description: error.message, variant: "destructive" }),
  });
  return <Card>
    <CardHeader><CardTitle>Account information</CardTitle><CardDescription>Update your name. Email and profile photo are managed by your sign-in provider.</CardDescription></CardHeader>
    <CardContent>
      <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); if (user && dirty && !mutation.isPending) mutation.mutate(draft); }}>
        <Avatar className="h-16 w-16"><AvatarImage src={user?.imageUrl ?? undefined} alt="Account photo" /><AvatarFallback>{user?.firstName?.[0] ?? "U"}</AvatarFallback></Avatar>
        <fieldset disabled={!user || mutation.isPending} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="firstName">First Name</Label><Input className="min-h-11" id="firstName" required maxLength={100} autoComplete="given-name" value={draft.firstName} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} data-testid="input-first-name" /></div>
          <div className="space-y-2"><Label htmlFor="lastName">Last Name</Label><Input className="min-h-11" id="lastName" maxLength={100} autoComplete="family-name" value={draft.lastName} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} data-testid="input-last-name" /></div>
        </fieldset>
        <div className="space-y-2"><Label htmlFor="email">Email</Label><Input className="min-h-11" id="email" type="email" readOnly value={user?.email ?? ""} aria-describedby="email-help" data-testid="input-email" /><p id="email-help" className="text-sm text-muted-foreground">Email cannot be changed here.</p></div>
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
        <Button className="min-h-11" type="submit" disabled={!user || !dirty || !draft.firstName.trim() || mutation.isPending} data-testid="button-save-account">{mutation.isPending ? "Saving…" : "Save Account"}</Button>
      </form>
    </CardContent>
  </Card>;
}