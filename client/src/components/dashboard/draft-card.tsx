import { ChevronRight, Send, CalendarClock, MoreVertical, Pencil, Trash2, XCircle, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPlatformMeta } from "@/lib/platforms";
import { formatCalendarDate, formatCalendarTime } from "@/lib/calendar";
import { canChangeSchedule, draftStatusGroup, publishingStatus, type PublishingSchedule } from "@/lib/publishing";
import { ScheduleTargetActions } from "@/components/publishing-target-actions";
import { PublishReceipt } from "./publish-receipt";
import type { Draft } from "@shared/schema";

function MediaPreview({ media }: { media: Draft["media"] }) {
  if (!media?.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {media.map((item) =>
        item.type === "image" ? (
          <img key={item.id} src={item.url} alt={item.name} className="h-16 w-16 rounded-md border object-cover" />
        ) : (
          <Badge key={item.id} variant="outline" className="h-8 gap-1">
            <span className="capitalize">{item.type}</span>
            <span className="max-w-28 truncate">{item.name}</span>
          </Badge>
        ),
      )}
    </div>
  );
}

export interface DraftScheduleInfo {
  scheduledPublishAt: string | null;
  lastError: string | null;
  schedule?: PublishingSchedule;
}

export function canEditDraft(draft: Draft, schedule?: PublishingSchedule) {
  const safeStates = ["scheduled", "queued", "failed", "cancelled"];
  return draft.status !== "published" && !draft.publishedAt && ["draft", "scheduled", "failed"].includes(draft.publishStatus)
    && (!schedule || (safeStates.includes(schedule.status) && !!schedule.targets
      && schedule.targets.every(target => safeStates.includes(target.status))));
}

interface DraftCardProps {
  draft: Draft;
  scheduleInfo?: DraftScheduleInfo;
  onPost: () => void;
  onEdit: () => void;
  onCopyToDraft?: () => void;
  canEdit?: boolean;
  onSchedule: () => void;
  onCancelSchedule: () => void;
  onRetry: () => void;
  onDeleteRequest: () => void;
  timeZone?: string;
  canSchedule?: boolean;
  onResolveScheduling?: () => void;
  scheduleBlocker?: string | null;
}

