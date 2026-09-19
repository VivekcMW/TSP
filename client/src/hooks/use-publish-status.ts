import { useState, useEffect, useCallback } from 'react';
import { fetchDraftPublishStatus, publicationOutcome, subscribePublishingRecovery, type PublishingSchedule } from '@/lib/publishing';

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
    const timeoutMessage = 'Still awaiting delivery confirmation. Check status again; do not publish another copy.';
    // Bound even a hung fetch, not just successfully completed polling rounds.
    const deadline = setTimeout(() => {
      controller.abort();
      clearTimeout(timer);
      setChecking(false);
      setError(timeoutMessage);
    }, 120_000);
    const unsubscribe = subscribePublishingRecovery((changedDraftId) => {
      if (changedDraftId !== draftId) return;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(deadline);
      recheck();
    });
    let failures = 0;
    const poll = async () => {
      setChecking(true);
      try {
        const schedule = await fetchDraftPublishStatus(draftId, controller.signal);
        if (controller.signal.aborted) return;
        setSnapshot({ draftId, schedule });
        setError(null);
        failures = 0;
        const outcome = publicationOutcome(schedule);
        if (outcome === 'published' || outcome === 'attention' || outcome === 'simulated') {
          clearTimeout(deadline);
          return;
        }
        // Unknown/missing/mixed-time snapshots remain unconfirmed and are
        // read again, without ever issuing another publication request.
      } catch {
        if (controller.signal.aborted) return;
        setError('Delivery status could not be verified. Check status or the provider before retrying; delivery could have succeeded.');
        if (++failures >= 3) { clearTimeout(deadline); return; }
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, pollInterval);
    };
    void poll();
    return () => { unsubscribe(); controller.abort(); clearTimeout(timer); clearTimeout(deadline); };
  }, [draftId, pollInterval, generation, recheck]);
  const schedule = snapshot?.draftId === draftId ? snapshot.schedule : undefined;
  return { schedule, outcome: publicationOutcome(schedule), checking, error, recheck };
}
