import { useState } from "react";
import type { ClaimSupportReport } from "@shared/editorial-claims";

function ReviewAcknowledgement() {
  const [reviewed, setReviewed] = useState(false);
  return <div className="space-y-2">
    <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I have reviewed the wording, source context, numbers, names, and uncertainty.</label>
    {reviewed && <output className="block">Human review acknowledged for this text in this session only. This is not a factual verification certificate or publishing approval.</output>}
  </div>;
}

export function ClaimSupportReview({ report, text, edited, currentContent }: Readonly<{ report?: ClaimSupportReport; text: string; edited: boolean; currentContent?: string }>) {
  return <div className="space-y-3" aria-label="Claim support review">
    <p className="font-medium">Claim support: needs review</p>
    <p>Conservative source comparison only. “Supported” means an exact source sentence, not that the source is true. Contradictions are narrow comparison warnings; unknown means meaning was not established.</p>
    {edited && <p>Text changed. The original claim report is stale; review your current wording against the source.</p>}
    {!edited && !report && <p>No claim-support report is available for this version.</p>}
    {!edited && report && <details><summary className="cursor-pointer">Claim checks ({report.claims.length})</summary>
      {report.truncated && <p>Report limited: some text or comparison spans were omitted. Review the full source and current text.</p>}
      <ul className="space-y-3">{report.claims.map(claim => <li key={`${claim.start}:${claim.end}`} className="space-y-1 border-l-2 pl-3">
        <p className="whitespace-pre-wrap">{claim.text}</p><p><strong>{claim.status}</strong> · {claim.reason.replaceAll("-", " ")}</p>
        {claim.sourceSpans.length > 0 && <p className="text-xs">Cited comparison spans (not necessarily supporting this claim):</p>}
        {claim.sourceSpans.map(span => <blockquote key={`${span.excerptId}:${span.start}`} className="text-xs"><span>{span.excerptId} · source offsets {span.start}–{span.end}</span><p className="whitespace-pre-wrap">{span.text}</p></blockquote>)}
      </li>)}</ul>
    </details>}
    {(!edited || currentContent !== undefined) && <ReviewAcknowledgement key={currentContent ?? text} />}
  </div>;
}