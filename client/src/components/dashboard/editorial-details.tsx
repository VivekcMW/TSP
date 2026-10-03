import type { DetailedPostResult, ReviewResponse } from "@/lib/editorial";
import { supportsArticle, type EditorialFormat } from "@shared/editorial";
import { Button } from "@/components/ui/button";
import { Field, fieldControlClassName } from "@/components/ui/field";
import { getPlatformMeta } from "@/lib/platforms";
import { ClaimSupportReview } from "./claim-support-review";
import { publicSourceUrl } from "./create-post-state";
import { WorkflowStatus } from "./workflow-status";

export function EditorialFormatSelect({ platform, value, onChange, disabled }: Readonly<{ platform: string; value: EditorialFormat; onChange: (value: EditorialFormat) => void; disabled?: boolean }>) {
  return <Field label="Format" help="Platform character limits still apply." render={controlProps =>
    <select {...controlProps} className={fieldControlClassName} value={supportsArticle(platform) ? value : "short-post"} disabled={disabled} onChange={event => onChange(event.target.value as EditorialFormat)}>
      <option value="short-post">Short post</option>
      {supportsArticle(platform) && <option value="article">Compact article</option>}
    </select>
  } />;
}

export function EditorialProgress({ pending, elapsed, error, cancel, progress, batch }: Readonly<{ pending: boolean; elapsed: number; error: string; cancel: () => void; progress?: { platformsCompleted: number; platformsTotal: number } | null; batch?: { targets: string[]; completed: string[]; current?: string } }>) {
  return <>
    {pending && <WorkflowStatus tone="info" actions={<Button variant="outline" onClick={cancel}>Cancel generation</Button>}>
      {batch ? `Batch: ${batch.completed.length} of ${batch.targets.length} posts completed. Generating ${getPlatformMeta(batch.current ?? "").label}. ` : "Reading source and generating… "}
      {elapsed}s. {!batch && progress && progress.platformsTotal > 1 && `${progress.platformsCompleted} of ${progress.platformsTotal} platforms completed. `}Results appear when complete; nothing is published automatically.
    </WorkflowStatus>}
    {error && <WorkflowStatus tone="error">{error}</WorkflowStatus>}
  </>;
}

export function SourceReview({ article, format, headingLevel = 3 }: Readonly<{ article: ReviewResponse["article"]; format?: EditorialFormat; headingLevel?: 3 | 4 }>) {
  const originalUrl = publicSourceUrl(article.url);
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return <section aria-label="Source context" className="min-w-0 space-y-2 rounded-[6px] border border-border bg-card p-3 text-sm">
    <Heading className="break-words font-semibold">Source: {article.title}</Heading>
    <p className="text-muted-foreground">{article.source}{format && ` · Generated format: ${format}`}</p>
    {originalUrl && <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-primary underline">Open original</a>}
    <p className="font-medium">{article.domain === "manual" ? "Your supplied article content" : "Fetched article content"}</p>
    <section aria-label="Source text" className="max-h-64 overflow-auto whitespace-pre-wrap break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} data-testid="text-source-content">{article.content}</section>
    {!!article.media?.length && <p>{article.media.length} attachment(s) included. Media is not inspected as evidence; attach files manually when opening an external platform.</p>}
  </section>;
}

export function EditorialDetails({ evidence, detail, edited = false, currentContent }: Readonly<{ evidence?: DetailedPostResult["evidence"]; detail?: Omit<DetailedPostResult, "evidence">; edited?: boolean; currentContent?: string }>) {
  return <section className="min-w-0 space-y-3 text-sm" aria-label="Generation evidence">
    <WorkflowStatus tone="warning" live={false} title="Human review required — not fact-checked.">
      <p>Source matching and structural checks are not independent factual verification.{edited ? " You edited this draft; attribution mappings describe the original generated text only." : ""}</p>
      {detail?.generation?.fallbackUsed && <p className="font-medium">Fallback provider used — review this output carefully.</p>}
      {evidence?.warnings.map(warning => <p key={warning.code}>{warning.message}</p>)}
    </WorkflowStatus>
    {detail && <ClaimSupportReview key={evidence?.sourceId} report={detail.claimSupport} text={detail.content} edited={edited} currentContent={currentContent} />}
    <details className="rounded-[6px] border bg-card px-3 py-2">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">Generation details</summary>
      <div className="space-y-3">
        {detail?.generation && <p>Provider: {detail.generation.provider} · Model: {detail.generation.model}</p>}
        {evidence && <details><summary className="min-h-11 cursor-pointer py-2 font-medium">Source evidence excerpts ({evidence.excerpts.length})</summary><div className="mt-2 max-h-64 space-y-3 overflow-y-auto">{evidence.excerpts.map(excerpt => <blockquote key={excerpt.id} className="border-l-2 pl-3"><span className="text-xs font-medium">{excerpt.id}</span><p className="whitespace-pre-wrap break-words">{excerpt.text}</p></blockquote>)}</div></details>}
        {!!detail?.attributions?.length && <details><summary className="min-h-11 cursor-pointer py-2">Reported claims → source passages</summary><ul className="mt-2 space-y-2">{detail.attributions.map((attribution, index) => <li key={`${index}:${attribution.text}`}>{attribution.text} <span className="text-xs text-muted-foreground">({attribution.excerptIds.join(", ")})</span></li>)}</ul></details>}
      </div>
    </details>
  </section>;
}