function draftDisplayStatus(draft: Draft, schedule?: PublishingSchedule) {
  if (schedule && schedule.status !== "cancelled") return publishingStatus(schedule);
  if (draft.publishStatus === "draft" && draft.status !== "published" && !draft.publishedAt) {
    return { label: "Draft", className: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
  }
  if (draft.publishStatus === "simulated") return { label: "Demo only", className: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
  return { label: "Check delivery", className: "bg-warning-subtle text-warning", dot: "bg-warning" };
}

export function DraftListItem({ draft, scheduleInfo, timeZone, active, selected, selectable, onToggleSelect, onOpen }: Readonly<{
  draft: Draft;
  scheduleInfo?: DraftScheduleInfo;
  timeZone: string;
  active: boolean;
  selected: boolean;
  selectable: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}>) {
  const meta = getPlatformMeta(draft.platform), Icon = meta.icon;
  const status = draftDisplayStatus(draft, scheduleInfo?.schedule);
  const targetCount = scheduleInfo?.schedule?.targets?.length ?? 0;
  const updated = draft.updatedAt ?? draft.createdAt;
  const scheduledFor = scheduleInfo?.schedule?.status !== "cancelled" ? scheduleInfo?.scheduledPublishAt : null;
  return <div data-testid={`content-row-${draft.id}`} className={`flex min-w-0 items-start border-b last:border-b-0 ${active ? "bg-primary/5 ring-1 ring-inset ring-primary" : "hover:bg-muted/40"}`}>
    {selectable && <label className="ml-2 mt-3 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
      <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`Select ${meta.label} draft`} data-testid={`checkbox-select-${draft.id}`} />
    </label>}
    <button type="button" onClick={onOpen} aria-pressed={active} aria-controls="content-preview"
      aria-label={`Preview ${meta.label} post: ${draft.content.slice(0, 80)}`}
      data-testid={`button-preview-${draft.id}`}
      className="min-w-0 flex-1 space-y-2 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium"><Icon className="h-3.5 w-3.5 shrink-0" />{meta.label}{targetCount > 1 && <span className="text-muted-foreground">+{targetCount - 1}</span>}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${status.className}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} />{status.label}</span>
      </span>
      <span className="line-clamp-2 break-words text-sm font-medium leading-relaxed">{draft.content || "Untitled post"}</span>
      <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{scheduledFor && draft.publishStatus === "scheduled" ? `Scheduled ${formatCalendarDate(scheduledFor, timeZone, { month: "short", day: "numeric" })} at ${formatCalendarTime(scheduledFor, timeZone)}` : updated ? `Updated ${formatCalendarDate(new Date(updated).toISOString(), timeZone, { month: "short", day: "numeric", year: "numeric" })}` : "Saved draft"}</span>
        <span className="flex items-center gap-2">{!!draft.media?.length && <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" />{draft.media.length}</span>}<ChevronRight className="h-3.5 w-3.5" /></span>
      </span>
    </button>
  </div>;
}

export function DraftCard({
  draft,
  scheduleInfo,
  onPost,
  onEdit,
  onCopyToDraft,
  canEdit = true,
  onSchedule,
  onCancelSchedule,
  onDeleteRequest,
  timeZone = "UTC",
  canSchedule = false,
  onResolveScheduling,
  scheduleBlocker,
}: Readonly<DraftCardProps>) {
  const meta = getPlatformMeta(draft.platform);
  const Icon = meta.icon;
  const isPublished = draft.publishStatus === "published";
  const isScheduled = draft.publishStatus === "scheduled";
  const isFailed = draft.publishStatus === "failed";
  const needsAttention = draftStatusGroup(draft.publishStatus) === "attention";
  const schedule = scheduleInfo?.schedule;
  const changeable = canChangeSchedule(schedule);
  const uncertain = draft.publishStatus !== "draft" && !isPublished && !isFailed && !changeable;
  const scheduledFor = scheduleInfo?.scheduledPublishAt ?? (draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null);
  const displayStatus = draftDisplayStatus(draft, schedule);

  return (
    <Card className="min-w-0 overflow-visible border-0 bg-transparent shadow-none" data-testid={`card-draft-${draft.id}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-info-subtle text-info">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{meta.label}</span>
                <Badge variant="outline" className="h-5 px-1.5 text-[11px] capitalize">
                  {draft.tone}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {draft.createdAt ? `Saved ${formatCalendarDate(new Date(draft.createdAt).toISOString(), timeZone, { month: "short", day: "numeric", year: "numeric" })}` : "Saved draft"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-xs ${displayStatus.className}`}>{displayStatus.label}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${meta.label} draft`} data-testid={`button-menu-${draft.id}`}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!canEdit || !canEditDraft(draft, schedule)} onClick={onEdit} data-testid={`button-edit-${draft.id}`}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                {changeable && (
                  <DropdownMenuItem onClick={onCancelSchedule} data-testid={`button-cancel-schedule-${draft.id}`}>
                    <XCircle className="mr-2 h-3.5 w-3.5" />
                    Cancel schedule
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={uncertain}
                  onClick={onDeleteRequest}
                  className="text-destructive focus:text-destructive"
                  data-testid={`button-delete-${draft.id}`}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2 border-b pb-4">
          {(isPublished || draft.status === "published" || !!draft.publishedAt) && onCopyToDraft
            ? <Button variant="outline" size="sm" onClick={onCopyToDraft}>Copy to new draft</Button>
            : <Button size="sm" disabled={!canEdit || !canEditDraft(draft, schedule)} onClick={onEdit} data-testid={`button-edit-preview-${draft.id}`}><Pencil className="h-3.5 w-3.5" />Edit draft</Button>}
          {!isPublished && !needsAttention && <Button variant="outline" size="sm" disabled={!canSchedule} onClick={onSchedule} data-testid={`button-schedule-${draft.id}`}><CalendarClock className="h-3.5 w-3.5" />{isScheduled ? "Reschedule" : "Schedule"}</Button>}
          <Button variant="ghost" size="sm" onClick={onPost} data-testid={`button-post-${draft.id}`}><Send className="h-3.5 w-3.5" />Publishing options</Button>
        </div>
        {scheduleBlocker && !isPublished && <div className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-medium">Review before publishing</p>
          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{scheduleBlocker}</p>
          {onResolveScheduling && <Button variant="outline" size="sm" className="mt-2" onClick={onResolveScheduling} aria-label={`Resolve scheduling for ${meta.label} draft`}>Review scheduling</Button>}
        </div>}
        {isScheduled && scheduledFor && (
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-info-subtle px-2.5 py-1 text-xs font-medium text-info">
            <CalendarClock className="h-3.5 w-3.5" />
            Scheduled for {formatCalendarDate(scheduledFor, timeZone, { month: "short", day: "numeric", year: "numeric" })} at {formatCalendarTime(scheduledFor, timeZone)} ({timeZone})
          </div>
        )}
        {needsAttention && scheduleInfo?.lastError && (
          <div className="mb-3 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" data-testid={`text-error-${draft.id}`}>
            {scheduleInfo.lastError}
          </div>
        )}

        {schedule && <ScheduleTargetActions item={schedule} />}
        {needsAttention && !schedule && <p className="mb-3 text-sm text-muted-foreground">Delivery is not fully confirmed. Target details are unavailable; check the provider before retrying.</p>}
        <p id={`draft-content-${draft.id}`} className="mb-4 break-words whitespace-pre-wrap text-sm leading-7">{draft.content}</p>

        <MediaPreview media={draft.media} />
        {(isPublished || draft.publishedAt) && <p className="mt-3 text-xs text-muted-foreground">
          {draft.publishedAt ? `Published ${formatCalendarDate(new Date(draft.publishedAt).toISOString(), timeZone, { month: "short", day: "numeric", year: "numeric" })} at ${formatCalendarTime(new Date(draft.publishedAt).toISOString(), timeZone)} (${timeZone})` : "Publication time is unavailable."}
        </p>}
        {(isPublished || needsAttention || schedule || draft.status === "published") && <PublishReceipt draftId={draft.id} />}

      </CardContent>
    </Card>
  );
}
