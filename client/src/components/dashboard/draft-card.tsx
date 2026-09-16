import { useState } from "react";
import { ChevronDown, ChevronUp, Send, CalendarClock, MoreVertical, Pencil, Trash2, XCircle } from "lucide-react";
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
import { canChangeSchedule, draftStatusGroup, type PublishingSchedule } from "@/lib/publishing";
import { ScheduleTargetActions } from "@/components/publishing-target-actions";
import { PublishReceipt } from "./publish-receipt";
import type { Draft } from "@shared/schema";

// Beyond this length the 3-line clamp visibly cuts off content mid-sentence,
// so only show the expand toggle when it would actually do something.
const CONTENT_PREVIEW_THRESHOLD = 220;

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
  selected: boolean;
  onToggleSelect: () => void;
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
  scheduleBlocker?: string | null;
}

export function DraftCard({
  draft,
  scheduleInfo,
  selected,
  onToggleSelect,
  onPost,
  onEdit,
  onCopyToDraft,
  canEdit = true,
  onSchedule,
  onCancelSchedule,
  onDeleteRequest,
  timeZone = "UTC",
  canSchedule = false,
  scheduleBlocker,
}: DraftCardProps) {
  const [expanded, setExpanded] = useState(false);
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
  const canExpand = draft.content.length > CONTENT_PREVIEW_THRESHOLD;

  return (
    <Card className="overflow-visible hover-elevate hover-lift" data-testid={`card-draft-${draft.id}`}>
      <CardContent className="p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {canSchedule && draft.publishStatus === "draft" && (
              <Checkbox
                checked={selected}
                onCheckedChange={onToggleSelect}
                aria-label={`Select ${meta.label} draft`}
                data-testid={`checkbox-select-${draft.id}`}
              />
            )}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary/15 text-secondary">
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
                {draft.createdAt ? new Date(draft.createdAt).toLocaleDateString() : ""}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={needsAttention ? "destructive" : "outline"} className="capitalize">
              {draft.publishStatus || "unknown"}
            </Badge>
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

        {isScheduled && scheduledFor && (
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-secondary/10 px-2.5 py-1 text-xs font-medium text-secondary">
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
        <p id={`draft-content-${draft.id}`} className={`break-words whitespace-pre-wrap text-sm leading-relaxed ${expanded ? "" : "line-clamp-3"}`}>{draft.content}</p>
        {canExpand && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`draft-content-${draft.id}`}
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            data-testid={`button-toggle-expand-${draft.id}`}
          >
            {expanded ? (
              <>
                Show less <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                Show more <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        )}

        <MediaPreview media={draft.media} />
        {(isPublished || draft.publishedAt) && <p className="mt-3 text-xs text-muted-foreground">
          {draft.publishedAt ? `Published ${formatCalendarDate(new Date(draft.publishedAt).toISOString(), timeZone, { month: "short", day: "numeric", year: "numeric" })} at ${formatCalendarTime(new Date(draft.publishedAt).toISOString(), timeZone)} (${timeZone})` : "Publication time is unavailable."}
        </p>}
        {(isPublished || needsAttention || schedule || draft.status === "published") && <PublishReceipt draftId={draft.id} />}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
          {(isPublished || draft.status === "published" || !!draft.publishedAt) && onCopyToDraft && <Button variant="outline" size="sm" onClick={onCopyToDraft}>Copy to new draft</Button>}
          <Button size="sm" onClick={onPost} data-testid={`button-post-${draft.id}`}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Publishing options
          </Button>
          {!isPublished && !needsAttention && (
            <Button variant="outline" size="sm" disabled={!canSchedule} onClick={onSchedule} data-testid={`button-schedule-${draft.id}`}>
              <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
              {isScheduled ? "Reschedule" : "Schedule"}
            </Button>
          )}
        </div>
        {scheduleBlocker && !isPublished && <p className="mt-2 break-words text-xs text-muted-foreground">{scheduleBlocker}</p>}
      </CardContent>
    </Card>
  );
}
