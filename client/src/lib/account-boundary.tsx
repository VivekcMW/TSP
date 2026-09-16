import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "./auth";
import { accountCache } from "./queryClient";
import { LoadingScreen } from "@/components/loading-screen";

/** No descendant query observer may read stale data while identity changes. */
export function AccountBoundary({ children }: Readonly<{ children: ReactNode }>) {
  const { user, isPending } = useAuth();
  const scope = useSyncExternalStore(accountCache.subscribe, accountCache.getSnapshot);
  const accountId = user?.id ?? null;
  useEffect(() => {
    if (!isPending && !scope.signingOut) void accountCache.synchronize(accountId);
  }, [accountId, isPending, scope.signingOut, scope.accountId]);

  if (isPending || scope.pending || scope.signingOut || scope.accountId !== accountId) return <LoadingScreen />;
  return <>{children}</>;
}