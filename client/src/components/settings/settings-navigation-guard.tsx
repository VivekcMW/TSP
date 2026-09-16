import { createContext, useContext, useId, useLayoutEffect, useState, type ReactNode } from "react";

const message = "You have unsaved Settings changes. Leave without saving?";
const positionKey = "__settingsHistoryPosition";
type Position = { scope: string; index: number };
type BrowserNavigation = EventTarget & {
  currentEntry?: { index: number };
  traverseTo: (key: string) => { finished: Promise<unknown> };
};
type TraversalEvent = Event & { navigationType: string; destination: { key: string; url: string; sameDocument: boolean } };
type DirtyRegistry = { report: (id: string, dirty: boolean) => void; isDirty: () => boolean };
const DirtyContext = createContext<DirtyRegistry | null>(null);

// Register before React mounts Wouter's location subscribers. Window events
// are at-target events, so a later capture listener alone is not sufficient
// to run before an earlier subscriber. This dispatcher is inert off Settings.
let onSettingsPopState: ((event: PopStateEvent) => void) | undefined;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", (event) => onSettingsPopState?.(event), true);
}

/** Optional outside Settings: standalone consumers keep their existing behavior. */
export function useSettingsDirty(dirty: boolean) {
  const registry = useContext(DirtyContext);
  const id = useId();
  useLayoutEffect(() => {
    registry?.report(id, dirty);
    return () => registry?.report(id, false);
  }, [registry, id, dirty]);
}

/** Installed only while Settings is mounted. Wrap the already-patched Wouter
 * methods, so cancelled navigation never emits a router update or unmounts forms. */
function installNavigationGuard(registry: DirtyRegistry) {
  const settingsPath = window.location.pathname;
  const scope = crypto.randomUUID();
  const push = history.pushState;
  const replace = history.replaceState;
  // Modern browsers expose positions even for entries created before Settings
  // mounted. Older browsers use namespaced positions on entries we can observe.
  const navigation = (window as Window & { navigation?: BrowserNavigation }).navigation;
  const nativeIndex = () => navigation?.currentEntry?.index;
  const readIndex = (): number | undefined => {
    const index = nativeIndex();
    if (index !== undefined && index >= 0) return index;
    const position = history.state?.[positionKey] as Position | undefined;
    return position?.scope === scope ? position.index : undefined;
  };
  const withPosition = (state: unknown, index: number) => {
    if (nativeIndex() !== undefined || (state !== null && typeof state !== "object")) return state;
    return { ...state, [positionKey]: { scope, index } };
  };
  if (nativeIndex() === undefined) replace.call(history, withPosition(history.state, 0), "");
  const snapshot = () => ({ href: window.location.href, state: history.state, index: readIndex() });
  let current = snapshot();
  let restoring = false;
  let approvedTraversal: string | undefined;
  let pendingPrompt: ReturnType<typeof setTimeout> | undefined;
  const withinSettings = (href: string) => new URL(href, window.location.href).pathname === settingsPath;
  const guarded = () => registry.isDirty() && withinSettings(current.href);
  const mayLeave = (href: string) => !guarded() || withinSettings(href) || window.confirm(message);

  const wrap = (original: History["pushState"], increment: number): History["pushState"] => function (state, unused, url) {
    if (restoring || pendingPrompt !== undefined || (url != null && !mayLeave(String(url)))) return;
    original.call(history, withPosition(state, (current.index ?? 0) + increment), unused, url);
    current = snapshot();
  };
  const guardedPush = wrap(push, 1);
  const guardedReplace = wrap(replace, 0);
  history.pushState = guardedPush;
  history.replaceState = guardedReplace;

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!guarded()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  const beforeNavigate = (event: Event) => {
    const traversal = event as TraversalEvent;
    if (traversal.navigationType !== "traverse" || !traversal.destination.sameDocument || !event.cancelable || restoring) return;
    if (approvedTraversal === traversal.destination.url || !guarded() || withinSettings(traversal.destination.url)) return;
    // Cancel before the URL changes or Wouter can unmount this scope. Prompt
    // in a new task: a synchronous modal inside native traversal can leave the
    // browser's Forward operation pending after cancellation.
    event.preventDefault();
    if (pendingPrompt !== undefined) return;
    const { key, url } = traversal.destination;
    pendingPrompt = setTimeout(() => {
      pendingPrompt = undefined;
      if (!mayLeave(url)) return;
      approvedTraversal = url;
      const clearApproval = () => { approvedTraversal = undefined; };
      // Replay the exact entry, not a fresh push (which would destroy history).
      // Native completion can settle before popstate is delivered. Keep the
      // approval until that event consumes it; only a failed replay clears it.
      void navigation!.traverseTo(key).finished.catch(clearApproval);
    }, 0);
  };
  const popState = (event: PopStateEvent) => {
    if (restoring) {
      // The compensating traversal is not a second navigation attempt. In
      // particular, do not let Wouter unmount Settings while returning to it.
      event.stopImmediatePropagation();
      restoring = false;
      if (window.location.href !== current.href) {
        push.call(history, current.state, "", current.href);
      }
      current = snapshot();
      return;
    }
    const next = snapshot();
    if (approvedTraversal === next.href) {
      approvedTraversal = undefined;
      current = next;
      return;
    }
    if (mayLeave(next.href)) { current = next; return; }
    event.stopImmediatePropagation();
    if (current.index !== undefined && next.index !== undefined && current.index !== next.index) {
      restoring = true;
      history.go(current.index - next.index);
    } else {
      // An older browser cannot reveal the direction/distance of an untracked
      // history entry. Restore safely without guessing go(1) (which can loop or
      // leave the app). This fallback truncates forward history, but keeps edits.
      push.call(history, current.state, "", current.href);
      current = snapshot();
    }
  };
  const hashChange = (event: HashChangeEvent) => {
    if (restoring) event.stopImmediatePropagation();
    else current = snapshot();
  };
  window.addEventListener("beforeunload", beforeUnload);
  navigation?.addEventListener("navigate", beforeNavigate);
  onSettingsPopState = popState;
  window.addEventListener("hashchange", hashChange, true);
  return () => {
    clearTimeout(pendingPrompt);
    window.removeEventListener("beforeunload", beforeUnload);
    navigation?.removeEventListener("navigate", beforeNavigate);
    if (onSettingsPopState === popState) onSettingsPopState = undefined;
    window.removeEventListener("hashchange", hashChange, true);
    if (history.pushState === guardedPush) history.pushState = push;
    if (history.replaceState === guardedReplace) history.replaceState = replace;
  };
}

export function SettingsNavigationGuard({ children }: Readonly<{ children: ReactNode }>) {
  const [registry] = useState<DirtyRegistry>(() => {
    const dirtyForms = new Set<string>();
    return {
      report: (id, dirty) => { if (dirty) dirtyForms.add(id); else dirtyForms.delete(id); },
      isDirty: () => dirtyForms.size > 0,
    };
  });
  useLayoutEffect(() => installNavigationGuard(registry), [registry]);
  return <DirtyContext.Provider value={registry}>{children}</DirtyContext.Provider>;
}