import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { announcementSchema, type Announcement, type AnnouncementCampaign, type AnnouncementPreview } from "@shared/email-announcements";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsSignedIn } from "@/lib/dev-auth";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AdminQueryError } from "@/components/admin/admin-query-error";

const initial: Announcement = { type: "product_update", title: "", body: "", actionLabel: "Learn more", actionUrl: "" };
const labels = { product_update: "Product update", maintenance: "Maintenance notice", incident: "Incident notice" };
export default function AdminEmailAnnouncementsPage() {
  const signedIn = useIsSignedIn();
  const { toast } = useToast();
  const [content, setContent] = useState(initial);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<AnnouncementPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const list = useQuery<{ enabled: boolean; testEnabled: boolean; campaigns: AnnouncementCampaign[] }>({
    queryKey: ["/api/admin/email-announcements"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/email-announcements", undefined, { headers: { "x-access-reason": "Review platform email announcement progress" } })).json(),
    enabled: signedIn,
    refetchInterval: 15_000,
  });
  const prepare = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/email-announcements/preview", announcementSchema.parse(content),
      { headers: { "x-access-reason": reason.trim() } })).json() as Promise<AnnouncementPreview>,
    onSuccess: result => { setPreview(result); setAccepted(false); queryClient.invalidateQueries({ queryKey: ["/api/admin/email-announcements"] }); },
    onError: (error: Error) => toast({ title: "Could not prepare email preview", description: error.message, variant: "destructive" }),
  });
  const confirm = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Prepare a preview first");
      await apiRequest("POST", `/api/admin/email-announcements/${preview.campaign.id}/confirm`, { confirm: true }, { headers: { "x-access-reason": reason.trim() } });
    },
    onSuccess: () => {
      setAccepted(true); setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-announcements"] });
      toast({ title: "Announcement confirmed", description: "The scheduler will process the saved audience. Track results below." });
    },
    onError: (error: Error) => toast({ title: "Announcement was not confirmed", description: `${error.message} Retry the same preview to avoid creating a second announcement.`, variant: "destructive" }),
  });
  const pause = useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused: boolean }) => {
      await apiRequest("POST", `/api/admin/email-announcements/${id}/pause`, { paused }, { headers: { "x-access-reason": reason.trim() } });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/email-announcements"] }); toast({ title: "Campaign admission updated", description: "Already-admitted sends may finish. Refresh progress to inspect outcomes." }); },
    onError: (error: Error) => toast({ title: "Campaign update failed", description: error.message, variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Prepare a preview first");
      return (await apiRequest("POST", `/api/admin/email-announcements/${preview.campaign.id}/test`, { confirm: true },
        { headers: { "x-access-reason": reason.trim() } })).json() as Promise<{ outcome: string }>;
    },
    onSuccess: result => toast({ title: `Test delivery: ${result.outcome}`, description: "Addressed only to your signed-in account. Preferences apply; an unknown result is never automatically replayed." }),
    onError: (error: Error) => toast({ title: "Test outcome unavailable", description: error.message, variant: "destructive" }),
  });
  const busy = prepare.isPending || confirm.isPending || pause.isPending || test.isPending;
  function update(patch: Partial<Announcement>) { setContent(value => ({ ...value, ...patch })); setPreview(null); setAccepted(false); }
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Mail} title="Email announcements" subtitle="Preview and confirm product updates, maintenance and incident notices. Existing email preferences always apply." />
      <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {list.isError && <AdminQueryError onRetry={() => list.refetch()} message="Announcement status could not be loaded." />}
        {list.data && !list.data.enabled && <Alert><AlertDescription>Announcement dispatch is disabled. Previews are available, but a deployment operator must enable EMAIL_ANNOUNCEMENTS_ENABLED on the API and production scheduler before confirmation.</AlertDescription></Alert>}
        <Card className="max-w-4xl mx-auto">
          <CardHeader><CardTitle>Compose announcement</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Email type" render={props => (
              <Select value={content.type} disabled={busy} onValueChange={value => {
                const parsed = announcementSchema.shape.type.safeParse(value);
                if (parsed.success) update({ type: parsed.data });
              }}>
                <SelectTrigger {...props}><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(labels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            )} />
            <Field label="Subject" render={props => <Input {...props} value={content.title} maxLength={160} disabled={busy} onChange={event => update({ title: event.target.value })} />} />
            <Field label="Message" help="Plain text only. Separate paragraphs with a blank line." render={props => <Textarea {...props} value={content.body} maxLength={5000} rows={7} disabled={busy} onChange={event => update({ body: event.target.value })} />} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button label" render={props => <Input {...props} value={content.actionLabel} maxLength={60} disabled={busy} onChange={event => update({ actionLabel: event.target.value })} />} />
              <Field label="Button link" help="An HTTPS link without credentials." render={props => <Input {...props} type="url" value={content.actionUrl} maxLength={2048} disabled={busy} onChange={event => update({ actionUrl: event.target.value })} />} />
            </div>
            <Field label="Reason for this announcement" help="Recorded in the administrative audit log." render={props => <Input {...props} value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} />} />
            <p className="text-sm text-muted-foreground">Audience: verified users in active workspaces whose product-update preference is enabled. One email per account, regardless of workspace count. Opt-outs are checked again at delivery.</p>
            <Button disabled={busy || !reason.trim() || !announcementSchema.safeParse(content).success} onClick={() => prepare.mutate()}>Prepare preview and audience</Button>
          </CardContent>
        </Card>
        {preview && <Card className="max-w-4xl mx-auto">
          <CardHeader><CardTitle>Review before sending</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm"><strong>{preview.campaign.audienceCount}</strong> accounts in the saved audience. This preview has not sent any emails.</p>
            <iframe title="Announcement email preview" sandbox="" srcDoc={preview.html} className="w-full h-[640px] border rounded-md bg-background" />
            <Button variant="outline" disabled={busy || !list.data?.testEnabled || !reason.trim()} onClick={() => test.mutate()}>Send one test to my account</Button>
            <p className="text-xs text-muted-foreground">Test sending must be enabled separately. The same preview sends at most one test to your own account; it does not contact the saved audience.</p>
            <Button onClick={() => setConfirmOpen(true)} disabled={busy || accepted || !list.data?.enabled || preview.campaign.audienceCount === 0 || !reason.trim()}>
              {accepted ? "Confirmed for delivery" : "Review and confirm send"}
            </Button>
          </CardContent>
        </Card>}
        <Card className="max-w-4xl mx-auto">
          <CardHeader><CardTitle>Recent announcements</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {list.isLoading ? <p role="status">Loading announcements...</p> : list.data?.campaigns.length === 0 ? <p className="text-sm text-muted-foreground">No announcements yet.</p> : list.data?.campaigns.map(campaign => (
              <div key={campaign.id} className="border-b pb-4 space-y-1">
                <p className="font-medium break-words">{campaign.content.title}</p>
                <p className="text-sm text-muted-foreground">{labels[campaign.content.type]} · {campaign.status} · {new Date(campaign.createdAt).toLocaleString()}</p>
                <p className="text-sm">{campaign.processedCount}/{campaign.audienceCount} processed · {campaign.sentCount} provider accepted · {campaign.suppressedCount} suppressed · {campaign.unknownCount} uncertain · {campaign.failedCount} failed</p>
                {(campaign.status === "active" || campaign.status === "paused") && <Button variant="outline" size="sm"
                  disabled={busy || !reason.trim() || (campaign.status === "paused" && !list.data?.enabled)}
                  onClick={() => pause.mutate({ id: campaign.id, paused: campaign.status === "active" })}>
                  {campaign.status === "active" ? "Pause new sends" : "Resume saved audience"}
                </Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this announcement?</AlertDialogTitle>
            <AlertDialogDescription>This confirms “{preview?.campaign.content.title}” for {preview?.campaign.audienceCount} accounts. Delivery begins on the next scheduler cycle and cannot be recalled. Users who opt out before dispatch will be skipped.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirm.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={confirm.isPending || accepted || !list.data?.enabled} onClick={event => { event.preventDefault(); confirm.mutate(); }}>Confirm send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
