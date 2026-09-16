import { useEffect, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { usePublishSchedule } from '@/hooks/use-publish-schedule';
import { Loader2 } from 'lucide-react';
import { usePublishingReadiness } from '@/hooks/use-publishing-readiness';
import { PublishingPlatformSelector } from '@/components/publishing-platform-selector';
import { canChangeSchedule, defaultSchedulePlatforms, fetchPublishingSchedules, invalidatePublishingQueries, selectionBlockers } from '@/lib/publishing';
import { dateKeyInTimeZone, publishingDefaults, scheduleTimeValidation, timeKeyInTimeZone } from '@/lib/calendar';

export interface ScheduleArticleModalProps {
  draftId: string;
  draftTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
  schedulingTimeZone?: string;
}

export function ScheduleArticleModal({
  draftId,
  draftTitle,
  open,
  onOpenChange,
  onScheduled,
  schedulingTimeZone,
}: ScheduleArticleModalProps) {
  const [publishAt, setPublishAt] = useState<string>('');
  const [publishTime, setPublishTime] = useState<string>('09:00');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const readiness = usePublishingReadiness(open);
  const defaults = publishingDefaults(readiness.profile);
  const timeZone = schedulingTimeZone ?? defaults.timeZone;
  const time = defaults.time;
  const { data: drafts } = useQuery<Draft[]>({ queryKey: ['/api/drafts'], enabled: open });
  const schedules = useQuery({ queryKey: ['/api/drafts/scheduled-info'], queryFn: ({ signal }) => fetchPublishingSchedules(signal), enabled: open, staleTime: 0 });
  const draft = drafts?.find((item) => item.id === draftId);
  const existing = schedules.data?.items.find((item) => item.draftId === draftId && item.status !== 'cancelled');
  const { scheduleDraft, reschedule, isLoading } = usePublishSchedule();
  const defaultPlatforms = (existing?.targets?.map((target) => target.platform) ?? defaultSchedulePlatforms(draft, readiness)).join(',');
  useEffect(() => { setTouched(false); }, [open, draftId]);
  useEffect(() => {
    if (!open || touched) return;
    setPublishAt(existing ? dateKeyInTimeZone(existing.scheduledPublishAt, timeZone) : dateKeyInTimeZone(new Date(), timeZone));
    setPublishTime(existing ? timeKeyInTimeZone(existing.scheduledPublishAt, timeZone) : time);
    setPlatforms(defaultPlatforms ? defaultPlatforms.split(',') : []);
  }, [open, touched, existing, timeZone, time, defaultPlatforms]);
  const validation = scheduleTimeValidation(publishAt, publishTime, timeZone);
  const warnings = [...selectionBlockers(platforms, draft, readiness), ...(validation.error ? [validation.error] : [])];
  if (!schedules.data || schedules.isError) warnings.push('Schedule status must be checked before scheduling.');
  if (existing && !canChangeSchedule(existing)) warnings.push('Use target recovery for this schedule; it cannot safely be replaced.');
  if (draft && !existing && draft.publishStatus !== 'draft') warnings.push('This draft is not ready for a new schedule. Check its target status.');

  const handleSchedule = async () => {
    const checked = scheduleTimeValidation(publishAt, publishTime, timeZone);
    if (warnings.length || !checked.publishAt || isLoading) {
      return;
    }

    const result = existing ? await reschedule(draftId, checked.publishAt) : await scheduleDraft(draftId, checked.publishAt, platforms);
    await invalidatePublishingQueries();
    if (result) {
      setPublishAt('');
      setPublishTime('09:00');
      onOpenChange(false);
      onScheduled?.();
    }
  };

  const minDate = dateKeyInTimeZone(new Date(), timeZone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Schedule Article Publication</DialogTitle>
          <DialogDescription>
            {draftTitle ? `Schedule "${draftTitle}" for publication` : 'Choose when to publish this article'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">Timezone: {timeZone} ({schedulingTimeZone ? 'calendar selection' : 'publishing preferences'}). Direct delivery requires a ready connection.</p>
          {existing ? <p className="text-sm">Rescheduling preserves the existing target platforms.</p> : <PublishingPlatformSelector platforms={platforms} onChange={(values) => { setTouched(true); setPlatforms(values); }} draft={draft} readiness={readiness} disabled={isLoading} />}
          <div className="space-y-2">
            <Label htmlFor="publish-date">Publication Date</Label>
            <Input
              id="publish-date"
              type="date"
              value={publishAt}
              onChange={(e) => { setTouched(true); setPublishAt(e.target.value); }}
              min={minDate}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="publish-time">Publication Time ({timeZone})</Label>
            <Input
              id="publish-time"
              type="time"
              value={publishTime}
              onChange={(e) => { setTouched(true); setPublishTime(e.target.value); }}
              disabled={isLoading}
            />
          </div>

          <div className="rounded-lg bg-muted p-3 text-sm">
            Requested delivery: {publishAt || 'selected date'} at {publishTime} ({timeZone}). Delivery will be tracked per target.
          </div>
          {warnings.length > 0 && <ul role="alert" className="list-disc space-y-1 pl-4 text-sm text-destructive">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSchedule} disabled={isLoading || warnings.length > 0}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Schedule Article
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
