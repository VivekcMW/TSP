import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { parseUnderstanding, type Understanding } from "@/lib/onboarding-suggestions";

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
 * Step 1: Pundit reads what the user sent about their work and returns an editable summary,
 * sometimes with one follow-up question. Only the latest read counts.
 */
export function useFocusUnderstanding(industry: string | undefined) {
  const [status, setStatus] = useState<UnderstandingStatus>("idle");
  const [understanding, setUnderstanding] = useState<Understanding | null>(null);
  const lastText = useRef("");
  const controller = useRef<AbortController | null>(null);

  const read = useCallback(async (text: string, clarification?: { question: string; answer: string }) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    lastText.current = text;
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

  useEffect(() => () => controller.current?.abort(), []);

  const understand = useCallback((text: string) => { void read(text); }, [read]);
  const answer = useCallback((question: string, reply: string) => { void read(lastText.current, { question, answer: reply }); }, [read]);
  const retry = useCallback(() => { if (lastText.current) void read(lastText.current); }, [read]);
  const cancel = useCallback(() => { controller.current?.abort(); controller.current = null; setStatus(previous => previous === "loading" ? "idle" : previous); }, []);

  return { status, understanding, setUnderstanding, understand, answer, retry, cancel };
}
