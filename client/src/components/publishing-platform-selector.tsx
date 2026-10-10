import { useId, useRef, useState } from "react";
import { ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import type { Draft } from "@shared/schema";
import { MAX_DRAFT_CHARACTERS } from "@shared/editorial";
import { getPlatformMeta, PLATFORMS } from "@/lib/platforms";
import { accountPublishingBlocker, DIRECT_PUBLISH_PLATFORMS, invalidatePublishingQueries, publishingBlocker, publishingTextValidation, type ReadinessData, type ReadinessDraft } from "@/lib/publishing";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { WorkflowStatus } from "@/components/dashboard/workflow-status";
import { cn } from "@/lib/utils";

const MAX_TARGETS = 4;
const linkClassName = "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function PublishingPlatformSelector({ platforms, onChange, draft, readiness, disabled = false }: Readonly<{
  platforms: string[];
  onChange: (platforms: string[]) => void;
  draft?: ReadinessDraft & Partial<Pick<Draft, "platform">>;
  readiness: ReadinessData;
  disabled?: boolean;
}>) {
  const id = useId();
  const destinationReason = draft?.platform ? publishingBlocker(draft.platform, draft, readiness) : null;
  const options = PLATFORMS.map(platform => ({ ...platform, selected: platforms.includes(platform.value), reason: publishingBlocker(platform.value, draft, readiness), accountReason: accountPublishingBlocker(platform.value, readiness) }));
  // Draft-level blockers stay visible next to the platform; selected targets stay removable.
  const selectable = options.filter(option => option.selected || !option.accountReason);
  const unavailable = options.filter(option => !option.selected && option.accountReason);
  const full = platforms.length >= MAX_TARGETS;
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <legend className="mb-2 flex w-full items-center justify-between gap-2 text-sm font-medium leading-5">
      <span>Platforms</span>
      <span className={cn("text-xs font-normal tabular-nums", full ? "text-foreground" : "text-muted-foreground")}>{platforms.length} of {MAX_TARGETS} selected</span>
    </legend>
    {destinationReason && <WorkflowStatus tone="warning">Draft destination {PLATFORMS.find(platform => platform.value === draft?.platform)?.label ?? draft?.platform} is unavailable: {destinationReason} No alternative was selected automatically.</WorkflowStatus>}
    {selectable.length ? <div className="grid gap-2 sm:grid-cols-2">
      {selectable.map(({ value, label, icon: Icon, selected, reason }) => <label key={value} className={cn(
        "flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-sm transition-colors motion-reduce:transition-none has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
        selected ? "border-primary bg-accent text-accent-foreground" : "border-input bg-card hover:bg-muted",
      )}>
        <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-none" checked={selected}
          aria-label={label} aria-describedby={reason ? `${id}-${value}` : undefined}
          disabled={!selected && (full || !!reason)}
          onChange={() => {
            if (selected) onChange(platforms.filter(item => item !== value));
            else if (!full && !reason) onChange([...platforms, value]);
          }} />
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 break-words font-medium">{label}{reason && <span id={`${id}-${value}`} className={cn("block text-xs font-normal", selected ? "text-destructive" : "text-muted-foreground")}>{reason}</span>}</span>
      </label>)}
    </div> : <p className="rounded-[var(--radius)] border border-dashed border-input px-3 py-4 text-sm text-muted-foreground">No platform is ready for direct scheduling. <a className="font-medium text-primary underline-offset-4 hover:underline" href="/dashboard/settings?tab=integrations" target="_blank" rel="noopener noreferrer">Connect a platform (new tab)</a></p>}
    {unavailable.length > 0 && <details className="group min-w-0 rounded-[var(--radius)] border border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-[var(--radius)] px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span>Not available here ({unavailable.length})</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ul className="max-h-56 space-y-2 overflow-y-auto border-t border-border px-3 py-3 text-xs">
        {unavailable.map(({ value, label, icon: Icon, accountReason }) => <li key={value} className="flex min-w-0 items-start gap-2">
          <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words"><span className="font-medium text-foreground">{label}</span> <span className="text-muted-foreground">· {accountReason}</span></span>
        </li>)}
      </ul>
    </details>}
  </fieldset>;
}

/** Readiness repair stays inside the scheduling context. Settings uses a new tab;
 * approval is an explicit exact-revision request, never a scheduling side effect. */
