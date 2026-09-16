import { useState, useEffect, useCallback } from 'react';

export interface PublishJobStatus {
  id: string;
  state: 'active' | 'completed' | 'failed' | 'delayed' | 'waiting';
  progress?: {
    platform: string;
    status: 'publishing' | 'published' | 'failed';
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

  const pollStatus = useCallback(async () => {
    if (!jobId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/jobs/${jobId}/status`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch job status');
      }

      const data = await response.json();
      setStatus(data);

      // Stop polling if job is completed or failed
      if (data.state === 'completed' || data.state === 'failed') {
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    // Initial poll
    pollStatus();

    // Set up polling interval
    const interval = setInterval(pollStatus, pollInterval);

    return () => clearInterval(interval);
  }, [jobId, pollInterval, pollStatus]);

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
