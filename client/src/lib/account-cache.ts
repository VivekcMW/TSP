import { hydrate, type QueryClient } from "@tanstack/react-query";
import { clearEditorialRecovery, readEditorialRecovery, retainEditorialRecoveryForAccount } from "./editorial-recovery";

/** Owns the legacy, unscoped query keys for both session and resolved tenant. */
export function createAccountCache(client: QueryClient) {
  let snapshot = { accountId: undefined as string | null | undefined, tenantId: undefined as string | undefined, pending: true, signingOut: false };
  let revision = 0;
  let lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const emit = (next: typeof snapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };
  const clear = (retainBootstrap = false) => {
    // Preserve only the accepted bootstrap STATE, never a query/promise from
    // the old lifetime. Even an already-resolved query can still have a cache
    // commit queued in a microtask, too late for cancellation to prevent it.
    const queries = retainBootstrap ? client.getQueryCache().getAll()
      .filter(({ queryKey }) => queryKey.length === 1 && (queryKey[0] === "/api/me" || queryKey[0] === "/api/profile"))
      .map(({ queryKey, queryHash, state }) => ({ queryKey, queryHash, state, dehydratedAt: Date.now() })) : [];
    lifetime.abort();
    lifetime = new AbortController();
    // Cancellation is initiated synchronously, BEFORE removal. Even queryFns
    // that ignore AbortSignal cannot commit their late result to a new query.
    const cancelled = client.cancelQueries();
    client.clear(); // Includes mutation cache; server mutations aren't undone.
    if (retainBootstrap) {
      // The same account's /api/me and newly resolved /api/profile are the
      // evidence for this transition. Hydrate preserves errors/timestamps and
      // resets fetchStatus to idle; setQueryData would erase the outage error
      // and authorize writes. No pending promise or mutation is reattached.
      hydrate(client, { queries });
    }
    return cancelled;
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getSignal: () => lifetime.signal,
    async synchronize(accountId: string | null) {
      if (snapshot.signingOut || snapshot.accountId === accountId) return;
      retainEditorialRecoveryForAccount(accountId);
      const current = ++revision;
      emit({ accountId, tenantId: undefined, pending: true, signingOut: false });
      await clear();
      if (revision === current) emit({ accountId, tenantId: undefined, pending: false, signingOut: false });
    },
    async synchronizeTenant(accountId: string | null, tenantId: string) {
      // A stale effect from another session/profile must not claim the cache.
      // Missing account/profile data is not a logout or a new tenant.
      if (snapshot.signingOut || snapshot.accountId !== accountId ||
        (snapshot.pending && snapshot.tenantId === undefined) || !tenantId ||
        client.getQueryData<{ tenantId?: string }>(["/api/profile"])?.tenantId !== tenantId ||
        snapshot.tenantId === tenantId) return;
      if (accountId) readEditorialRecovery({ userId: accountId, tenantId });
      else clearEditorialRecovery();
      if (snapshot.tenantId === undefined) {
        // Account synchronization already emptied unknown/previous-session
        // data. Adopting its first profile must not abort the /api/me bootstrap.
        emit({ ...snapshot, tenantId });
        return;
      }
      const current = ++revision;
      emit({ accountId, tenantId, pending: true, signingOut: false });
      await clear(true);
      if (revision === current) emit({ accountId, tenantId, pending: false, signingOut: false });
    },
    async beginSignOut() {
      clearEditorialRecovery();
      ++revision;
      emit({ accountId: undefined, tenantId: undefined, pending: true, signingOut: true });
      await clear();
    },
    async finishSignOut() {
      const current = ++revision;
      await clear();
      // Re-establish the actual session even when sign-out failed. Never reuse
      // the old cache, and never allow an older transition to release this lock.
      if (revision === current) emit({ accountId: undefined, tenantId: undefined, pending: true, signingOut: false });
    },
  };
}