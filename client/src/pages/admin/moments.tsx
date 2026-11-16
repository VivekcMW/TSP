import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, Plus } from "lucide-react";
import { useIsSignedIn } from "@/lib/dev-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fieldControlClassName } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  MOMENT_DESCRIPTION_MAX, MOMENT_FILTERS, MOMENT_LEAD_DAYS, MOMENT_REGION_LABELS, MOMENT_REGIONS, MOMENT_TITLE_MAX, momentInputSchema,
  type MomentFilter, type MomentRegion,
} from "@shared/moments";
import { ADMIN_MOMENTS_KEY, adminMomentsQuery, archiveMoment, saveMoment, shortDate, type AdminMoment } from "@/lib/moments-queries";

const FILTER_LABELS: Record<MomentFilter, string> = { upcoming: "Upcoming", past: "Past", archived: "Archived" };

interface FormState { title: string; startsOn: string; endsOn: string; region: MomentRegion; tags: string; leadDays: string; url: string; description: string }
const emptyForm: FormState = { title: "", startsOn: "", endsOn: "", region: "global", tags: "", leadDays: String(MOMENT_LEAD_DAYS.default), url: "", description: "" };
const formFrom = (moment: AdminMoment): FormState => ({ title: moment.title, startsOn: moment.startsOn, endsOn: moment.endsOn ?? "", region: moment.region,
  tags: moment.tags.join(", "), leadDays: String(moment.leadDays), url: moment.url ?? "", description: moment.description ?? "" });

/** The same schema the server uses; returns the first problem in plain words. */
function parseForm(form: FormState) {
  if (!form.title.trim()) return { error: "Add a title." };
  if (!form.startsOn) return { error: "Choose a start date." };
  const parsed = momentInputSchema.safeParse({
    title: form.title, startsOn: form.startsOn, endsOn: form.endsOn || null, region: form.region,
    tags: form.tags.split(",").map(tag => tag.trim()).filter(Boolean), leadDays: Number(form.leadDays),
    url: form.url.trim() || null, description: form.description.trim() || null,
  });
  if (parsed.success) return { value: parsed.data };
  const issue = parsed.error.errors[0];
  const field = String(issue?.path[0] ?? "");
  const label: Record<string, string> = { title: "Title", startsOn: "Start date", endsOn: "End date", tags: "Tags", leadDays: "Lead time", url: "Link", description: "Description" };
  return { error: `${label[field] ? `${label[field]}: ` : ""}${issue?.message ?? "Check the form"}` };
}

const dateRange = (moment: AdminMoment) => `${shortDate(moment.startsOn)}${moment.endsOn && moment.endsOn !== moment.startsOn ? ` – ${shortDate(moment.endsOn)}` : ""} ${moment.startsOn.slice(0, 4)}`;

