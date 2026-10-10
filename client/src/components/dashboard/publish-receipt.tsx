import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { getPlatformMeta } from "@/lib/platforms";
import type { PublishJobLog } from "@shared/schema";

/** Receipts are fetched only on explicit expansion, never for every list card. */
export function PublishReceipt({ draftId }: { draftId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data: logs, isLoading, isError, refetch, isFetching } = useQuery<PublishJobLog[]>({
    queryKey: [`/api/drafts/${encodeURIComponent(draftId)}/publish-logs`],
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", `/api/drafts/${encodeURIComponent(draftId)}/publish-logs`, undefined, { signal });
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error("Invalid receipt response");
      return rows;
    },
    enabled: expanded,
  });
  return <section className="mt-3 text-xs">
    <Button size="sm" variant="ghost" aria-expanded={expanded} aria-controls={`receipt-${draftId}`} onClick={() => setExpanded(value => !value)}>
      {expanded ? "Hide publishing receipts" : "Show publishing receipts"}
    </Button>
    {expanded && <div id={`receipt-${draftId}`} className="mt-2 max-h-60 space-y-2 overflow-y-auto rounded-md border p-3">
      {isLoading ? <p role="status">Loading publishing receipts…</p> : isError ? <div role="alert">
        <p>Publishing receipts could not be loaded. Delivery is not confirmed by this error.</p>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>Retry receipts</Button>
      </div> : !logs?.length ? <p>No publish log is available yet. This is not confirmation of delivery.</p> : logs.map(log => <div key={log.id} className="space-y-1 break-words border-b pb-2 last:border-0">
        <p>{getPlatformMeta(log.platform).label} · {log.status} · attempt {log.attempt}/{log.maxAttempts}</p>
        {log.startedAt && <p className="text-muted-foreground">{new Date(log.startedAt).toLocaleString()}</p>}
        <p>Mode: {log.executionMode ?? "legacy / unverified"}</p>
        {log.executionMode === "live" && log.receiptKind === "provider_id" && log.publishedPostId && <p>Provider post ID: {log.publishedPostId}</p>}
        {log.status === "simulated" && <p>Simulation only — no external post or provider receipt.</p>}
        {log.receiptKind === "unavailable" && <p>Provider accepted the request; a delivery receipt is unavailable.</p>}
        {log.evidence && <div><p>Manual decision: {log.evidence.decision}. Not provider-verified.</p><p>Operator: {log.actorUserId}</p><p>{log.evidence.note}</p>{log.evidence.receipt && <p>Operator-supplied receipt: {log.evidence.receipt}</p>}</div>}
        {log.errorMessage && <p className="text-destructive whitespace-pre-wrap">{log.errorMessage}</p>}
      </div>)}
    </div>}
  </section>;
}