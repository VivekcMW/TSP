import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Draft } from '@shared/schema';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { WorkflowStatus } from '@/components/dashboard/workflow-status';
import { usePublishSchedule } from '@/hooks/use-publish-schedule';
import { Loader2 } from 'lucide-react';
import { usePublishingReadiness } from '@/hooks/use-publishing-readiness';
import { PublishingPlatformSelector, SchedulingConfirmation, SchedulingReadinessActions } from '@/components/publishing-platform-selector';
import { canChangeSchedule, defaultSchedulePlatforms, fetchDraftDetails, fetchPublishingSchedules, invalidatePublishingQueries, scheduleConfirmationKey, selectionBlockers } from '@/lib/publishing';
import { capturePublishingConsent } from '@shared/publishing-consent';
import { dateKeyInTimeZone, publishingDefaults, scheduleTimeValidation, timeKeyInTimeZone } from '@/lib/calendar';

export interface ScheduleArticleModalProps {
  draftId: string;
  draftTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
  schedulingTimeZone?: string;
  initialPublishDate?: string;
}

export function ScheduleArticleModal({
  draftId,
  draftTitle,
  open,
  onOpenChange,
  onScheduled,
  schedulingTimeZone,
  initialPublishDate,
}: Readonly<ScheduleArticleModalProps>) {
  const [publishAt, setPublishAt] = useState<string>('');
  const [publishTime, setPublishTime] = useState<string>('09:00');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [timeTouched, setTimeTouched] = useState(false);
  const [platformsTouched, setPlatformsTouched] = useState(false);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const actionLock = useRef(false);
  const readiness = usePublishingReadiness(open);
  const defaults = publishingDefaults(readiness.profile);
  const [contextDefaults, setContextDefaults] = useState<typeof defaults | null>(null);
  const timeZone = contextDefaults?.timeZone ?? schedulingTimeZone ?? defaults.timeZone;
  const time = contextDefaults?.time ?? defaults.time;
  const draftsQuery = useQuery<Draft>({ queryKey: [`/api/drafts/${encodeURIComponent(draftId)}/details`], queryFn: ({ signal }) => fetchDraftDetails(draftId, signal), enabled: open, staleTime: 0, retry: false });
  const schedules = useQuery({ queryKey: ['/api/drafts/scheduled-info'], queryFn: ({ signal }) => fetchPublishingSchedules(signal), enabled: open, staleTime: 0 });
  const draft = draftsQuery.data;
  const priorSchedule = schedules.data?.items.find((item) => item.draftId === draftId);
  const existing = priorSchedule?.status !== 'cancelled' ? priorSchedule : undefined;
  const { scheduleDraft, reschedule, isLoading } = usePublishSchedule();
  const busy = isLoading || submitting;
  const remainingTargets = existing?.targets?.filter(target => target.status !== 'cancelled');
  const existingPlatforms = (remainingTargets?.length ? remainingTargets : existing?.targets)?.map(target => target.platform);
  const defaultPlatforms = (existingPlatforms ?? defaultSchedulePlatforms(draft, readiness)).join(',');
  useEffect(() => { setTimeTouched(false); setPlatformsTouched(false); setConfirmedKey(null); setContextDefaults(null); }, [open, draftId]);
  useEffect(() => {
    if (open && readiness.profile && !contextDefaults) setContextDefaults({ time: defaults.time, timeZone: schedulingTimeZone ?? defaults.timeZone });
  }, [open, readiness.profile, contextDefaults, defaults.time, defaults.timeZone, schedulingTimeZone]);
  useEffect(() => {
    if (!open || timeTouched) return;
    setPublishAt(initialPublishDate ?? (existing ? dateKeyInTimeZone(existing.scheduledPublishAt, timeZone) : dateKeyInTimeZone(new Date(), timeZone)));
    setPublishTime(existing ? timeKeyInTimeZone(existing.scheduledPublishAt, timeZone) : time);
  }, [open, timeTouched, existing, timeZone, time, initialPublishDate]);
  useEffect(() => {
    if (!open || platformsTouched) return;
    setPlatforms(defaultPlatforms ? defaultPlatforms.split(',') : []);
    if (defaultPlatforms) setPlatformsTouched(true);
  }, [open, platformsTouched, defaultPlatforms]);
  const targetPlatforms = existingPlatforms ?? platforms;
  const consent = draft && schedules.data ? capturePublishingConsent(draft, priorSchedule ?? null) : undefined;
  const confirmationKey = scheduleConfirmationKey(draft, targetPlatforms, publishAt, publishTime, timeZone, priorSchedule);
  const confirmed = confirmedKey === confirmationKey;
  const validation = scheduleTimeValidation(publishAt, publishTime, timeZone);
  const warnings = [...selectionBlockers(targetPlatforms, draft, readiness), ...(validation.error ? [validation.error] : [])];
  if (!schedules.data || schedules.isError) warnings.push('Schedule status must be checked before scheduling.');
  if (!draft || draftsQuery.isError) warnings.push('Draft status must be checked before scheduling.');
  if (!consent) warnings.push('The exact publishing revision is unavailable. Refresh and review before confirming.');
  if (existing && !canChangeSchedule(existing)) warnings.push('Use target recovery for this schedule; it cannot safely be replaced.');
  if (draft && !existing && draft.publishStatus !== 'draft') warnings.push('This draft is not ready for a new schedule. Check its target status.');

  const handleSchedule = async () => {
    const checked = scheduleTimeValidation(publishAt, publishTime, timeZone);
    if (actionLock.current || !confirmed || !consent || warnings.length || !checked.publishAt || busy) {
      return;
    }
    actionLock.current = true; setSubmitting(true);
    try {
      const result = existing ? await reschedule(draftId, checked.publishAt, consent) : await scheduleDraft(draftId, checked.publishAt, consent, targetPlatforms);
      await invalidatePublishingQueries();
      if (result) {
        onOpenChange(false);
        onScheduled?.();
      }
    } finally { actionLock.current = false; setSubmitting(false); setConfirmedKey(null); }
  };

  const minDate = dateKeyInTimeZone(new Date(), timeZone);

  return (
    <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Schedule Article Publication</DialogTitle>
          <DialogDescription>
            {draftTitle ? `Schedule "${draftTitle}" for publication` : 'Choose when to publish this article'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">Timezone: {timeZone} ({schedulingTimeZone ? 'calendar selection' : 'publishing preferences'}). Direct delivery requires a ready connection.</p>
          {existing ? <p className="text-sm">Rescheduling preserves the remaining target platforms.</p> : <PublishingPlatformSelector platforms={platforms} onChange={(values) => { setPlatformsTouched(true); setPlatforms(values); }} draft={draft} readiness={readiness} disabled={busy} />}
          <Field id="publish-date" label="Publication Date" render={props =>
            <Input
              {...props}
              type="date"
              value={publishAt}
              onChange={(e) => { setTimeTouched(true); setPublishAt(e.target.value); }}
              min={minDate}
              disabled={busy}
            />
          } />

          <Field id="publish-time" label={`Publication Time (${timeZone})`} error={validation.error} render={props =>
            <Input
              {...props}
              type="time"
              value={publishTime}
              onChange={(e) => { setTimeTouched(true); setPublishTime(e.target.value); }}
              disabled={busy}
            />
          } />

          <SchedulingReadinessActions key={draftId} draft={draft} platforms={targetPlatforms} readiness={readiness} disabled={busy || draftsQuery.isError || !schedules.data || schedules.isError || !!existing && !canChangeSchedule(existing) || !!draft && !['draft', 'scheduled'].includes(draft.publishStatus)} />
          <SchedulingConfirmation draft={draft} platforms={targetPlatforms} date={publishAt} time={publishTime} timeZone={timeZone} readiness={readiness} confirmed={confirmed} onConfirm={value => setConfirmedKey(value ? confirmationKey : null)} disabled={busy} />
          {warnings.length > 0 && <WorkflowStatus tone={draftsQuery.isError || schedules.isError ? "error" : "warning"} title="Cannot schedule yet"><ul className="list-disc space-y-1 pl-4">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></WorkflowStatus>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={handleSchedule} disabled={busy || !confirmed || warnings.length > 0}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Schedule Article
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
