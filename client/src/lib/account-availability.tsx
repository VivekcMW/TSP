import type { ReactNode } from "react";
import { queryClient } from "./queryClient";

/** Stable parent across failures/recovery: never remount the workspace's work. */
export function AccountAvailability({ unavailable, children }: Readonly<{ unavailable: boolean; children: ReactNode }>) {
  return <div className="flex h-dvh min-h-0 flex-col">
    {unavailable && <output className="block shrink-0 border-b bg-muted px-4 py-2 text-sm" aria-live="polite">
      <span>Account information is temporarily unavailable. Your open work is retained; actions requiring unavailable information are paused.</span>{" "}
      <button type="button" className="ml-3 min-h-11 underline" onClick={() => {
        void queryClient.refetchQueries({ queryKey: ["/api/me"] });
        void queryClient.refetchQueries({ queryKey: ["/api/profile"] });
      }}>Retry account information</button>
    </output>}
    <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
  </div>;
}