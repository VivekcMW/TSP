/**
 * Which tenant the client acts in, beyond the default (the user's own
 * personal tenant, which requireDbUser falls back to when no header is
 * sent). Persisted locally so a page reload keeps the chosen workspace.
 */
const STORAGE_KEY = "tsp:active-tenant-id";

export function getActiveTenantId(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function setActiveTenantId(tenantId: string | null): void {
  try {
    if (tenantId) localStorage.setItem(STORAGE_KEY, tenantId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable; the active tenant just won't persist */ }
}

/** Merge into request headers; empty when acting in the default personal tenant. */
export function tenantHeaders(): Record<string, string> {
  const tenantId = getActiveTenantId();
  return tenantId ? { "X-Tenant-Id": tenantId } : {};
}
