import { ApiError, apiRequest } from "./queryClient";

export interface EditorialProgress { platformsCompleted: number; platformsTotal: number }
interface JobStatus {
  status: "queued" | "active" | "completed" | "failed" | "cancelled";
  progress: EditorialProgress;
  error?: { status: number; body: { message: string } };
}
const queuedPaths = new Set(["/api/instant-review/selected", "/api/instant-review/manual"]);

/** Owned by the UI intent, not by a single HTTP attempt. Never reuse across scopes. */
export interface EditorialRequestState {
  requestIntent: string;
  jobId?: string;
  deadline?: number;
  terminal?: boolean;
  cancellation?: Promise<void>;
}
export const createEditorialRequestState = (): EditorialRequestState => ({ requestIntent: crypto.randomUUID() });

export async function cancelEditorialRequest(state: EditorialRequestState, headers?: Record<string, string>): Promise<void> {
  if (state.terminal) return;
  if (!state.jobId) throw new ApiError(503, "Cancellation could not be confirmed. Retry the same request to recover its job; do not start another generation.");
  if (!state.cancellation) {
    state.cancellation = (async () => {
      try {
        await apiRequest("DELETE", `/api/editorial/jobs/${encodeURIComponent(state.jobId!)}`, undefined,
          { headers, signal: AbortSignal.timeout(8000) });
        state.terminal = true;
      } catch {
        throw new ApiError(503, "Cancellation could not be confirmed. The job may still be running. Retry or cancel again.");
      }
    })();
  }
  try { await state.cancellation; }
  finally { state.cancellation = undefined; }
}

function waitForPoll(signal: AbortSignal, delay = 1000) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function readJobJson<T>(path: string, signal: AbortSignal, deadline: number, headers?: Record<string, string>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await (await apiRequest("GET", path, undefined, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), headers,
      })).json();
    } catch (error) {
      signal.throwIfAborted();
      const transient = error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError") ||
        (error instanceof ApiError && [408, 429, 500, 502, 503, 504].includes(error.status));
      if (!transient || attempt >= 5) throw error;
      const delay = Math.max(Math.min(1000 * 2 ** attempt, 10_000), error instanceof ApiError ? error.retryAfterMs ?? 0 : 0);
      await waitForPoll(signal, Math.min(delay, Math.max(0, deadline - Date.now())));
    }
  }
}

async function admitJob<T>(endpoint: string, body: unknown, state: EditorialRequestState, signal: AbortSignal, headers?: Record<string, string>): Promise<{ result: T } | undefined> {
  // No automatic POST retries or direct fallback: admission may already have spent.
  const response = await apiRequest("POST", endpoint, { ...(body as object), requestIntent: state.requestIntent }, {
    signal, headers: { ...headers, Prefer: "respond-async" },
  });
  const admitted = await response.json();
  if (response.status !== 202) { state.terminal = true; signal.throwIfAborted(); return { result: admitted as T }; }
  if (typeof admitted.jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(admitted.jobId)) throw new ApiError(502, "Invalid editorial job response");
  state.jobId = admitted.jobId;
}

/** Prefer queued review without changing callers' result shape or direct routes. */
export async function editorialRequest<T>(endpoint: string, body: unknown, options: {
  signal?: AbortSignal; headers?: Record<string, string>; onProgress?: (progress: EditorialProgress) => void;
  state?: EditorialRequestState;
} = {}): Promise<T> {
  if (!queuedPaths.has(endpoint)) return (await apiRequest("POST", endpoint, body, options)).json();
  options.signal?.throwIfAborted();
  const state = options.state ?? createEditorialRequestState();
  state.deadline ??= Date.now() + 310_000;
  const controller = new AbortController();
  const timeout = () => controller.abort(new ApiError(504, "Generation timed out. Retry to check the same job before trying again."));
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(timeout, Math.max(0, state.deadline - Date.now()));
  if (Date.now() >= state.deadline) timeout();
  try {
    controller.signal.throwIfAborted();
    if (!state.jobId) {
      const direct = await admitJob<T>(endpoint, body, state, controller.signal, options.headers);
      if (direct) return direct.result;
    }
    const jobPath = `/api/editorial/jobs/${encodeURIComponent(state.jobId!)}`;
    while (true) {
      controller.signal.throwIfAborted();
      const status = await readJobJson<JobStatus>(jobPath, controller.signal, state.deadline, options.headers);
      options.onProgress?.(status.progress);
      if (status.status === "completed") {
        const result = await readJobJson<T>(`${jobPath}/result`, controller.signal, state.deadline, options.headers);
        controller.signal.throwIfAborted();
        state.terminal = true;
        return result as T;
      }
      if (status.status === "failed" || status.status === "cancelled") {
        state.terminal = true;
        if (status.status === "cancelled") throw new DOMException("Generation cancelled", "AbortError");
        throw new ApiError(status.error?.status ?? 500, status.error?.body.message ?? "Generation failed. No posts were returned.");
      }
      if (!["active", "queued"].includes(status.status)) throw new ApiError(502, "Invalid editorial job status");
      await waitForPoll(controller.signal);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      await cancelEditorialRequest(state, options.headers);
      throw controller.signal.reason;
    }
    if (!state.jobId && error instanceof ApiError && [400, 401, 403, 404, 413, 422].includes(error.status)) state.terminal = true;
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}