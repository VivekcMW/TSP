import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLATFORMS } from "@/lib/platforms";
import { invalidatePublishingQueries, type PublishingSchedule, type ScheduleTarget } from "@/lib/publishing";

export function ScheduleTargetActions({ item }: Readonly<{ item: PublishingSchedule }>) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const act = async (target: ScheduleTarget, retry: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const url = `/api/drafts/${encodeURIComponent(item.draftId)}/schedule/targets/${encodeURIComponent(target.id)}`;
      const response = await fetch(retry ? `${url}/retry` : url, { method: retry ? "POST" : "DELETE", credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to update this target");
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : "Unable to update this target"}. Refresh status before trying again; the request may have been saved.`);
    } finally {
      // Even a 503 may have saved a retry generation for the scheduler.
      await invalidatePublishingQueries();
      lock.current = false;
      setBusy(false);
    }
  };
  return <div className="mt-2 space-y-2" aria-live="polite">
    {!item.targets?.length && <p className="text-xs text-muted-foreground">Target status unavailable. Check the provider before retrying; delivery could have succeeded.</p>}
    {(item.targets ?? []).map((target) => {
      const label = PLATFORMS.find((platform) => platform.value === target.platform)?.label ?? target.platform;
      const uncertain = !["scheduled", "queued", "publishing", "published", "failed", "cancelled"].includes(target.status);
      return <div key={target.id} className="space-y-1">
        <Badge variant={target.status === "failed" ? "destructive" : "outline"} className="max-w-full whitespace-normal break-words">{label}: {target.status || "unknown"}</Badge>
        {target.lastError && <p className="break-words text-xs text-destructive">{label}: {target.lastError}</p>}
        <div className="flex flex-wrap gap-1">
          {target.status === "failed" && <Button size="sm" variant="outline" disabled={busy || !!error} onClick={() => act(target, true)} aria-label={`Retry ${target.platform}`}>Retry {label}</Button>}
          {["scheduled", "queued", "failed"].includes(target.status) && <Button size="sm" variant="ghost" disabled={busy || !!error} onClick={() => act(target, false)} aria-label={`Cancel ${target.platform}`}>Cancel {label}</Button>}
        </div>
        {uncertain && <p className="text-xs text-muted-foreground">Check the provider before retrying; delivery could have succeeded. Automatic retry is blocked.</p>}
        {target.status === "publishing" && <p className="text-xs text-muted-foreground">Delivery is in flight. Cancellation is no longer safe.</p>}
      </div>;
    })}
    {error && <div role="alert" className="text-xs text-destructive">{error}<Button variant="outline" size="sm" disabled={busy} onClick={async () => { await invalidatePublishingQueries(); setError(""); }}>Refresh target status</Button></div>}
  </div>;
}