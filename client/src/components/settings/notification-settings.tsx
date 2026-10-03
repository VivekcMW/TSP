import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import type { EmailPreferencePatch, EmailPreferenceValues } from "@shared/email-preferences";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, fieldLabelRowClassName } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Label } from "@/components/ui/label";
import { useSettingsDraft } from "./use-settings-draft";

const preferences = [
  { key: "dailyDigest", label: "Daily Digest", description: "Receive a daily email with your curated content." },
  { key: "reminders", label: "Posting reminders", description: "A weekly nudge with stories worth posting about, when you've been quiet for a week." },
  { key: "contentAlerts", label: "New Content Alerts", description: "Get notified when high-priority content arrives." },
  { key: "productUpdates", label: "Product Updates", description: "Learn about new features and improvements." },
  { key: "marketing", label: "Marketing", description: "Optional offers, independent of other notifications." },
  { key: "publishing", label: "Publishing Updates", description: "Draft and publishing results." },
  { key: "accountAlerts", label: "Account Alerts", description: "Optional connection and usage updates." },
] as const;

const longDate = (value: string | Date) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function NotificationSettings() {
  const cache = useQueryClient();
  const { toast } = useToast();
  const { data: profile, isLoading, isError, refetch } = useQuery<EmailPreferenceValues>({ queryKey: ["/api/email-preferences"] });
  const { draft, setDraft, dirty, acknowledge } = useSettingsDraft({ dailyDigest: profile?.dailyDigest ?? true, reminders: profile?.reminders ?? true, contentAlerts: profile?.contentAlerts ?? false, productUpdates: profile?.productUpdates ?? true,
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
  // Reminder emails link here with ?pause=reminders ("Pause for a month"). Pausing saves straight away,
  // separately from the form, and the link works once.
  const search = useSearch();
  const [location, navigate] = useLocation();
  const pauseRequested = new URLSearchParams(search).get("pause") === "reminders";
  const pausing = useRef(false);
  const pause = useMutation({
    mutationFn: async (until: string | null): Promise<EmailPreferenceValues> => (await apiRequest("PATCH", "/api/email-preferences", { remindersPausedUntil: until })).json(),
    onSuccess: (saved, until) => {
      cache.setQueryData(["/api/email-preferences"], saved);
      toast(until ? { title: `Reminders paused until ${longDate(until)}`, description: "You can resume them here any time." } : { title: "Reminders resumed" });
    },
    onError: (error: Error) => toast({ title: "Could not update reminders", description: error.message, variant: "destructive" }),
  });
  useEffect(() => {
    if (!pauseRequested || !profile || pausing.current) return;
    pausing.current = true;
    const rest = new URLSearchParams(search);
    rest.delete("pause");
    navigate(`${location}?${rest.toString()}`, { replace: true });
    pause.mutate(new Date(Date.now() + 30 * 86_400_000).toISOString());
  }, [pauseRequested, profile]);
  const pausedUntil = profile?.remindersPausedUntil ? new Date(profile.remindersPausedUntil) : null;
  const paused = pausedUntil && pausedUntil.getTime() > Date.now() ? pausedUntil : null;
  if (isLoading) return <output>Loading notification preferences…</output>;
  if (isError || !profile) return <div role="alert">Notification preferences could not be loaded. <Button variant="outline" onClick={() => refetch()}>Retry</Button></div>;
  return <Card><CardHeader><CardTitle help="Choose what updates you want to receive.">Notification preferences</CardTitle></CardHeader><CardContent className="space-y-6">
    <fieldset disabled={mutation.isPending} className="min-w-0 space-y-4">
      {preferences.map(({ key, label, description }) => {
        // Keep optional-offer and account-update consent visible.
        const keepDescriptionVisible = key === "marketing" || key === "accountAlerts";
        return <div key={key} className="flex min-h-11 items-center justify-between gap-4">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <div className={fieldLabelRowClassName}>
              <Label id={`${key}-label`} htmlFor={key} className="flex min-h-11 min-w-0 cursor-pointer items-center">{label}</Label>
              {!keepDescriptionVisible && <InfoTooltip label={label} descriptionId={`${key}-help`}>{description}</InfoTooltip>}
            </div>
            {keepDescriptionVisible && <p id={`${key}-help`} className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <label htmlFor={key} className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"><span className="sr-only">{label}</span><input id={key} type="checkbox" role="switch" aria-labelledby={`${key}-label`} aria-describedby={`${key}-help`} checked={draft[key]} onChange={(event) => edit(key, event.target.checked)} className="h-5 w-5 accent-primary" /></label>
        </div>;
      })}
      {paused && <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span>Reminders are paused until {longDate(paused)}.</span>
        <button type="button" className="control-touch-target min-h-8 min-w-8 font-medium text-primary underline underline-offset-4 disabled:opacity-50" disabled={pause.isPending} onClick={() => pause.mutate(null)}>Resume reminders</button>
      </p>}
      <div className="min-w-0 space-y-2">
        <div className={fieldLabelRowClassName}><Label htmlFor="digest-time">Daily digest time</Label><InfoTooltip label="Daily digest time" descriptionId="digest-time-help">Digest times follow daylight saving changes.</InfoTooltip></div>
        <Input id="digest-time" aria-describedby="digest-time-help" type="time" value={draft.digestTime} onChange={event => edit("digestTime", event.target.value)} />
      </div>
      <Field id="digest-timezone" label="Digest timezone (IANA name)" render={(controlProps) => <Input {...controlProps} value={draft.digestTimezone} placeholder="Asia/Kolkata" onChange={event => edit("digestTimezone", event.target.value)} />} />
      <p className="text-sm text-muted-foreground">Essential security and billing messages remain enabled.</p>
    </fieldset>
    <Button disabled={!dirty || mutation.isPending} onClick={() => mutation.mutate({ values: draft, patch: { ...edits.current } })} data-testid="button-save-notifications">{mutation.isPending ? "Saving…" : "Save Notifications"}</Button>
  </CardContent></Card>;
}