export function SchedulingReadinessActions({ draft, platforms, readiness, disabled = false }: Readonly<{
  draft?: Draft; platforms: string[]; readiness: ReadinessData; disabled?: boolean;
}>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const lock = useRef(false);
  const candidates = [...new Set([...(draft?.platform ? [draft.platform] : []), ...platforms])];
  const needsReview = !!draft && readiness.profile?.requirePublishReview && !draft.publishApprovedAt;
  const connections = candidates.filter(platform => {
    const connection = readiness.connections[platform];
    return (DIRECT_PUBLISH_PLATFORMS as readonly string[]).includes(platform) && readiness.integrations?.some(item => item.key === platform && item.enabled) &&
      (!connection?.connected || !connection.assessment?.canPublish || connection.assessment.status !== "connected");
  });
  const refresh = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      await Promise.all([invalidatePublishingQueries(), queryClient.invalidateQueries({ predicate: query => {
        const key = String(query.queryKey[0]);
        return key === "/api/profile" || key === "/api/publishing-rules" || key.startsWith("/api/integrations");
      } })]);
      setMessageTone("info"); setMessage("Readiness check finished. Resolve any remaining blockers before confirming.");
    } catch { setMessageTone("error"); setMessage("Readiness could not be refreshed. Nothing was scheduled."); }
    finally { lock.current = false; setBusy(false); }
  };
  const approve = async () => {
    if (!draft || disabled || lock.current || !draft.updatedAt) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      await apiRequest("POST", `/api/drafts/${encodeURIComponent(draft.id)}/approve-publishing`, { content: draft.content, updatedAt: draft.updatedAt });
      // Never optimistically approve a potentially newer revision in this tab.
      await invalidatePublishingQueries();
      setMessageTone("success"); setMessage("Review recorded for the submitted revision. Nothing was scheduled or published.");
    } catch (error) {
      setMessageTone("error");
      setMessage(`${error instanceof Error ? error.message : "Approval not recorded."} Refresh and review the current draft; your scheduling choices are retained.`);
    } finally { lock.current = false; setBusy(false); }
  };
  const attention = needsReview || connections.length > 0;
  return <section aria-label="Scheduling readiness fixes" className={cn("min-w-0 space-y-2 text-sm", attention && "rounded-[var(--radius)] border border-warning/40 bg-warning-subtle p-3")}>
    {needsReview && <div className="space-y-2">
      <p className="font-medium">This saved revision needs publishing review.</p>
      <Button type="button" variant="outline" className="bg-card" disabled={disabled || busy || !draft.updatedAt} onClick={() => void approve()}>I reviewed this exact draft — approve publishing</Button>
    </div>}
    {connections.length > 0 && <ul className="flex flex-wrap gap-x-4">{connections.map(platform => <li key={platform}><a className={linkClassName} href="/dashboard/settings?tab=integrations" target="_blank" rel="noopener noreferrer">Connect or reconnect {getPlatformMeta(platform).label} (new tab)<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></a></li>)}</ul>}
    <div className="flex flex-wrap items-center justify-between gap-x-4">
      <a className={linkClassName} href="/dashboard/settings?tab=publishing" target="_blank" rel="noopener noreferrer">Publishing rules (new tab)<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></a>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}><RefreshCw aria-hidden="true" className={cn("h-4 w-4", busy && "motion-safe:animate-spin")} />{busy ? "Checking…" : "Refresh scheduling readiness"}</Button>
    </div>
    {message && <WorkflowStatus tone={messageTone}>{message}</WorkflowStatus>}
  </section>;
}

export function SchedulingConfirmation({ draft, platforms, date, time, timeZone, readiness, confirmed, onConfirm, disabled = false }: Readonly<{
  draft?: Draft; platforms: string[]; date: string; time: string; timeZone: string; readiness: ReadinessData;
  confirmed: boolean; onConfirm: (value: boolean) => void; disabled?: boolean;
}>) {
  return <section aria-label="Confirm scheduled publication" className="min-w-0 space-y-3 text-sm">
    <div className="flex min-h-9 min-w-0 items-center gap-1">
      <h3 className="text-sm font-medium leading-5">Review</h3>
      <InfoTooltip label="Review">One saved draft, identical text on every selected destination. This does not schedule other tailored drafts. Delivery is tracked per target.</InfoTooltip>
    </div>
    <div className="min-w-0 divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
      <p className="px-3 py-2"><span className="text-muted-foreground">Destinations: </span>{platforms.map(platform => getPlatformMeta(platform).label).join(" + ") || "None selected"}</p>
      <p className="px-3 py-2"><span className="text-muted-foreground">When: </span>{date || "Choose a date"} at {time || "Choose a time"} ({timeZone})</p>
      {draft ? <div className="space-y-2 px-3 py-3">
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-6" data-testid="schedule-exact-text">{draft.content}</p>
        {!!draft.media?.length && <ul aria-label="Attached media" className="text-xs text-muted-foreground">{draft.media.map(item => <li key={item.id}>{item.type}: {item.name}</li>)}</ul>}
        <ul aria-label="Platform character counts" className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">{platforms.map(platform => {
          const text = publishingTextValidation(draft.content, platform, readiness);
          return <li key={platform} className={cn(text.length > text.maxCharacters && "font-medium text-destructive")}>{getPlatformMeta(platform).label}: {text.length}/{text.maxCharacters} platform characters{platform === "twitter" ? " (X links count as 23)" : ""}</li>;
        })}</ul>
        <p className="text-xs tabular-nums text-muted-foreground">{draft.content.length}/{MAX_DRAFT_CHARACTERS} raw characters</p>
      </div> : <p className="px-3 py-3 text-muted-foreground">Choose a draft to review its exact text.</p>}
    </div>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-input bg-card px-3 py-3 font-medium has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary focus-visible:outline-none" checked={confirmed} disabled={disabled || !draft || !platforms.length} onChange={event => onConfirm(event.target.checked)} />
      <span>I confirm this exact text, destinations and timezone.</span>
    </label>
  </section>;
}