/**
 * Remembers the app page a signed-out visitor was heading to (for example a
 * reminder email's "Write my post" link), so sign-in can bring them back to it.
 * Per tab, used once, and only for /dashboard pages, so it can't redirect off-site.
 */
type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "tsp:return-to";
const MAX_AGE_MS = 30 * 60_000;

function browserStore(): SessionStore | undefined {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; } catch { return undefined; }
}

function isAppPage(path: string) {
  return /^\/dashboard(?:[/?#]|$)/.test(path) && !path.includes("\\") && path.length <= 2300;
}

export function rememberReturnTo(path: string, store: SessionStore | undefined = browserStore(), now = Date.now()) {
  if (!isAppPage(path)) return;
  try { store?.setItem(KEY, JSON.stringify({ path, at: now })); } catch { /* storage blocked: sign-in lands on the dashboard */ }
}

export function takeReturnTo(store: SessionStore | undefined = browserStore(), now = Date.now()): string | null {
  try {
    const raw = store?.getItem(KEY);
    store?.removeItem(KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    return typeof path === "string" && typeof at === "number" && now - at <= MAX_AGE_MS && isAppPage(path) ? path : null;
  } catch {
    return null;
  }
}
