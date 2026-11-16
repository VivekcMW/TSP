import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ClientFeatures } from "@shared/client-features";

const CLASSIC_LAYOUT_KEY = "tsp:classic-layout";
const listeners = new Set<() => void>();

function prefersClassicLayout(): boolean {
  try { return window.localStorage.getItem(CLASSIC_LAYOUT_KEY) === "1"; } catch { return false; }
}

/** Per-browser escape hatch while the Inbox layout is in beta; the tenant flag still decides availability. */
export function setClassicLayoutPreference(classic: boolean) {
  try {
    if (classic) window.localStorage.setItem(CLASSIC_LAYOUT_KEY, "1");
    else window.localStorage.removeItem(CLASSIC_LAYOUT_KEY);
  } catch {
    // Storage can be unavailable (private mode); the flag decides instead.
  }
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

export function useClientFeatures(enabled: boolean) {
  return useQuery<ClientFeatures>({ queryKey: ["/api/features"], enabled, staleTime: 5 * 60_000, retry: false });
}

/** "inbox" only when the tenant flag is on and this browser has not chosen the classic layout. Errors keep classic. */
export function useWorkspaceLayout(enabled: boolean): { layout: "loading" | "inbox" | "classic"; inboxAvailable: boolean } {
  const features = useClientFeatures(enabled);
  const classic = useSyncExternalStore(subscribe, prefersClassicLayout, () => false);
  const inboxAvailable = Boolean(features.data?.linkedinInbox);
  if (enabled && features.isLoading) return { layout: "loading", inboxAvailable };
  return { layout: inboxAvailable && !classic ? "inbox" : "classic", inboxAvailable };
}
