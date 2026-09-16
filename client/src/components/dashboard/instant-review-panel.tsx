import { Link } from "wouter";
import { ExternalLink, PenLine } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getPlatformMeta } from "@/lib/platforms";
import { EditorialDetails, EditorialFormatSelect, EditorialProgress } from "./editorial-details";
import { RichArticleEditor } from "./rich-article-editor";
import { CREATE_TONES, isEdited, publicSourceUrl, type CreateTone } from "./create-post-state";
import type { CreatePostComposer } from "./use-create-post-composer";

interface InstantReviewPanelProps {
  isOpen: boolean;
  onClose: () => boolean;
  composer: CreatePostComposer;
}

/** Presentation only: the provider owns the single persistent creation session. */
export function InstantReviewPanel({ isOpen, onClose, composer: c }: Readonly<InstantReviewPanelProps>) {
  const version = c.version;
  const article = version?.review.article;
  const originalUrl = article?.url ? publicSourceUrl(article.url) : undefined;
  const meta = getPlatformMeta(c.platform);
  const saved = version?.status === "saved" && Boolean(version.savedId);
  let saveLabel = version?.savedId ? "Save changes" : "Save draft";
  if (saved) saveLabel = "Saved";
  if (version?.status === "saving") saveLabel = "Saving…";
  return <Sheet open={isOpen} onOpenChange={open => !open && onClose()}>
    <SheetContent side="right" className="flex h-dvh w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl [&>button]:min-h-11 [&>button]:min-w-11">
      <SheetHeader className="shrink-0 border-b px-4 py-5 pr-16 text-left sm:px-6 sm:pr-16">
        <SheetTitle className="flex items-center gap-2"><PenLine className="h-5 w-5" />Create draft</SheetTitle>
        <SheetDescription>Choose a source, generate explicitly, then review and save. Nothing is published or scheduled automatically.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6 [&_button]:min-h-11 [&_select]:min-h-11 [&_input]:min-h-11 [&_summary]:min-h-11">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 space-y-1 text-sm"><span>Platform</span>
            <select aria-label="Platform" className="block w-full min-w-0 rounded-md border bg-background px-3" value={c.platform} disabled={c.busy || !c.platforms.length} onChange={event => c.setPlatform(event.target.value)}>
              {!c.platforms.length && <option value="">{c.preferencesReady ? "No available platforms" : "Loading preferences…"}</option>}
              {c.platforms.map(platform => <option key={platform.value} value={platform.value}>{platform.label}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-sm"><span>Tone</span>
            <select aria-label="Tone" className="block w-full rounded-md border bg-background px-3" value={c.tone} disabled={c.busy} onChange={event => c.setTone(event.target.value as CreateTone)}>
              {CREATE_TONES.map(tone => <option key={tone.key} value={tone.key}>{tone.label}</option>)}
            </select>
          </label>
        </div>
        {c.preferencesError && <div role="alert" className="text-sm">Could not load platform preferences. Generation and saving are disabled.<Button variant="outline" onClick={c.retryPreferences}>Retry preferences</Button></div>}
        {c.preferencesReady && !c.platforms.length && <output className="block text-sm">No enabled platforms are available. Update your publishing preferences in Settings.</output>}
        <EditorialFormatSelect platform={c.platform} value={c.format} onChange={c.setFormat} disabled={c.busy} />
        <label className="block space-y-1 text-sm"><span>Source type</span>
          <select aria-label="Source type" className="block w-full rounded-md border bg-background px-3" value={c.mode} disabled={c.busy} onChange={event => c.setMode(event.target.value as typeof c.mode)}>
            <option value="url">Article URL</option><option value="article">Discover story</option><option value="manual">Write article</option>
          </select>
        </label>
        {c.mode === "article" && <section aria-label="Choose a story" className="space-y-2">
          <label className="block space-y-1 text-sm"><span>Story</span>
            <select aria-label="Story" className="block w-full min-w-0 rounded-md border bg-background px-3" disabled={c.busy} value={c.item?.id ?? ""} onChange={event => { const item = c.inbox.find(value => value.id === event.target.value); if (item) c.prefill(item); }}>
              <option value="">Choose a story (no generation yet)</option>
              {c.item && !c.inbox.some(value => value.id === c.item!.id) && <option value={c.item.id}>{c.item.headline}</option>}
              {c.inbox.map(item => <option key={item.id} value={item.id}>{item.headline}</option>)}
            </select>
          </label>
          {c.inboxLoading && <p className="text-sm">Loading stories…</p>}
          {c.inboxError && <Button variant="outline" onClick={() => void c.retryInbox()}>Retry stories</Button>}
          {!c.inboxLoading && !c.inboxError && !c.inbox.length && <p className="text-sm text-muted-foreground">No stories yet. Paste a URL or write an article instead.</p>}
          {c.item && <div className="rounded-md border p-3 text-sm"><p className="font-medium">{c.item.headline}</p><p className="text-muted-foreground">{c.item.source}</p><p className="mt-2 whitespace-pre-wrap">{c.item.summary}</p><p className="mt-2 text-xs text-muted-foreground">Inbox summary only — the full source is fetched after you click Generate.</p></div>}
        </section>}
        {c.mode === "manual" ? <RichArticleEditor value={c.manual} onChange={c.setManual} isPending={c.busy} onUploadingChange={c.setUploading} /> :
          <label className="block space-y-1 text-sm">Article URL<Input aria-label="Article URL" type="url" value={c.url} disabled={c.busy} onChange={event => c.setUrl(event.target.value)} placeholder="https://…" data-testid="input-instant-review-url" /></label>}
        <Button className="w-full sm:w-auto" disabled={!c.canGenerate} onClick={() => void c.generate()} data-testid="button-regenerate">
          {version ? "Regenerate" : "Generate"} {c.platform ? meta.label : "posts"} only
        </Button>
        <p className="text-xs text-muted-foreground">One platform, four tones per request. Switching platform or tone never generates automatically. Existing versions keep their own source evidence.</p>
        <EditorialProgress {...c.generation} />
        {c.generation.error && !c.generation.pending && <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={c.saving} onClick={() => void c.generate(true)}>Retry same request</Button>
          {c.generation.recoverable && <Button variant="outline" onClick={() => void c.generation.cancel()}>Cancel generation</Button>}
        </div>}
        {c.notice && <output className="block text-sm">{c.notice}</output>}
        {version ? <section className="min-w-0 space-y-4 border-t pt-5" aria-label="Draft review">
          <div className="space-y-2 text-sm">
            <h3 className="font-medium">Source: {article?.title}</h3>
            <p className="text-muted-foreground">{article?.source} · Generated format: {version.review.format}</p>
            {originalUrl && <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 underline">Open original<ExternalLink className="h-4 w-4" /></a>}
            <details><summary className="cursor-pointer font-medium">{article?.domain === "manual" ? "Your supplied article content" : "Fetched article content"}</summary><p className="max-h-64 overflow-auto whitespace-pre-wrap break-words" data-testid="text-source-content">{article?.content}</p></details>
            {!!article?.media?.length && <p>{article.media.length} attachment(s) included. Media is not inspected as evidence.</p>}
          </div>
          <EditorialDetails evidence={version.review.evidence} detail={version.review.details?.[version.platform]?.[version.tone]} edited={isEdited(version)} />
          <label className="block space-y-2 text-sm">Post content {isEdited(version) && <span className="font-medium">· Edited</span>}
            <Textarea aria-label="Post content" value={version.content} disabled={c.busy} onChange={event => c.edit(event.target.value)} className="min-h-60 resize-y" data-testid="textarea-post-content" />
          </label>
          <p className="text-xs text-muted-foreground">{version.content.length} / {Math.min(5000, meta.charLimit)} characters. Hashtags may be edited directly in the text.</p>
          {!c.canUse && !c.busy && <p role="alert" className="text-sm text-destructive">Enter non-empty text within the platform limit before saving or copying.</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!c.canUse || saved} onClick={() => void c.save()} data-testid="button-save-draft">{saveLabel}</Button>
            <Button variant="outline" disabled={!c.canUse} onClick={() => void c.copy()} data-testid="button-copy-content">Copy text</Button>
            {c.canUse && <a className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm" href={meta.composeUrl(version.content, originalUrl)} target="_blank" rel="noopener noreferrer" data-testid="button-post-now">Open {meta.label}</a>}
          </div>
          <p className="text-xs text-muted-foreground">Copy text, then open the platform to paste manually. Opening a platform does not copy or confirm publication.</p>
          {c.copyStatus && <output className="block text-sm">{c.copyStatus}</output>}
          {version.status === "failed" && <p role="alert" className="text-sm text-destructive">Could not save draft. {version.error}</p>}
          {saved && <div className="space-y-2 rounded-md border p-3 text-sm">
            <output>Draft saved. Review publishing readiness in Content for direct posting, or choose a time in Calendar.</output>
            <div className="flex flex-wrap gap-3"><Link className="inline-flex min-h-11 items-center underline" href="/dashboard/content" onClick={event => { if (!onClose()) event.preventDefault(); }}>Go to Content</Link><Link className="inline-flex min-h-11 items-center underline" href="/dashboard/calendar" onClick={event => { if (!onClose()) event.preventDefault(); }}>Go to Calendar</Link></div>
          </div>}
        </section> : <p className="text-sm text-muted-foreground">No version for this platform yet. Choose a source and click Generate when ready.</p>}
      </div>
    </SheetContent>
  </Sheet>;
}
