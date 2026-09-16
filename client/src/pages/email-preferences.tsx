import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Mail } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO as Seo } from "@/components/seo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Preferences { marketing: boolean; productUpdates: boolean; dailyDigest: boolean; contentAlerts: boolean; }

export default function EmailPreferencesPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Preferences>({ queryKey: ["/api/email-preferences"] });
  const mutation = useMutation({
    mutationFn: (update: Partial<Preferences>) => apiRequest("PATCH", "/api/email-preferences", update),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/email-preferences"] }); toast({ title: "Email preferences saved" }); },
    onError: () => toast({ title: "Could not save email preferences", description: "Please sign in and try again.", variant: "destructive" }),
  });
  const preferenceRows = [
    ["dailyDigest", "Daily content digest", "Your curated industry stories and recommendations."],
    ["contentAlerts", "Content alerts", "Important stories matched to your focus."],
    ["productUpdates", "Product updates", "New features, improvements, and service announcements."],
    ["marketing", "Product news and offers", "Occasional announcements and relevant product communications."],
  ] as const;
  return <div className="flex min-h-screen flex-col bg-background"><Seo title="Email Preferences" canonical="/email-preferences" description="Manage your TheSocialPundit email preferences." /><SiteHeader /><main className="flex-1 py-16"><div className="mx-auto max-w-2xl px-4 sm:px-6"><div className="mb-8"><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-secondary/15"><Mail className="h-5 w-5 text-secondary" /></div><h1 className="heading-display">Email preferences</h1><p className="mt-2 text-muted-foreground">Choose which optional emails you would like to receive.</p></div><Card><CardHeader><CardTitle>Notifications</CardTitle></CardHeader><CardContent className="space-y-5">{isLoading ? <Skeleton className="h-40 w-full" /> : preferenceRows.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-4 border-b pb-4 last:border-0 last:pb-0"><div><p className="font-medium">{label}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></div><Switch checked={Boolean(data?.[key])} onCheckedChange={(checked) => mutation.mutate({ [key]: checked })} disabled={mutation.isPending} aria-label={label} /></div>)}</CardContent></Card><p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Bell className="h-3.5 w-3.5" />Security, verification, and payment emails may still be sent when necessary.</p></div></main><SiteFooter /></div>;
}