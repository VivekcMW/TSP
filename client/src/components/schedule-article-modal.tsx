import { useState } from 'react';
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

export interface ScheduleArticleModalProps {
  draftId: string;
  draftTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
}

export function ScheduleArticleModal({
  draftId,
  draftTitle,
  open,
  onOpenChange,
  onScheduled,
}: ScheduleArticleModalProps) {
  const [publishAt, setPublishAt] = useState<string>('');
  const [publishTime, setPublishTime] = useState<string>('09:00');
  const { scheduleDraft, isLoading } = usePublishSchedule();

  const handleSchedule = async () => {
    if (!publishAt) {
      return;
    }

    // Combine date and time
    const [hours, minutes] = publishTime.split(':');
    const dateTime = new Date(publishAt);
    dateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

    const result = await scheduleDraft(draftId, dateTime);
    if (result) {
      setPublishAt('');
      setPublishTime('09:00');
      onOpenChange(false);
      onScheduled?.();
    }
  };

  const minDate = new Date().toISOString().split('T')[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Schedule Article Publication</DialogTitle>
          <DialogDescription>
            {draftTitle ? `Schedule "${draftTitle}" for publication` : 'Choose when to publish this article'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="publish-date">Publication Date</Label>
            <Input
              id="publish-date"
              type="date"
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
              min={minDate}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="publish-time">Publication Time (UTC)</Label>
            <Input
              id="publish-time"
              type="time"
              value={publishTime}
              onChange={(e) => setPublishTime(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            Article will be published on{' '}
            {publishAt ? new Date(publishAt).toLocaleDateString() : 'selected date'} at {publishTime} UTC
          </div>
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
          <Button onClick={handleSchedule} disabled={isLoading || !publishAt}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Schedule Article
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
