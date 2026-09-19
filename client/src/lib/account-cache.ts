import type { QueryClient } from "@tanstack/react-query";
import { clearEditorialRecovery, retainEditorialRecoveryForAccount } from "./editorial-recovery";

/** Owns the legacy, unscoped query keys. No tenant-switch UI/protocol is implied. */
export function createAccountCache(client: QueryClient) {
  let snapshot = { accountId: undefined as string | null | undefined, pending: true, signingOut: false };
  let revision = 0;
  let lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const emit = (next: typeof snapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };
  const clear = () => {
    lifetime.abort();
    lifetime = new AbortController();
    // Cancellation is initiated synchronously, BEFORE removal. Even queryFns
    // that ignore AbortSignal cannot commit their late result to a new query.
    const cancelled = client.cancelQueries();
    client.clear(); // Includes mutation cache; server mutations aren't undone.
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
      emit({ accountId, pending: true, signingOut: false });
      await clear();
      if (revision === current) emit({ accountId, pending: false, signingOut: false });
    },
    async beginSignOut() {
      clearEditorialRecovery();
      ++revision;
      emit({ accountId: undefined, pending: true, signingOut: true });
      await clear();
    },
    async finishSignOut() {
      const current = ++revision;
      await clear();
      // Re-establish the actual session even when sign-out failed. Never reuse
      // the old cache, and never allow an older transition to release this lock.
      if (revision === current) emit({ accountId: undefined, pending: true, signingOut: false });
    },
  };
}