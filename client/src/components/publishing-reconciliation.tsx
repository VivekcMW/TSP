import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { invalidatePublishingQueries, recheckPublishingRecovery, type ScheduleTarget } from "@/lib/publishing";
import { reconciliationSchema, type ReconciliationDecision } from "@shared/publishing-reconciliation";

export function PublishingReconciliation({ draftId, target }: Readonly<{ draftId: string; target: ScheduleTarget }>) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<ReconciliationDecision["decision"]>("unresolved");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState("");
  const [workerStopped, setWorkerStopped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const payload = reconciliationSchema.safeParse({ expectedRevision: target.revision, decision, note, receipt: receipt || undefined, workerStopped });
  if (target.revision === undefined || !["unknown", "publishing", "accepted_unverified"].includes(target.status)) return null;
  return <div className="space-y-2 rounded border p-2 text-sm">
    <Button variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>Record manual reconciliation</Button>
    {open && <form className="space-y-2" onSubmit={async event => {
      event.preventDefault();
      if (!payload.success || busy) return;
      setBusy(true);
      try {
        await apiRequest("POST", `/api/drafts/${encodeURIComponent(draftId)}/schedule/targets/${encodeURIComponent(target.id)}/reconcile`, payload.data);
        setMessage("Manual evidence recorded. No provider verification or publishing was performed.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "Decision could not be recorded. Refresh before retrying."); }
      finally { recheckPublishingRecovery(draftId); await invalidatePublishingQueries().catch(() => setMessage("Refresh status before another decision.")); setBusy(false); }
    }}>
      <p>This is your manual claim, not provider verification. Inspect the provider and existing receipts first. In-flight workers must be stopped by an operator before clearing an attempt for retry; elapsed time alone is not proof.</p>
      <Field label="Decision" render={(controlProps) => <NativeSelect {...controlProps} value={decision} disabled={busy} onChange={event => setDecision(event.target.value as ReconciliationDecision["decision"])}>
        <option value="unresolved">Unresolved — keep replay blocked</option>
        <option value="delivered" disabled={target.executionMode !== "live"}>Delivered — manual receipt required</option>
        <option value="not_delivered">Not delivered — allow a separate explicit retry</option>
      </NativeSelect>} />
      <Field label="Evidence note (no credentials)" render={(controlProps) => <Textarea {...controlProps} minLength={10} maxLength={1000} required value={note} disabled={busy} onChange={event => setNote(event.target.value)} />} />
      <Field label="Provider post ID or receipt reference" render={(controlProps) => <Input {...controlProps} maxLength={300} required={decision === "delivered"} value={receipt} disabled={busy} onChange={event => setReceipt(event.target.value)} />} />
      <label className="flex min-h-11 items-center gap-2"><span className="flex h-11 w-11 shrink-0 items-center justify-center"><input type="checkbox" className="h-4 w-4 accent-primary" checked={workerStopped} disabled={busy} onChange={event => setWorkerStopped(event.target.checked)} /></span>I confirmed the worker is stopped and no request remains in flight.</label>
      <Button disabled={busy || !payload.success} type="submit">Save manual decision — do not publish</Button>
    </form>}
    {message && <output className="block">{message}</output>}
  </div>;
}