export default function AdminMomentsPage() {
  const isSignedIn = useIsSignedIn();
  const { toast } = useToast();
  const [filter, setFilter] = useState<MomentFilter>("upcoming");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState<AdminMoment | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ ...adminMomentsQuery(filter), enabled: !!isSignedIn });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ADMIN_MOMENTS_KEY });

  const save = useMutation({
    mutationFn: async () => {
      const parsed = parseForm(form);
      if (!parsed.value) throw new Error(parsed.error);
      return saveMoment(parsed.value, reason, editing && editing !== "new" ? editing.id : undefined);
    },
    onSuccess: saved => {
      toast({ title: editing === "new" ? "Moment added" : "Moment saved", description: saved.title });
      setEditing(null);
      void refresh();
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const archive = useMutation({
    mutationFn: ({ moment, archived }: { moment: AdminMoment; archived: boolean }) => archiveMoment(moment.id, archived, reason),
    onSuccess: saved => { toast({ title: saved.archived ? "Moment archived" : "Moment restored", description: saved.title }); void refresh(); },
    onError: (error: Error) => toast({ title: "Could not update the moment", description: error.message, variant: "destructive" }),
  });

  const hasReason = reason.trim().length > 0;
  const openForm = (moment: AdminMoment | "new") => {
    setEditing(moment);
    setForm(moment === "new" ? emptyForm : formFrom(moment));
    setFormError(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseForm(form);
    if (!parsed.value) { setFormError(parsed.error); return; }
    setFormError(null);
    save.mutate();
  };
  const field = <K extends keyof FormState>(key: K) => ({ value: form[key], onChange: (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value })) });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={CalendarDays} title="Industry moments"
        subtitle="Dates people may want to post about. Shown to members whose topics, companies or industry match a tag, in their region."
        actions={<Button disabled={!hasReason} onClick={() => openForm("new")} data-testid="button-new-moment"><Plus className="mr-2 h-4 w-4" aria-hidden="true" />New moment</Button>} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="space-y-2">
            <Label htmlFor="moment-change-reason">Change reason</Label>
            <Input id="moment-change-reason" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} aria-describedby="moment-change-reason-help" />
            <p id="moment-change-reason-help" className="text-xs text-muted-foreground">Required to add, edit or archive. Saved with the audit entry.</p>
          </div>
          <div role="group" aria-label="Show moments" className="flex flex-wrap gap-2">
            {MOMENT_FILTERS.map(value => (
              <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "outline"} aria-pressed={filter === value}
                onClick={() => setFilter(value)} data-testid={`filter-moments-${value}`}>{FILTER_LABELS[value]}</Button>
            ))}
          </div>
          <Card>
            <CardContent className="p-0">
              {isLoading ? <div className="space-y-2 p-5">{[0, 1, 2].map(index => <Skeleton key={index} className="h-14 w-full" />)}</div>
                : isError ? <AdminQueryError onRetry={() => refetch()} message="Moments could not be loaded." />
                : !data?.length ? <p className="p-8 text-center text-sm text-muted-foreground">No {FILTER_LABELS[filter].toLowerCase()} moments.</p>
                : <ul className="divide-y" aria-label={`${FILTER_LABELS[filter]} moments`}>
                  {data.map(moment => (
                    <li key={moment.id} className="grid min-w-0 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" data-testid={`row-moment-${moment.id}`}>
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs text-muted-foreground">{dateRange(moment)} · {MOMENT_REGION_LABELS[moment.region] ?? moment.region} · {moment.leadDays}-day lead</p>
                        <p className="font-medium [overflow-wrap:anywhere]">{moment.title}
                          {moment.url && <a href={moment.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center text-primary">
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Open link for {moment.title} (new tab)</span></a>}
                        </p>
                        {moment.description && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{moment.description}</p>}
                        <div className="flex flex-wrap gap-1">{moment.tags.length ? moment.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)
                          : <span className="text-xs text-muted-foreground">No tags: shown to nobody</span>}</div>
                      </div>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <Button size="sm" variant="outline" disabled={!hasReason || archive.isPending} onClick={() => openForm(moment)}>
                          Edit<span className="sr-only"> {moment.title}</span>
                        </Button>
                        <Button size="sm" variant="outline" disabled={!hasReason || archive.isPending} onClick={() => archive.mutate({ moment, archived: !moment.archived })}>
                          {moment.archived ? "Restore" : "Archive"}<span className="sr-only"> {moment.title}</span>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>}
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={editing !== null} onOpenChange={open => { if (!open && !save.isPending) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New moment" : "Edit moment"}</DialogTitle>
            <DialogDescription>Members see it in "Coming up" from the lead time before it starts until it ends.</DialogDescription>
          </DialogHeader>
          <form id="moment-form" className="grid min-w-0 gap-4" onSubmit={submit} noValidate>
            <div className="grid gap-2"><Label htmlFor="moment-title">Title</Label><Input id="moment-title" maxLength={MOMENT_TITLE_MAX} required {...field("title")} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="moment-starts">Starts on</Label><Input id="moment-starts" type="date" required {...field("startsOn")} /></div>
              <div className="grid gap-2"><Label htmlFor="moment-ends">Ends on (optional)</Label><Input id="moment-ends" type="date" min={form.startsOn || undefined} {...field("endsOn")} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="moment-region">Region</Label>
                <select id="moment-region" className={fieldControlClassName} value={form.region} onChange={event => setForm(current => ({ ...current, region: event.target.value as MomentRegion }))}>
                  {MOMENT_REGIONS.map(region => <option key={region} value={region}>{MOMENT_REGION_LABELS[region]}</option>)}
                </select></div>
              <div className="grid gap-2"><Label htmlFor="moment-lead">Lead time (days)</Label><Input id="moment-lead" type="number" inputMode="numeric" min={MOMENT_LEAD_DAYS.min} max={MOMENT_LEAD_DAYS.max} {...field("leadDays")} /></div>
            </div>
            <div className="grid gap-2"><Label htmlFor="moment-tags">Tags</Label>
              <Input id="moment-tags" aria-describedby="moment-tags-help" placeholder="fintech, payments" {...field("tags")} />
              <p id="moment-tags-help" className="text-xs text-muted-foreground">Up to 10, separated by commas. Matched against members' topics, companies and industry. Use "all" for everyone.</p></div>
            <div className="grid gap-2"><Label htmlFor="moment-url">Link (optional)</Label><Input id="moment-url" type="url" inputMode="url" placeholder="https://" {...field("url")} /></div>
            <div className="grid gap-2"><Label htmlFor="moment-description">Description (optional)</Label>
              <Textarea id="moment-description" maxLength={MOMENT_DESCRIPTION_MAX} rows={2} {...field("description")} /></div>
            {formError && <p role="alert" className="text-sm font-medium text-destructive [overflow-wrap:anywhere]">{formError}</p>}
          </form>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" form="moment-form" disabled={save.isPending || !hasReason} className={cn(save.isPending && "opacity-80")} data-testid="button-save-moment">
              {save.isPending ? "Saving…" : "Save moment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
