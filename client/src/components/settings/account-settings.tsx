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
  const fullNameFromUser = user ? `${user.firstName} ${user.lastName}`.trim() : "";
  const { draft, setDraft, dirty, acknowledge } = useSettingsDraft({ fullName: fullNameFromUser });
  const mutation = useMutation({
    mutationFn: async (values: typeof draft) => {
      // Use custom endpoint to update full name
      // Server will parse full name into firstName/lastName
      const response = await fetch("/api/auth/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: values.fullName.trim(),
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
      toast({ title: "Account saved", description: "Your name has been updated." });
    },
    onError: (error: Error) => toast({ title: "Could not save account", description: error.message, variant: "destructive" }),
  });
  return <Card>
    <CardHeader><CardTitle>Account information</CardTitle><CardDescription>Update your name. Email and profile photo are managed by your sign-in provider.</CardDescription></CardHeader>
    <CardContent>
      <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); if (user && dirty && !mutation.isPending) mutation.mutate(draft); }}>
        <Avatar className="h-16 w-16"><AvatarImage src={user?.imageUrl ?? undefined} alt="Account photo" /><AvatarFallback>{user?.firstName?.[0] ?? "U"}</AvatarFallback></Avatar>
        <fieldset disabled={!user || mutation.isPending} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="fullName">Full Name</Label><Input className="min-h-11" id="fullName" required maxLength={200} autoComplete="name" value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} data-testid="input-full-name" /></div>
        </fieldset>
        <div className="space-y-2"><Label htmlFor="email">Email</Label><Input className="min-h-11" id="email" type="email" readOnly value={user?.email ?? ""} aria-describedby="email-help" data-testid="input-email" /><p id="email-help" className="text-sm text-muted-foreground">Email cannot be changed here.</p></div>
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
        <Button className="min-h-11" type="submit" disabled={!user || !dirty || !draft.fullName.trim() || mutation.isPending} data-testid="button-save-account">{mutation.isPending ? "Saving…" : "Save Account"}</Button>
      </form>
    </CardContent>
  </Card>;
}