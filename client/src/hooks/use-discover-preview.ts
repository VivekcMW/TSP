import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { OnboardingData } from "@/lib/onboarding-choices";
import { browserSearchEdition, parsePreviewHeadlines, previewTopics, type PreviewHeadline } from "@/lib/onboarding-suggestions";

const PREVIEW_TIMEOUT_MS = 15_000;

/** Today's headlines for the saved top topics: the finish screen's taste of Discover. */
export function useDiscoverPreview(data: OnboardingData | null, industry?: string, country?: string) {
  const topics = useMemo(() => data ? previewTopics(data.keywords) : [], [data]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty">("idle");
  const [headlines, setHeadlines] = useState<PreviewHeadline[]>([]);

  useEffect(() => {
    if (!data) return;
    if (!topics.length) { setStatus("empty"); return; }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, PREVIEW_TIMEOUT_MS);
    setStatus("loading");
    apiRequest("POST", "/api/onboarding/suggestions", {
      step: "preview", focusDescription: data.focusDescription, ...(industry ? { industry } : {}),
      searchEdition: browserSearchEdition(country), publications: data.publicationCandidates ?? [], topics, exclude: [],
    }, { signal: controller.signal })
      .then(response => response.json())
      .then(value => {
        if (controller.signal.aborted) return;
        const found = parsePreviewHeadlines(value);
        setHeadlines(found);
        setStatus(found.length ? "ready" : "empty");
      })
      // Leaving cancels quietly; a failure or timeout just skips the preview.
      .catch(() => { if (!controller.signal.aborted || timedOut) setStatus("empty"); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [data, topics, industry, country]);

  return { status, headlines, hasTopics: topics.length > 0 };
}
