import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Puzzle, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useIsSignedIn } from "@/lib/dev-auth";
import { PLATFORMS } from "@/lib/platforms";
import type { UserProfile } from "@shared/schema";

interface PlatformIntegration {
  key: string;
  label: string;
  enabled: boolean;
}

export default function PluginsPage() {
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<Set<string>>(new Set(PLATFORMS.map((p) => p.value)));
  const [dirty, setDirty] = useState(false);
  const [defaultPlatform, setDefaultPlatform] = useState("");
  const [defaultTone, setDefaultTone] = useState("professional");
  const [publishTime, setPublishTime] = useState("09:00");
  const [timezone, setTimezone] = useState("UTC");
  const [requireReview, setRequireReview] = useState(true);
  const [platformSearch, setPlatformSearch] = useState("");

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: !!isSignedIn,
  });

  const { data: integrations } = useQuery<PlatformIntegration[]>({
    queryKey: ["/api/integrations"],
    enabled: !!isSignedIn,
  });
  const disabledPlatforms = new Set((integrations ?? []).filter((i) => !i.enabled).map((i) => i.key));
  const visiblePlatforms = PLATFORMS.filter((platform) => platform.label.toLowerCase().includes(platformSearch.toLowerCase())).sort((a, b) => Number(enabled.has(b.value)) - Number(enabled.has(a.value)) || a.label.localeCompare(b.label));

  useEffect(() => {
    if (profile?.enabledPlatforms) {
      setEnabled(new Set(profile.enabledPlatforms));
      setDefaultPlatform(profile.defaultPlatform ?? profile.enabledPlatforms[0] ?? "");
      setDefaultTone(profile.defaultTone ?? "professional");
      setPublishTime(profile.preferredPublishTime ?? "09:00");
      setTimezone(profile.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
      setRequireReview(profile.requirePublishReview ?? true);
      setDirty(false);
    }
  }, [profile?.enabledPlatforms]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/profile", { enabledPlatforms: Array.from(enabled), defaultPlatform, defaultTone, preferredPublishTime: publishTime, timezone, requirePublishReview: requireReview });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      setDirty(false);
      toast({
        title: "Plugins updated",
        description: "Your enabled platforms have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Failed to save",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const toggle = (value: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
    setDirty(true);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        icon={Puzzle}
        title="Preferences"
        subtitle={`${enabled.size} of ${PLATFORMS.length} posting platforms enabled`}
        actions={
          dirty && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-save-plugins"
            >
              {saveMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          )
        }
      />

      <main className="flex-1 p-6 overflow-y-auto">
        <Card className="max-w-5xl mx-auto mb-6"><CardContent className="p-5"><div className="flex items-center gap-2 mb-4"><Settings2 className="h-4 w-4 text-secondary" /><h2 className="heading-dashboard text-base">Publishing defaults</h2></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"><div><p className="mb-1 text-xs text-muted-foreground">Default platform</p><Select value={defaultPlatform} onValueChange={(value) => { setDefaultPlatform(value); setDirty(true); }}><SelectTrigger><SelectValue placeholder="Choose platform" /></SelectTrigger><SelectContent>{PLATFORMS.filter((item) => enabled.has(item.value) && !disabledPlatforms.has(item.value)).map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div><div><p className="mb-1 text-xs text-muted-foreground">Default tone</p><Select value={defaultTone} onValueChange={(value) => { setDefaultTone(value); setDirty(true); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["professional", "authoritative", "contrarian", "ai-recommended"].map((tone) => <SelectItem key={tone} value={tone} className="capitalize">{tone}</SelectItem>)}</SelectContent></Select></div><div><p className="mb-1 text-xs text-muted-foreground">Preferred time</p><input type="time" value={publishTime} onChange={(event) => { setPublishTime(event.target.value); setDirty(true); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm" /></div><div><p className="mb-1 text-xs text-muted-foreground">Timezone</p><input value={timezone} onChange={(event) => { setTimezone(event.target.value); setDirty(true); }} className="h-9 w-full rounded-md border bg-background px-3 text-sm" /></div></div><label className="mt-4 flex items-center gap-3 text-sm"><Switch checked={requireReview} onCheckedChange={(value) => { setRequireReview(value); setDirty(true); }} />Require review before publishing</label></CardContent></Card>
        <div className="mx-auto mb-6 max-w-5xl"><p className="text-sm text-muted-foreground max-w-2xl">
          Start with the platforms you use most. These choices control which destinations appear when you create a draft; they never change drafts you have already made.
        </p><input value={platformSearch} onChange={(event) => setPlatformSearch(event.target.value)} placeholder="Find a platform" className="mt-4 h-10 w-full max-w-sm rounded-md border bg-background px-3 text-sm" /></div>

        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {visiblePlatforms.map((platform) => {
              const Icon = platform.icon;
              const isEnabled = enabled.has(platform.value);
              const isGloballyDisabled = disabledPlatforms.has(platform.value);
              return (
                <Card key={platform.value} className="hover-elevate" data-testid={`card-plugin-${platform.value}`}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-md bg-secondary/15 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-secondary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{platform.label}</p>
                        {isGloballyDisabled ? (
                          <Badge variant="destructive" className="text-xs mt-0.5">Unavailable platform-wide</Badge>
                        ) : (
                          <p className="text-xs text-muted-foreground">{platform.charLimit} char limit</p>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={isEnabled && !isGloballyDisabled}
                      disabled={isGloballyDisabled}
                      onCheckedChange={() => toggle(platform.value)}
                      data-testid={`switch-plugin-${platform.value}`}
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
