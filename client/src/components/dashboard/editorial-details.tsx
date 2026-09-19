import type { DetailedPostResult } from "@/lib/editorial";
import { supportsArticle, type EditorialFormat } from "@shared/editorial";
import { Button } from "@/components/ui/button";
import { ClaimSupportReview } from "./claim-support-review";

export function EditorialFormatSelect({ platform, value, onChange, disabled }: Readonly<{ platform: string; value: EditorialFormat; onChange: (value: EditorialFormat) => void; disabled?: boolean }>) {
  return <label className="flex flex-wrap items-center gap-2 text-sm"><span>Format</span>
    <select aria-label="Format" className="rounded-md border bg-background p-2" value={supportsArticle(platform) ? value : "short-post"} disabled={disabled} onChange={event => onChange(event.target.value as EditorialFormat)}>
      <option value="short-post">Short post</option>
      {supportsArticle(platform) && <option value="article">Compact article</option>}
    </select>
    <span className="text-xs text-muted-foreground">Platform character limits still apply.</span>
  </label>;
}

export function EditorialProgress({ pending, elapsed, error, cancel, progress }: Readonly<{ pending: boolean; elapsed: number; error: string; cancel: () => void; progress?: { platformsCompleted: number; platformsTotal: number } | null }>) {
  return <>
    {pending && <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-3 text-sm"><output>Reading source and generating… {elapsed}s. {progress && `${progress.platformsCompleted} of ${progress.platformsTotal} platforms completed. `}Results appear when complete; nothing is published automatically.</output><Button variant="outline" size="sm" onClick={cancel}>Cancel generation</Button></div>}
    {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
  </>;
}

export function EditorialDetails({ evidence, detail, edited = false, currentContent }: Readonly<{ evidence?: DetailedPostResult["evidence"]; detail?: Omit<DetailedPostResult, "evidence">; edited?: boolean; currentContent?: string }>) {
  return <section className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm" aria-label="Generation evidence">
    <p className="font-medium">Human review required — not fact-checked.</p>
    <p className="text-xs text-muted-foreground">Source matching and structural checks are not independent factual verification.{edited ? " You edited this draft; attribution mappings describe the original generated text only." : ""}</p>
    {detail && <ClaimSupportReview key={evidence?.sourceId} report={detail.claimSupport} text={detail.content} edited={edited} currentContent={currentContent} />}
    {detail?.generation && <p className="text-xs">Provider: {detail.generation.provider} · Model: {detail.generation.model}{detail.generation.fallbackUsed && <strong className="ml-2">Fallback provider used — review this output carefully.</strong>}</p>}
    {evidence?.warnings.map(warning => <p key={warning.code} className="text-xs text-destructive">{warning.message}</p>)}
    {evidence && <details><summary className="cursor-pointer font-medium">Source evidence excerpts ({evidence.excerpts.length})</summary><div className="mt-2 max-h-64 space-y-3 overflow-y-auto">{evidence.excerpts.map(excerpt => <blockquote key={excerpt.id} className="border-l-2 pl-3"><span className="text-xs font-medium">{excerpt.id}</span><p className="whitespace-pre-wrap">{excerpt.text}</p></blockquote>)}</div></details>}
    {!!detail?.attributions?.length && <details><summary className="cursor-pointer">Reported claims → source passages</summary><ul className="mt-2 space-y-2">{detail.attributions.map((attribution, index) => <li key={`${index}:${attribution.text}`}>{attribution.text} <span className="text-xs text-muted-foreground">({attribution.excerptIds.join(", ")})</span></li>)}</ul></details>}
  </section>;
}