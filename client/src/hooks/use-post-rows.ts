import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllPages } from "@/lib/queryClient";
import { fetchPublishingSchedules } from "@/lib/publishing";
import { DRAFTS_KEY, postRows, SCHEDULES_KEY } from "@/lib/post-folders";
import type { Draft } from "@shared/schema";

/** Drafts and schedules from the same cache as the Content page, filed into Inbox post folders. */
export function usePostRows(enabled: boolean, poll = false) {
  const interval = poll ? { refetchInterval: 15_000 } : {};
  const drafts = useQuery<Draft[]>({ queryKey: DRAFTS_KEY, queryFn: ({ signal }) => fetchAllPages<Draft>("/api/drafts", signal), enabled, ...interval });
  const schedules = useQuery({ queryKey: SCHEDULES_KEY, queryFn: ({ signal }) => fetchPublishingSchedules(signal), enabled, ...interval });
  const rows = useMemo(() => postRows(drafts.data ?? [], schedules.data?.items ?? []), [drafts.data, schedules.data]);
  return { rows, drafts, schedules };
}
