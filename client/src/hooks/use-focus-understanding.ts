import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { parseUnderstanding, type Understanding } from "@/lib/onboarding-suggestions";

export const UNDERSTAND_DELAY_MS = 1200;
const MIN_LENGTH = 20;
const MAX_AUTOMATIC = 6;
const TIMEOUT_MS = 15_000;
export type UnderstandingStatus = "idle" | "loading" | "ready" | "error";

/** Settle on abort even if the response never finishes. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Step 1: the agent reads the user's focus after a pause in typing (at most six automatic
 * reads per visit) and returns an editable summary, sometimes with one follow-up question.
 */
export function useFocusUnderstanding(focus: string, industry: string | undefined, active: boolean) {
  const [status, setStatus] = useState<UnderstandingStatus>("idle");
  const [understanding, setUnderstanding] = useState<Understanding | null>(null);
  const automatic = useRef(0);
  const readFor = useRef<string>();
  const controller = useRef<AbortController | null>(null);

  const read = useCallback(async (text: string, clarification?: { question: string; answer: string }) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; current.abort(); }, TIMEOUT_MS);
    setStatus("loading");
    try {
      const next = await untilAborted((async () => {
        const response = await apiRequest("POST", "/api/onboarding/understand", {
          focusDescription: text, ...(industry ? { industry } : {}), ...(clarification ? { clarification } : {}),
        }, { signal: current.signal });
        return parseUnderstanding(await response.json());
      })(), current.signal);
      setUnderstanding(next);
      setStatus("ready");
    } catch {
      if (!current.signal.aborted || timedOut) setStatus("error");
    } finally {
      clearTimeout(timer);
      if (controller.current === current) controller.current = null;
    }
  }, [industry]);

  const trimmed = focus.trim();
  useEffect(() => {
    if (!active || trimmed.length < MIN_LENGTH || trimmed === readFor.current || automatic.current >= MAX_AUTOMATIC) return;
    const timer = setTimeout(() => {
      readFor.current = trimmed;
      automatic.current += 1;
      void read(trimmed);
    }, UNDERSTAND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, trimmed, read]);

  useEffect(() => () => controller.current?.abort(), []);

  const answer = useCallback((question: string, reply: string) => {
    readFor.current = trimmed;
    void read(trimmed, { question, answer: reply });
  }, [read, trimmed]);
  const retry = useCallback(() => {
    readFor.current = trimmed;
    void read(trimmed);
  }, [read, trimmed]);

  return { status, understanding, setUnderstanding, answer, retry };
}
