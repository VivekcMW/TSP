import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useIsSignedIn } from "@/lib/dev-auth";
import { PLATFORMS } from "@/lib/platforms";
import { useSettingsDraft } from "@/components/settings/use-settings-draft";
import type { SettingsPageProps } from "@/components/settings/settings-page-props";
import type { UserProfile } from "@shared/schema";

interface PlatformIntegration { key: string; label: string; enabled: boolean; }

function publishingValues(profile?: UserProfile) {
  return {
    enabledPlatforms: [...(profile?.enabledPlatforms ?? [])].sort((a, b) => a.localeCompare(b)),
    defaultPlatform: profile?.defaultPlatform ?? "",
    defaultTone: profile?.defaultTone ?? "professional",
    preferredPublishTime: profile?.preferredPublishTime ?? "09:00",
    timezone: profile?.timezone ?? "UTC",
    requirePublishReview: profile?.requirePublishReview ?? true,
  };
}

export default function PluginsPage({ embedded = false }: SettingsPageProps = {}) {
  const isSignedIn = useIsSignedIn();
  const cache = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const profileQuery = useQuery<UserProfile>({ queryKey: ["/api/profile"], enabled: isSignedIn });
  const integrationsQuery = useQuery<PlatformIntegration[]>({ queryKey: ["/api/integrations"], enabled: isSignedIn });
  const { draft, setDraft, dirty, acknowledge, reset } = useSettingsDraft(publishingValues(profileQuery.data));
  const disabled = new Set((integrationsQuery.data ?? []).filter((item) => !item.enabled).map((item) => item.key));
  const available = PLATFORMS.filter((item) => draft.enabledPlatforms.includes(item.value) && !disabled.has(item.value));
  const effectiveDefault = available.some((item) => item.value === draft.defaultPlatform) ? draft.defaultPlatform : available[0]?.value ?? "";
  const effectiveEnabled = draft.enabledPlatforms.filter((value) => !disabled.has(value));
  const needsRepair = effectiveDefault !== draft.defaultPlatform || effectiveEnabled.length !== draft.enabledPlatforms.length;
  let timezoneValid = true;
  try { new Intl.DateTimeFormat("en", { timeZone: draft.timezone }); } catch { timezoneValid = false; }
  const valid = Boolean(effectiveDefault) && timezoneValid && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.preferredPublishTime);
  const mutation = useMutation({
    mutationFn: async (values: typeof draft): Promise<UserProfile> => (await apiRequest("PATCH", "/api/profile", values)).json(),
    onSuccess: (saved, submitted) => {
      acknowledge(submitted, publishingValues(saved));
      cache.setQueryData(["/api/profile"], saved);
      void cache.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({ title: "Publishing preferences saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save publishing preferences", description: error.message, variant: "destructive" }),
  });
  const Body = embedded ? "div" : "main";
  const loading = profileQuery.isLoading || integrationsQuery.isLoading;
  const unavailable = profileQuery.isError || integrationsQuery.isError || !profileQuery.data || !integrationsQuery.data;
  function toggle(value: string) {
    setDraft((current) => {
      const enabledPlatforms = current.enabledPlatforms.includes(value) ? current.enabledPlatforms.filter((item) => item !== value) : [...current.enabledPlatforms, value].sort((a, b) => a.localeCompare(b));
      const defaultPlatform = enabledPlatforms.includes(current.defaultPlatform) && !disabled.has(current.defaultPlatform)
        ? current.defaultPlatform : PLATFORMS.find((item) => enabledPlatforms.includes(item.value) && !disabled.has(item.value))?.value ?? "";
      return { ...current, enabledPlatforms, defaultPlatform };
    });
  }
  return <div className={embedded ? "" : "flex h-full flex-col overflow-hidden"}>
    {!embedded && <PageHeader title="Publishing preferences" subtitle="Choose your posting platforms and defaults." />}
    <Body className={embedded ? "" : "flex-1 overflow-y-auto p-4 sm:p-6"}>
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {loading && <output>Loading publishing preferences…</output>}
        {!loading && unavailable && <div role="alert">Publishing preferences could not be loaded. <Button className="min-h-11" variant="outline" onClick={() => { void profileQuery.refetch(); void integrationsQuery.refetch(); }}>Retry</Button></div>}
        {!loading && !unavailable && <form className="space-y-6" onSubmit={(event) => {
          event.preventDefault();
          if (valid && (dirty || needsRepair) && !mutation.isPending) {
            const submitted = { ...draft, enabledPlatforms: effectiveEnabled, defaultPlatform: effectiveDefault };
            setDraft(submitted);
            mutation.mutate(submitted);
          }
        }}>
          <fieldset disabled={mutation.isPending} className="space-y-6">
            <Card><CardHeader><CardTitle>Publishing defaults</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="default-platform">Default platform</Label><select id="default-platform" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={effectiveDefault} onChange={(event) => setDraft({ ...draft, defaultPlatform: event.target.value })}><option value="" disabled>Choose an enabled platform</option>{available.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
                <div className="space-y-2"><Label htmlFor="default-tone">Default tone</Label><select id="default-tone" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={draft.defaultTone} onChange={(event) => setDraft({ ...draft, defaultTone: event.target.value })}>{["professional", "authoritative", "contrarian", "ai-recommended"].map((tone) => <option key={tone} value={tone}>{tone}</option>)}</select></div>
                <div className="space-y-2"><Label htmlFor="publish-time">Preferred time</Label><Input id="publish-time" className="min-h-11" required type="time" value={draft.preferredPublishTime} onChange={(event) => setDraft({ ...draft, preferredPublishTime: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="publish-timezone">Timezone</Label><Input id="publish-timezone" className="min-h-11" required value={draft.timezone} aria-invalid={!timezoneValid} aria-describedby="timezone-help" onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /><p id="timezone-help" className="text-sm text-muted-foreground">Use an IANA timezone, such as UTC or Asia/Kolkata.</p></div>
              </div>
              <label className="flex min-h-11 items-center gap-3" htmlFor="publish-review"><span className="flex h-11 w-11 items-center justify-center"><input id="publish-review" type="checkbox" role="switch" className="h-5 w-5 accent-primary" checked={draft.requirePublishReview} onChange={(event) => setDraft({ ...draft, requirePublishReview: event.target.checked })} /></span>Require review before publishing</label>
              {!effectiveDefault && <p role="alert" className="text-sm text-destructive">Enable at least one available platform before saving publishing defaults.</p>}
              {needsRepair && effectiveDefault && <p className="text-sm text-muted-foreground">Your previous default is unavailable or unset. Save to use {PLATFORMS.find((item) => item.value === effectiveDefault)?.label} and the available platforms shown here.</p>}
            </CardContent></Card>
            <div className="space-y-2"><p className="text-sm text-muted-foreground">These preferences control draft destinations, not account connections. Existing drafts are unchanged.</p><Label htmlFor="platform-search">Find a platform</Label><Input id="platform-search" className="min-h-11 max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {PLATFORMS.filter((item) => item.label.toLowerCase().includes(search.toLowerCase())).map((platform) => <Card key={platform.value} data-testid={`card-plugin-${platform.value}`}><CardContent className="p-4"><Label htmlFor={`platform-${platform.value}`} className="flex min-h-11 items-center justify-between gap-3"><span><span className="block text-sm font-medium">{platform.label}</span><span className="text-xs text-muted-foreground">{disabled.has(platform.value) ? "Unavailable platform-wide" : `${platform.charLimit} char limit`}</span></span><span className="flex h-11 w-11 shrink-0 items-center justify-center"><input id={`platform-${platform.value}`} type="checkbox" role="switch" className="h-5 w-5 accent-primary" checked={draft.enabledPlatforms.includes(platform.value) && !disabled.has(platform.value)} disabled={disabled.has(platform.value)} onChange={() => toggle(platform.value)} data-testid={`switch-plugin-${platform.value}`} /></span></Label></CardContent></Card>)}
            </div>
          </fieldset>
          {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
          <div className="flex flex-wrap gap-3"><Button className="min-h-11" type="submit" disabled={!(dirty || needsRepair) || !valid || mutation.isPending} data-testid="button-save-plugins">{mutation.isPending ? "Saving…" : "Save Publishing Preferences"}</Button><Button className="min-h-11" type="button" variant="outline" disabled={!dirty || mutation.isPending} onClick={reset}>Discard changes</Button></div>
        </form>}
      </div>
    </Body>
  </div>;
}
