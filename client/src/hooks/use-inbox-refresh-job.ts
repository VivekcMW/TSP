import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { inboxRefreshMessage, type InboxRefreshOutcome } from "@shared/inbox-refresh";

export interface RefreshJobState {
  status: "idle" | "queued" | "waiting" | "delayed" | "active" | "completed" | "failed" | "unavailable";
  jobId?: string;
  operationId?: string;
  startedAt?: number;
  progress: { articlesProcessed: number; articlesMatched: number; articlesCreated: number; needsSetup?: boolean; success?: boolean; error?: string; errors?: string[]; outcome?: InboxRefreshOutcome; activeCount?: number; replacedCount?: number };
  message?: string;
}

const emptyState: RefreshJobState = {
  status: "idle", progress: { articlesProcessed: 0, articlesMatched: 0, articlesCreated: 0 },
};
export const INBOX_REFRESH_JOB_KEY = ["inbox-refresh-job"] as const;
export const isRefreshJobRunning = (state: RefreshJobState) => ["queued", "waiting", "delayed", "active"].includes(state.status);

const uncertainAdmissionMessage = "Couldn't confirm whether the refresh started. It may still be running, but no job ID was received. Check status to reload available articles; another refresh is blocked to avoid duplicates.";

function admissionFailure(error: unknown, operationId: string): RefreshJobState {
  // Only definite rejections permit another enqueue. Network errors, timeouts
  // and 5xx may hide an accepted job; a conflict requires a fresh operation.
  const rejected = error instanceof ApiError && [400, 401, 403, 404, 405, 409, 413, 415, 422, 429].includes(error.status);
  return { ...emptyState, status: rejected ? "failed" : "unavailable",
    operationId: error instanceof ApiError && error.status === 409 ? undefined : operationId,
    message: rejected ? error.message : uncertainAdmissionMessage };
}

function hasSynchronousResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const { jobId, count, needsSetup } = result as { jobId?: unknown; count?: unknown; needsSetup?: unknown };
  return !jobId && ((typeof count === "number" && Number.isFinite(count) && count >= 0) || needsSetup === true);
}

