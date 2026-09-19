import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { cancelEditorialRequest, createEditorialRequestState, editorialDetachReason, editorialRequest, type EditorialProgress, type EditorialRequestState } from "@/lib/editorial-request";
import { clearEditorialRecovery, readEditorialRecovery, saveEditorialRecovery, type EditorialRecoveryScope } from "@/lib/editorial-recovery";

function generationError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "Generation cancelled. An attempt that already started may still count toward usage.";
  return error instanceof Error ? error.message : "Generation failed. Try again or supply another article.";
}

/** One active request per surface; late completions cannot resurrect a cancelled result. */
export function useEditorialGeneration<T>(options: { scope?: EditorialRecoveryScope; onRecovered?: (data: T) => void } = {}) {
  const controller = useRef<AbortController | null>(null);
  const intent = useRef<{ endpoint: string; body: unknown; key: string; state: EditorialRequestState; reloaded?: boolean } | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;
  const [reattached, setReattached] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const started = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<EditorialProgress | null>(null);
  const { mutateAsync } = useMutation({
    retry: false,
    mutationFn: async ({ endpoint, body, signal, state, reloaded }: { endpoint: string; body: unknown; signal: AbortSignal; state: EditorialRequestState; reloaded?: boolean }): Promise<T> => {
      const scope = callbacks.current.scope;
      return editorialRequest<T>(endpoint, body, { signal, state, reconnectOnly: reloaded,
        headers: scope ? { "x-tenant-id": scope.tenantId } : undefined,
        onAdmitted: admitted => {
          if (scope && admitted.jobId && controller.current?.signal === signal && !signal.aborted) saveEditorialRecovery(scope, admitted.jobId, admitted.requestIntent);
        }, onProgress: value => {
        if (controller.current?.signal === signal && !signal.aborted) setProgress(value);
      } });
    },
  });
  useEffect(() => () => {
    controller.current?.abort(editorialDetachReason()); controller.current = null;
  }, []);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);
  const cancel = useCallback(async () => {
    const current = intent.current;
    if (!current) return;
    if (controller.current && current.endpoint.startsWith("/api/instant-review/")) {
      setError("Cancelling generation…");
      controller.current.abort(); // The transport awaits DELETE and reports its outcome.
      return;
    }
    controller.current?.abort(); controller.current = null;
    try {
      if (current.endpoint.startsWith("/api/instant-review/")) await cancelEditorialRequest(current.state,
        callbacks.current.scope ? { "x-tenant-id": callbacks.current.scope.tenantId } : undefined);
      current.state.terminal = true;
      if (current.state.jobId) clearEditorialRecovery(current.state.jobId);
      setRecoverable(false);
      setError("Generation cancelled. An attempt that already started may still count toward usage.");
    } catch (error_) { setRecoverable(!current.state.terminal); setError(generationError(error_)); }
    setPending(false);
  }, []);
  const reset = useCallback(() => {
    const active = controller.current;
    controller.current?.abort(); controller.current = null;
    if (!active && intent.current?.state.jobId && !intent.current.state.terminal) cancelEditorialRequest(intent.current.state).catch(() => undefined);
    setPending(false); setRecoverable(false); setError("");
  }, []);
  const generate = useCallback(async (endpoint: string, body: unknown, retryIntent = false): Promise<T | undefined> => {
    const key = JSON.stringify([endpoint, body]);
    const previous = intent.current;
    const unresolved = previous?.endpoint.startsWith("/api/instant-review/") && !previous.state.terminal ? previous : null;
    if (unresolved && unresolved.key !== key) {
      setError("Retry or cancel the previous request before starting another generation.");
      setRecoverable(true);
      return;
    }
    controller.current?.abort();
    // "Retry same request" must inspect the original job, even after terminal
    // failure/cancellation. Only an explicit Generate action creates a new spend.
    const current = (retryIntent ? previous : unresolved) ?? { endpoint, body, key, state: createEditorialRequestState(), reloaded: false };
    intent.current = current;
    if (!current.reloaded) setReattached(false);
    const request = new AbortController();
    controller.current = request;
    started.current = Date.now();
    setPending(true); setRecoverable(false); setError(""); setElapsed(0); setProgress(null);
    try {
      // A new monitoring window, never a new provider operation. Server status
      // owns expiry; an old client deadline must not prevent reading the outcome.
      if (current.state.jobId) current.state.deadline = Date.now() + 310_000;
      const data = await mutateAsync({ endpoint, body, signal: request.signal, state: current.state, reloaded: current.reloaded });
      current.state.terminal = true;
      if (controller.current === request && !request.signal.aborted) {
        if (current.reloaded) callbacks.current.onRecovered?.(data);
        return data;
      }
    } catch (error_) {
      if (!endpoint.startsWith("/api/instant-review/")) current.state.terminal = true;
      if (controller.current === request) {
        setRecoverable(!current.state.terminal);
        setError(generationError(error_));
      }
    } finally {
      if (controller.current === request) {
        if (current.state.terminal && current.state.jobId) clearEditorialRecovery(current.state.jobId);
        controller.current = null; setPending(false);
      }
    }
  }, [mutateAsync]);
  const retry = useCallback(() => intent.current ? generate(intent.current.endpoint, intent.current.body, true) : Promise.resolve(undefined), [generate]);
  const tenantId = options.scope?.tenantId, userId = options.scope?.userId;
  useEffect(() => {
    setReattached(false); setPending(false); setRecoverable(false); setError("");
    if (!tenantId || !userId) return;
    const stored = readEditorialRecovery({ tenantId, userId });
    if (stored) {
      const endpoint = "/api/instant-review/selected";
      intent.current = { endpoint, body: undefined, key: JSON.stringify([endpoint, undefined]),
        state: { jobId: stored.jobId, requestIntent: stored.requestIntent }, reloaded: true };
      setReattached(true);
      void generate(endpoint, undefined, true);
    }
    return () => {
      controller.current?.abort(editorialDetachReason()); controller.current = null;
      intent.current = null;
    };
  }, [tenantId, userId, generate]);
  return { generate, retry, recoverable, reattached, pending, error, elapsed, progress, cancel, reset };
}