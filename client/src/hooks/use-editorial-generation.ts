import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { cancelEditorialRequest, createEditorialRequestState, editorialRequest, type EditorialProgress, type EditorialRequestState } from "@/lib/editorial-request";

function generationError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "Generation cancelled. You can try again when ready.";
  return error instanceof Error ? error.message : "Generation failed. Try again or supply another article.";
}

/** One active request per surface; late completions cannot resurrect a cancelled result. */
export function useEditorialGeneration<T>() {
  const controller = useRef<AbortController | null>(null);
  const intent = useRef<{ endpoint: string; body: unknown; key: string; state: EditorialRequestState } | null>(null);
  const [recoverable, setRecoverable] = useState(false);
  const started = useRef(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<EditorialProgress | null>(null);
  const { mutateAsync } = useMutation({
    retry: false,
    mutationFn: async ({ endpoint, body, signal, state }: { endpoint: string; body: unknown; signal: AbortSignal; state: EditorialRequestState }): Promise<T> => {
      return editorialRequest<T>(endpoint, body, { signal, state, onProgress: value => {
        if (controller.current?.signal === signal && !signal.aborted) setProgress(value);
      } });
    },
  });
  useEffect(() => () => {
    const active = controller.current;
    controller.current?.abort(); controller.current = null;
    if (!active && intent.current?.state.jobId && !intent.current.state.terminal) cancelEditorialRequest(intent.current.state).catch(() => undefined);
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
      if (current.endpoint.startsWith("/api/instant-review/")) await cancelEditorialRequest(current.state);
      current.state.terminal = true;
      setRecoverable(false);
      setError("Generation cancelled. You can try again when ready.");
    } catch (error_) { setError(generationError(error_)); }
    setPending(false);
  }, []);
  const reset = useCallback(() => {
    const active = controller.current;
    controller.current?.abort(); controller.current = null;
    if (!active && intent.current?.state.jobId && !intent.current.state.terminal) cancelEditorialRequest(intent.current.state).catch(() => undefined);
    setPending(false); setRecoverable(false); setError("");
  }, []);
  const generate = useCallback(async (endpoint: string, body: unknown): Promise<T | undefined> => {
    const key = JSON.stringify([endpoint, body]);
    const previous = intent.current;
    const unresolved = previous?.endpoint.startsWith("/api/instant-review/") && !previous.state.terminal ? previous : null;
    if (unresolved && unresolved.key !== key) {
      setError("Retry or cancel the previous request before starting another generation.");
      setRecoverable(true);
      return;
    }
    controller.current?.abort();
    const current = unresolved ?? { endpoint, body, key, state: createEditorialRequestState() };
    intent.current = current;
    const request = new AbortController();
    controller.current = request;
    started.current = Date.now();
    setPending(true); setRecoverable(false); setError(""); setElapsed(0); setProgress(null);
    try {
      const data = await mutateAsync({ endpoint, body, signal: request.signal, state: current.state });
      current.state.terminal = true;
      if (controller.current === request && !request.signal.aborted) return data;
    } catch (error_) {
      if (!endpoint.startsWith("/api/instant-review/")) current.state.terminal = true;
      if (controller.current === request) {
        setRecoverable(!current.state.terminal);
        setError(generationError(error_));
      }
    } finally {
      if (controller.current === request) { controller.current = null; setPending(false); }
    }
  }, [mutateAsync]);
  const retry = useCallback(() => intent.current ? generate(intent.current.endpoint, intent.current.body) : Promise.resolve(undefined), [generate]);
  return { generate, retry, recoverable, pending, error, elapsed, progress, cancel, reset };
}