async function admitRefresh(operationId: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Bound both the POST and its response body. Racing also settles the caller
    // if a transport ignores abort; late responses cannot overwrite recovery.
    return await Promise.race([
      apiRequest("POST", "/api/inbox/refresh", { autoRefresh: false, operationId }, { signal: controller.signal }).then(response => response.json()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Refresh admission timed out."));
        }, 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function refreshJobMessage(state: RefreshJobState): string {
  if (state.status === "completed" && state.progress.outcome) return inboxRefreshMessage(state.progress.outcome, state.progress.articlesCreated);
  if (state.status === "completed" && state.message) return state.message;
  if (state.status === "completed") return state.progress.needsSetup
    ? "Add a source or topic in Discover to find articles."
    : `Refresh finished. ${state.progress.articlesCreated} new articles added.`;
  if (state.status === "failed" || state.status === "unavailable") return state.message || "Couldn't check refresh progress.";
  if (state.status === "active") return `Checking articles: ${state.progress.articlesProcessed} processed, ${state.progress.articlesMatched} matched. You can keep working.`;
  return "Refresh queued. Waiting for a worker — you can keep working.";
}

/** Shared state lets Home and Discover observe the same user-triggered job.
 * Clear this query with other user data on sign-out/tenant changes.
 */
export function useInboxRefreshJob() {
  const client = useQueryClient();
  const invalidateResults = () => Promise.all([
    client.invalidateQueries({ queryKey: ["/api/inbox"] }),
    client.invalidateQueries({ queryKey: ["/api/trends"] }),
  ]);
  const query = useQuery<RefreshJobState>({
    queryKey: INBOX_REFRESH_JOB_KEY,
    initialData: emptyState,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const previous = client.getQueryData<RefreshJobState>(INBOX_REFRESH_JOB_KEY) ?? emptyState;
      if (!previous.jobId || !isRefreshJobRunning(previous)) return previous;
      if (Date.now() - (previous.startedAt ?? 0) > 120_000) {
        return { ...previous, status: "unavailable", message: "This refresh is taking longer than expected. It may still be running. Check its status before starting another." };
      }
      try {
        const response = await apiRequest("GET", `/api/inbox/refresh/${encodeURIComponent(previous.jobId)}`, undefined, { signal });
        const result = await response.json();
        // Bull reports numeric zero before a handler has supplied structured progress.
        const hasProgress = result.progress && typeof result.progress === "object";
        const next: RefreshJobState = { ...previous, status: result.status, progress: hasProgress ? { ...emptyState.progress, ...result.progress } : emptyState.progress, message: result.status === "failed" ? result.error || undefined : undefined };
        if (!["queued", "waiting", "delayed", "active", "completed", "failed"].includes(next.status)) {
          return { ...previous, status: "unavailable", message: "Refresh status is unknown. Check again before starting another." };
        }
        // Bull completion only means the handler returned, not that the engine succeeded.
        if (next.status === "completed" && (next.progress.success === false || next.progress.outcome === "failure")) next.status = "failed";
        if (next.status === "failed") next.message = next.message || next.progress.error || next.progress.errors?.join("; ") || "Refresh failed. No successful refresh was reported.";
        if (next.status === "completed") {
          if (!hasProgress) next.message = "Refresh finished. Open Discover to review the available articles; detailed counts are unavailable.";
          await invalidateResults();
        }
        return next;
      } catch (error) {
        if (signal.aborted) throw error;
        return { ...previous, status: "unavailable", message: "Couldn't check refresh status. The job may still be running. Try checking again." };
      }
    },
    refetchInterval: (current) => current.state.data?.jobId && isRefreshJobRunning(current.state.data) ? 1500 : false,
  });

  const startRefresh = async () => {
    const current = client.getQueryData<RefreshJobState>(INBOX_REFRESH_JOB_KEY) ?? emptyState;
    if (isRefreshJobRunning(current) || current.status === "unavailable") return;
    // Reuse an operation only when admission itself failed without a job ID.
    // Once Bull accepted a job, a terminal failure must get a fresh operation
    // or the queue will keep returning the same exhausted job (attempt 4/3).
    const operationId = current.status === "failed" && current.operationId && !current.jobId
      ? current.operationId
      : crypto.randomUUID();
    const admission = client.setQueryData<RefreshJobState>(INBOX_REFRESH_JOB_KEY, { ...emptyState, status: "queued", operationId, startedAt: Date.now() });
    try {
      const result = await admitRefresh(operationId);
      // Do not restore old user data if the shared query was cleared/replaced.
      if (client.getQueryData(INBOX_REFRESH_JOB_KEY) !== admission) return;
      if (typeof result?.jobId === "string" && result.jobId.trim()) {
        client.setQueryData(INBOX_REFRESH_JOB_KEY, { ...emptyState, status: "queued", jobId: result.jobId, operationId, startedAt: Date.now() });
      } else if (result?.success === false) {
        client.setQueryData(INBOX_REFRESH_JOB_KEY, { ...emptyState, status: "failed", operationId, message: result.error || result.message || "Refresh failed." });
      } else if (hasSynchronousResult(result)) {
        client.setQueryData(INBOX_REFRESH_JOB_KEY, {
          status: "completed",
          progress: {
            articlesProcessed: result.articlesProcessed ?? 0,
            articlesMatched: result.articlesMatched ?? 0,
            articlesCreated: result.count ?? 0,
            needsSetup: Boolean(result.needsSetup),
            outcome: result.outcome,
            activeCount: result.activeCount,
            replacedCount: result.replacedCount,
          },
        });
        await invalidateResults();
      } else {
        client.setQueryData(INBOX_REFRESH_JOB_KEY, { ...emptyState, status: "unavailable", message: uncertainAdmissionMessage });
      }
    } catch (error) {
      if (client.getQueryData(INBOX_REFRESH_JOB_KEY) !== admission) return;
      client.setQueryData(INBOX_REFRESH_JOB_KEY, admissionFailure(error, operationId));
    }
  };

  const checkAgain = () => {
    const current = client.getQueryData<RefreshJobState>(INBOX_REFRESH_JOB_KEY);
    if (current?.status !== "unavailable") return;
    if (current.jobId) {
      client.setQueryData(INBOX_REFRESH_JOB_KEY, { ...current, status: "waiting", startedAt: Date.now(), message: undefined });
    } else {
      client.setQueryData(INBOX_REFRESH_JOB_KEY, { ...current, message: "No job ID was received, so we can't check this refresh's status. Reloading available articles does not confirm completion. Another refresh remains blocked to avoid duplicates; contact support if this persists." });
      void invalidateResults();
    }
  };

  return { ...query.data, isLoading: isRefreshJobRunning(query.data), startRefresh, checkAgain };
}