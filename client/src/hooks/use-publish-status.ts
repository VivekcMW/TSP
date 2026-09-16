import { useState, useEffect, useCallback } from 'react';
import { fetchPublishingSchedules, publicationOutcome, type PublishingSchedule } from '@/lib/publishing';

export interface PublishJobStatus {
  id: string;
  state: 'active' | 'completed' | 'failed' | 'delayed' | 'waiting';
  progress?: {
    platform: string;
    status: 'publishing' | 'published' | 'failed' | 'skipped' | 'unknown';
    postId?: string;
    error?: string;
  };
  error?: string;
  attemptsMade: number;
  attempts: number;
}

export function usePublishStatus(jobId: string | null, pollInterval: number = 1000) {
  const [status, setStatus] = useState<PublishJobStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(null);
    setError(null);
    setIsLoading(false);
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/status`, { signal: controller.signal, credentials: 'include' });
        if (!response.ok) throw new Error('Delivery status could not be verified. Check the provider before retrying.');
        const data = await response.json() as PublishJobStatus;
        if (controller.signal.aborted) return;
        setStatus(data);
        setError(null);
        failures = 0;
        if (data.state === 'completed' || data.state === 'failed') return;
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Delivery status is uncertain.');
        if (++failures >= 3) return;
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, pollInterval);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId, pollInterval]);

  const reset = useCallback(() => {
    setStatus(null);
    setError(null);
  }, []);

  return {
    status,
    isLoading,
    error,
    reset,
  };
}

/** Persisted target outcomes, not a completed (possibly skipped) queue job,
 * determine multi-target success. Errors never cause another publish request. */
export function useDraftPublishStatus(draftId: string | null, pollInterval = 1000) {
  const [snapshot, setSnapshot] = useState<{ draftId: string; schedule?: PublishingSchedule } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [generation, setGeneration] = useState(0);
  const recheck = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    setSnapshot(null);
    setError(null);
    setChecking(false);
    if (!draftId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    let failures = 0;
    const poll = async () => {
      setChecking(true);
      try {
        const { items } = await fetchPublishingSchedules(controller.signal);
        if (controller.signal.aborted) return;
        const schedule = items.find((item) => item.draftId === draftId);
        setSnapshot({ draftId, schedule });
        setError(null);
        failures = 0;
        if (publicationOutcome(schedule) !== 'pending') return;
        if (Date.now() - started >= 120_000) {
          setError('Still awaiting delivery confirmation. Check status again; do not publish another copy.');
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
        setError('Delivery status could not be verified. Check status or the provider before retrying; delivery could have succeeded.');
        if (++failures >= 3) return;
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, pollInterval);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [draftId, pollInterval, generation]);
  const schedule = snapshot?.draftId === draftId ? snapshot.schedule : undefined;
  return { schedule, outcome: publicationOutcome(schedule), checking, error, recheck };
}
