import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

export interface ScheduleResult {
  id: string;
  draftId: string;
  scheduledPublishAt: string;
  status: string;
  message: string;
}

export interface BulkScheduleResult {
  scheduled: string[];
  failed: string[];
  message: string;
}

export function usePublishSchedule() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scheduleDraft = async (draftId: string, publishAt: Date, platforms?: string[]): Promise<ScheduleResult | null> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/drafts/${draftId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishAt: publishAt.toISOString(), ...(platforms?.length ? { platforms } : {}) }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to schedule draft');
      }

      const result = await response.json();
      toast({
        title: 'Success',
        description: result.message,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const bulkSchedule = async (
    draftIds: string[],
    publishAt?: Date,
    schedule?: Record<string, Date>
  ): Promise<BulkScheduleResult | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const body: any = { draftIds };
      if (publishAt) body.publishAt = publishAt.toISOString();
      if (schedule) {
        body.schedule = Object.entries(schedule).reduce((acc, [id, date]) => {
          acc[id] = date.toISOString();
          return acc;
        }, {} as Record<string, string>);
      }

      const response = await fetch('/api/drafts/bulk-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to schedule drafts');
      }

      const result = await response.json();
      toast({
        title: 'Bulk Schedule Complete',
        description: result.message,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const reschedule = async (draftId: string, publishAt: Date): Promise<ScheduleResult | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/drafts/${draftId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishAt: publishAt.toISOString() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to reschedule draft');
      }

      const result = await response.json();
      toast({
        title: 'Success',
        description: result.message,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const cancelSchedule = async (draftId: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/drafts/${draftId}/schedule`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to cancel schedule');
      }

      toast({
        title: 'Success',
        description: 'Schedule cancelled successfully',
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const publishNow = async (draftId: string): Promise<{ jobId: string | null; status: string } | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/drafts/${draftId}/publish-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to publish draft');
      }

      const result = await response.json();
      toast({
        title: 'Success',
        description: result.message,
      });
      return { jobId: result.jobId, status: result.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    scheduleDraft,
    bulkSchedule,
    reschedule,
    cancelSchedule,
    publishNow,
    isLoading,
    error,
  };
}
