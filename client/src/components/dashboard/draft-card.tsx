import { useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, Send, CalendarClock, MoreVertical, Pencil, Trash2, XCircle, RotateCcw } from "lucide-react";
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
}

interface DraftCardProps {
  draft: Draft;
  scheduleInfo?: DraftScheduleInfo;
  selected: boolean;
  onToggleSelect: () => void;
  onPost: () => void;
  onEdit: () => void;
  onSchedule: () => void;
  onCancelSchedule: () => void;
  onRetry: () => void;
  onDeleteRequest: () => void;
}

export function DraftCard({
  draft,
  scheduleInfo,
  selected,
  onToggleSelect,
  onPost,
  onEdit,
  onSchedule,
  onCancelSchedule,
  onRetry,
  onDeleteRequest,
}: DraftCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = getPlatformMeta(draft.platform);
  const Icon = meta.icon;
  const isPublished = draft.publishStatus === "published";
  const isScheduled = draft.publishStatus === "scheduled";
  const isFailed = draft.publishStatus === "failed";
  const scheduledFor = scheduleInfo?.scheduledPublishAt ?? (draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null);
  const canExpand = draft.content.length > CONTENT_PREVIEW_THRESHOLD;

  return (
    <Card className="overflow-visible hover-elevate hover-lift" data-testid={`card-draft-${draft.id}`}>
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {!isPublished && (
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
            <Badge variant={isFailed ? "destructive" : "outline"} className="capitalize">
              {draft.publishStatus}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid={`button-menu-${draft.id}`}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit} data-testid={`button-edit-${draft.id}`}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                {isScheduled && (
                  <DropdownMenuItem onClick={onCancelSchedule} data-testid={`button-cancel-schedule-${draft.id}`}>
                    <XCircle className="mr-2 h-3.5 w-3.5" />
                    Cancel schedule
                  </DropdownMenuItem>
                )}
                {isFailed && (
                  <DropdownMenuItem onClick={onRetry} data-testid={`button-retry-${draft.id}`}>
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Retry publish
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
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
            Scheduled for {format(new Date(scheduledFor), "MMM d, yyyy 'at' h:mm a")} UTC
          </div>
        )}
        {isFailed && scheduleInfo?.lastError && (
          <div className="mb-3 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" data-testid={`text-error-${draft.id}`}>
            {scheduleInfo.lastError}
          </div>
        )}

        <p className={`whitespace-pre-wrap text-sm leading-relaxed ${expanded ? "" : "line-clamp-3"}`}>{draft.content}</p>
        {canExpand && (
          <button
            type="button"
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

        <div className="mt-4 flex items-center gap-2 border-t pt-3">
          <Button size="sm" onClick={onPost} data-testid={`button-post-${draft.id}`}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Post to {meta.label}
          </Button>
          {!isPublished && (
            <Button variant="outline" size="sm" onClick={onSchedule} data-testid={`button-schedule-${draft.id}`}>
              <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
              {isScheduled ? "Reschedule" : "Schedule"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
