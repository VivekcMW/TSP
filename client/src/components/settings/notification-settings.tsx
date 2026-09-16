import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserProfile } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSettingsDraft } from "./use-settings-draft";

const preferences = [
  { key: "dailyDigest", label: "Daily Digest", description: "Receive a daily email with your curated content." },
  { key: "contentAlerts", label: "New Content Alerts", description: "Get notified when high-priority content arrives." },
  { key: "productUpdates", label: "Product Updates", description: "Learn about new features and improvements." },
] as const;

export function NotificationSettings() {
  const cache = useQueryClient();
  const { toast } = useToast();
  const { data: profile, isLoading, isError, refetch } = useQuery<UserProfile>({ queryKey: ["/api/profile"] });
  const { draft, setDraft, dirty, acknowledge } = useSettingsDraft({ dailyDigest: profile?.dailyDigest ?? true, contentAlerts: profile?.contentAlerts ?? false, productUpdates: profile?.productUpdates ?? true });
  const mutation = useMutation({
    mutationFn: async (values: typeof draft): Promise<UserProfile> => (await apiRequest("PATCH", "/api/profile", values)).json(),
    onSuccess: (saved, submitted) => {
      acknowledge(submitted);
      cache.setQueryData(["/api/profile"], saved);
      void cache.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({ title: "Notifications saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save notifications", description: error.message, variant: "destructive" }),
  });
  if (isLoading) return <output>Loading notification preferences…</output>;
  if (isError || !profile) return <div role="alert">Notification preferences could not be loaded. <Button className="min-h-11" variant="outline" onClick={() => refetch()}>Retry</Button></div>;
  return <Card><CardHeader><CardTitle>Notification preferences</CardTitle><CardDescription>Choose what updates you want to receive.</CardDescription></CardHeader><CardContent className="space-y-6">
    <fieldset disabled={mutation.isPending} className="space-y-4">
      {preferences.map(({ key, label, description }) => <Label key={key} className="flex min-h-11 cursor-pointer items-center justify-between gap-4" htmlFor={key}>
        <span><span className="block text-sm font-medium">{label}</span><span id={`${key}-help`} className="block text-sm text-muted-foreground">{description}</span></span>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center"><input id={key} type="checkbox" role="switch" aria-describedby={`${key}-help`} checked={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} className="h-5 w-5 accent-primary" /></span>
      </Label>)}
    </fieldset>
    <Button className="min-h-11" disabled={!dirty || mutation.isPending} onClick={() => mutation.mutate(draft)} data-testid="button-save-notifications">{mutation.isPending ? "Saving…" : "Save Notifications"}</Button>
  </CardContent></Card>;
}