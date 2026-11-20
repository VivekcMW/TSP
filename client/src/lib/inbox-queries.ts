import { apiRequest } from "@/lib/queryClient";
import type { InboxListItem } from "@shared/schema";

/** readAt is optional so rows patched locally (before a refetch) still type-check. */
export type InboxRow = Omit<InboxListItem, "readAt"> & Partial<Pick<InboxListItem, "readAt">>;
export type InboxStatus = "active" | "saved" | "dismissed";
export interface DiscoverVisit { previousVisitAt: string | null; currentVisitAt: string }

/** Shared with Discover: ["/api/inbox", "active"] is the same cache entry in both layouts. */
export const inboxStatusKey = (status: InboxStatus) => ["/api/inbox", status] as const;
/** Active stories snoozed until later; hidden from the default active list. */
export const SNOOZED_KEY = ["/api/inbox", "snoozed"] as const;
export const INBOX_LIST_KEYS = [inboxStatusKey("active"), inboxStatusKey("saved"), inboxStatusKey("dismissed"), SNOOZED_KEY] as const;
export const DISCOVER_VISIT_KEY = ["discover-visit"] as const;
export const LINKEDIN_STATUS_KEY = ["/api/integrations/linkedin/status"] as const;

const PAGE = 200;

export async function fetchInboxStatus(status: InboxStatus, signal?: AbortSignal): Promise<InboxRow[]> {
  if (status === "active") return (await apiRequest("GET", "/api/inbox?status=active", undefined, { signal })).json();
  const rows: InboxRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page: unknown = await (await apiRequest("GET", `/api/inbox?status=${status}&limit=${PAGE}&offset=${offset}`, undefined, { signal })).json();
    if (!Array.isArray(page)) throw new Error("Could not load the complete list.");
    rows.push(...page as InboxRow[]);
    if (page.length < PAGE) return rows;
  }
}

export const inboxStatusQuery = (status: InboxStatus, enabled = true) => ({
  queryKey: inboxStatusKey(status),
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchInboxStatus(status, signal),
  enabled,
});

export const snoozedQuery = (enabled = true) => ({
  queryKey: SNOOZED_KEY,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<InboxRow[]> =>
    (await apiRequest("GET", "/api/inbox?status=active&snoozed=only", undefined, { signal })).json(),
  enabled,
});

export const recordVisitQuery = (enabled: boolean) => ({
  queryKey: DISCOVER_VISIT_KEY,
  queryFn: async (): Promise<DiscoverVisit> => (await apiRequest("POST", "/api/inbox/visit")).json(),
  enabled,
  staleTime: Infinity,
  gcTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export interface LinkedInConnectionStatus {
  connected?: boolean;
  assessment?: { canPublish?: boolean; status?: string; reason?: string | null } | null;
}

export function linkedInPostingState(status: LinkedInConnectionStatus | undefined): "ready" | "attention" | "disconnected" | "unknown" {
  if (!status) return "unknown";
  if (status.connected && status.assessment?.canPublish && status.assessment.status === "connected") return "ready";
  return status.connected ? "attention" : "disconnected";
}
