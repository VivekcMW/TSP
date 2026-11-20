import { apiRequest } from "@/lib/queryClient";
import type { AdminMoment, MomentFilter, MomentInput, MomentView, WatchAlertView, WatchlistView } from "@shared/moments";

export type { AdminMoment, MomentFilter, MomentView, WatchAlertView, WatchlistView };

const DAY_MS = 86_400_000;
const pad = (value: number) => String(value).padStart(2, "0");

/** Today's date in the browser's zone, as YYYY-MM-DD. */
export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** "Today", "Tomorrow", "In 5 days"; "On now" for a moment that started and has not ended. */
export function whenLabel(moment: Pick<MomentView, "date" | "endDate">, today: string): string {
  const days = daysUntil(moment.date, today);
  if (days < 0) return moment.endDate && moment.endDate >= today ? "On now" : "Ended";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/** "Mon 1 Feb" in the browser's locale, from a calendar date (no time zone shift). */
export function shortDate(date: string, locale?: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export const MAX_MOMENT_DAYS = 120;
export const momentsQuery = (days: number, today: string = localDate()) => {
  const span = Math.min(MAX_MOMENT_DAYS, Math.max(1, Math.round(days)));
  const to = addDays(today, span);
  return {
    queryKey: ["/api/moments", today, to] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<MomentView[]> => {
      const body: unknown = await (await apiRequest("GET", `/api/moments?from=${today}&to=${to}`, undefined, { signal })).json();
      return Array.isArray(body) ? body as MomentView[] : [];
    },
    staleTime: 5 * 60_000,
    retry: false,
  };
};

export const ADMIN_MOMENTS_KEY = ["/api/admin/moments"] as const;
export const adminMomentsQuery = (filter: MomentFilter) => ({
  queryKey: [...ADMIN_MOMENTS_KEY, filter] as const,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<AdminMoment[]> =>
    (await apiRequest("GET", `/api/admin/moments?filter=${filter}`, undefined, { signal, cache: "no-store" })).json(),
});

/** What the admin form sends; the server validates it again. */
export type MomentDraft = Omit<MomentInput, "endsOn" | "url" | "description"> & { endsOn: string | null; url: string | null; description: string | null };
const reasonHeaders = (reason: string) => ({ headers: { "x-access-reason": reason.trim() } });
export async function saveMoment(draft: MomentDraft, reason: string, id?: string): Promise<AdminMoment> {
  const response = id
    ? await apiRequest("PATCH", `/api/admin/moments/${encodeURIComponent(id)}`, draft, reasonHeaders(reason))
    : await apiRequest("POST", "/api/admin/moments", draft, reasonHeaders(reason));
  return response.json();
}
export async function archiveMoment(id: string, archived: boolean, reason: string): Promise<AdminMoment> {
  return (await apiRequest("POST", `/api/admin/moments/${encodeURIComponent(id)}/archive`, { archived }, reasonHeaders(reason))).json();
}

export const WATCHLIST_KEY = ["/api/watchlist"] as const;
export const watchlistQuery = (enabled = true) => ({
  queryKey: WATCHLIST_KEY,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<WatchlistView> => (await apiRequest("GET", "/api/watchlist", undefined, { signal })).json(),
  enabled,
  retry: false,
});
export async function saveWatchlist(terms: WatchlistView["terms"]): Promise<WatchlistView> {
  return (await apiRequest("PUT", "/api/watchlist", { terms })).json();
}

export const WATCH_ALERTS_KEY = ["/api/watch-alerts"] as const;
export const watchAlertsQuery = () => ({
  queryKey: WATCH_ALERTS_KEY,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<WatchAlertView[]> => {
    const body: unknown = await (await apiRequest("GET", "/api/watch-alerts", undefined, { signal })).json();
    return Array.isArray(body) ? body as WatchAlertView[] : [];
  },
  staleTime: 60_000,
  retry: false,
});
export async function markWatchAlertsSeen(ids: string[] | "all"): Promise<{ updated: number }> {
  return (await apiRequest("POST", "/api/watch-alerts/seen", ids === "all" ? { all: true } : { ids })).json();
}
