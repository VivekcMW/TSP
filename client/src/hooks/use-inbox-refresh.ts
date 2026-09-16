import { useState, useCallback, useEffect, useRef } from "react";
import { useToast } from "./use-toast";

export interface InboxRefreshProgress {
  articlesProcessed: number;
  articlesMatched: number;
  articlesCreated: number;
  needsSetup?: boolean;
}

export interface JobStatus {
  id: string;
  status: "active" | "completed" | "failed" | "delayed" | "waiting";
  progress: InboxRefreshProgress;
  attemptsMade: number;
  totalAttempts: number;
  error: string | null;
}

interface UseInboxRefreshOptions {
  autoRefresh?: boolean;
  onJobQueued?: (jobId: string) => void;
  onComplete?: (progress: InboxRefreshProgress) => void;
  onError?: (error: string) => void;
}

/**
 * Hook for triggering and monitoring inbox refresh jobs.
 * Handles queuing, polling, and error states.
 */
export function useInboxRefresh(options: UseInboxRefreshOptions = {}) {
  const { autoRefresh: defaultAutoRefresh = false, onJobQueued, onComplete, onError } = options;
  const { toast } = useToast();

  const [jobId, setJobId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<InboxRefreshProgress>({
    articlesProcessed: 0,
    articlesMatched: 0,
    articlesCreated: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"queued" | "active" | "completed" | "failed" | "delayed" | "waiting" | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  // Auto-triggered (session pre-warm) refreshes stay silent - no toasts, no
  // visible progress card - same as before this hook existed. Tracked in a
  // ref (not state) so the async poll loop can read the value that was true
  // when the job started, not whatever a later render happens to hold.
  const silentRef = useRef(false);

  /**
   * Start an inbox refresh job. Pass `autoRefresh` to override the hook's
   * default for this one call (e.g. a manual button click on a page whose
   * default is silent auto-refresh-on-load).
   */
  const startRefresh = useCallback(async (autoRefreshOverride?: boolean) => {
    const isAuto = autoRefreshOverride ?? defaultAutoRefresh;
    silentRef.current = isAuto;
    setIsLoading(true);
    setError(null);
    setJobId(null);
    setJobStatus("queued");
    setProgress({ articlesProcessed: 0, articlesMatched: 0, articlesCreated: 0 });

    try {
      const response = await fetch("/api/inbox/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRefresh: isAuto }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to start refresh");
      }

      const data = await response.json();

      // If we got a jobId, the job is async
      if (data.jobId) {
        setJobId(data.jobId);
        onJobQueued?.(data.jobId);
        if (!isAuto) {
          toast({
            title: "Refresh Started",
            description: "Processing articles in the background...",
          });
        }
      } else {
        // Sync fallback (local dev without Redis)
        const syncProgress = {
          articlesProcessed: data.articlesProcessed || 0,
          articlesMatched: data.articlesMatched || 0,
          articlesCreated: data.count || 0,
          needsSetup: Boolean(data.needsSetup),
        };
        setProgress(syncProgress);
        setNeedsSetup(syncProgress.needsSetup);
        setJobStatus("completed");
        onComplete?.(syncProgress);
        if (!isAuto) {
          toast({
            title: "Refresh Complete",
            description: data.message || `${data.count} articles found`,
          });
        }
        setIsLoading(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      setJobStatus("failed");
      onError?.(errorMessage);
      if (!isAuto) {
        toast({
          title: "Refresh Failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
      setIsLoading(false);
    }
  }, [defaultAutoRefresh, onJobQueued, onComplete, onError, toast]);

  /**
   * Poll job status from the server.
   */
  const pollJobStatus = useCallback(async () => {
    if (!jobId) return;

    try {
      const response = await fetch(`/api/inbox/refresh/${jobId}`);

      if (!response.ok) {
        if (response.status === 404) {
          // Job expired or not found
          setError("Job not found");
          setJobStatus("failed");
          return;
        }
        throw new Error("Failed to fetch job status");
      }

      const status: JobStatus = await response.json();

      setJobStatus(status.status);
      setProgress(status.progress);
      setNeedsSetup(Boolean(status.progress.needsSetup));

      if (status.status === "completed") {
        setIsLoading(false);
        onComplete?.(status.progress);
        if (!silentRef.current) {
          toast({
            title: "Refresh Complete",
            description: `${status.progress.articlesCreated} new articles added`,
          });
        }
      } else if (status.status === "failed") {
        setIsLoading(false);
        setError(status.error || "Job failed");
        onError?.(status.error || "Job failed");
        if (!silentRef.current) {
          toast({
            title: "Refresh Failed",
            description: status.error || "Unknown error",
            variant: "destructive",
          });
        }
      }
    } catch (err) {
      console.error("Error polling job status:", err);
      // Continue polling, might be temporary network error
    }
  }, [jobId, onComplete, onError, toast]);

  /**
   * Set up polling when jobId is set.
   */
  useEffect(() => {
    if (!jobId) return;

    setIsLoading(true);

    // Poll every 500ms
    const interval = setInterval(() => {
      pollJobStatus();
    }, 500);

    // Also poll immediately
    pollJobStatus();

    return () => clearInterval(interval);
  }, [jobId, pollJobStatus]);

  /**
   * Reset state.
   */
  const reset = useCallback(() => {
    setJobId(null);
    setIsLoading(false);
    setProgress({ articlesProcessed: 0, articlesMatched: 0, articlesCreated: 0 });
    setError(null);
    setJobStatus(null);
  }, []);

  return {
    startRefresh,
    isLoading,
    progress,
    error,
    jobId,
    jobStatus,
    needsSetup,
    isSilent: silentRef.current,
    reset,
  };
}
