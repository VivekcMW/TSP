import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { EmailPreferencePatch, EmailPreferenceValues } from "@shared/email-preferences";
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
  { key: "marketing", label: "Marketing", description: "Optional offers, independent of other notifications." },
  { key: "publishing", label: "Publishing Updates", description: "Draft and publishing results." },
  { key: "accountAlerts", label: "Account Alerts", description: "Optional connection and usage updates." },
] as const;

export function NotificationSettings() {
  const cache = useQueryClient();
  const { toast } = useToast();
  const { data: profile, isLoading, isError, refetch } = useQuery<EmailPreferenceValues>({ queryKey: ["/api/email-preferences"] });
  const { draft, setDraft, dirty, acknowledge } = useSettingsDraft({ dailyDigest: profile?.dailyDigest ?? true, contentAlerts: profile?.contentAlerts ?? false, productUpdates: profile?.productUpdates ?? true,
    marketing: profile?.marketing ?? true, publishing: profile?.publishing ?? true, accountAlerts: profile?.accountAlerts ?? true,
    digestTimezone: profile?.digestTimezone ?? "UTC", digestTime: profile?.digestTime ?? "09:00" });
  const edits = useRef<EmailPreferencePatch>({});
  useEffect(() => { if (!dirty) edits.current = {}; }, [dirty]);
  function edit<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    edits.current = { ...edits.current, [key]: value };
    setDraft({ ...draft, [key]: value });
  }
  const mutation = useMutation({
    mutationFn: async ({ patch }: { values: typeof draft; patch: EmailPreferencePatch }): Promise<EmailPreferenceValues> => (await apiRequest("PATCH", "/api/email-preferences", patch)).json(),
    onSuccess: (saved, { values: submitted }) => {
      const savedDraft = Object.fromEntries(Object.keys(submitted).map(key => [key, saved[key as keyof EmailPreferenceValues]])) as typeof draft;
      acknowledge(submitted, savedDraft);
      edits.current = {};
      cache.setQueryData(["/api/email-preferences"], saved);
      void cache.invalidateQueries({ queryKey: ["/api/email-preferences"] });
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
        <span className="flex h-11 w-11 shrink-0 items-center justify-center"><input id={key} type="checkbox" role="switch" aria-describedby={`${key}-help`} checked={draft[key]} onChange={(event) => edit(key, event.target.checked)} className="h-5 w-5 accent-primary" /></span>
      </Label>)}
      <Label className="block" htmlFor="digest-time"><span className="block">Daily digest time</span>
        <input id="digest-time" type="time" value={draft.digestTime} onChange={event => edit("digestTime", event.target.value)} className="block min-h-11 rounded border p-2" />
      </Label>
      <Label className="block" htmlFor="digest-timezone"><span className="block">Digest timezone (IANA name)</span>
        <input id="digest-timezone" value={draft.digestTimezone} placeholder="Asia/Kolkata" onChange={event => edit("digestTimezone", event.target.value)} className="block min-h-11 rounded border p-2" />
      </Label>
      <p className="text-sm text-muted-foreground">Essential security and billing messages remain enabled. Digest times follow daylight saving changes.</p>
    </fieldset>
    <Button className="min-h-11" disabled={!dirty || mutation.isPending} onClick={() => mutation.mutate({ values: draft, patch: { ...edits.current } })} data-testid="button-save-notifications">{mutation.isPending ? "Saving…" : "Save Notifications"}</Button>
  </CardContent></Card>;
}