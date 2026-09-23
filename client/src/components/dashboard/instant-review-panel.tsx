import { Link } from "wouter";
import { ChevronDown, ExternalLink, Link2, PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getPlatformMeta } from "@/lib/platforms";
import { EditorialDetails, EditorialProgress } from "./editorial-details";
import { RichArticleEditor } from "./rich-article-editor";
import { isEdited, publicSourceUrl } from "./create-post-state";
import { supportsArticle } from "@shared/editorial";
import type { CreatePostComposer } from "./use-create-post-composer";
import { ApproveVoiceEdit } from "./approve-voice-edit";

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
  return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-muted/20">
      <header className="shrink-0 border-b bg-background px-5 py-3 text-left sm:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <h1 className="flex items-center gap-2 text-xl"><PenLine className="h-5 w-5 text-primary" />Create post</h1>
          <p className="mt-1 text-sm text-muted-foreground">Bring an idea or source. We’ll shape it for your enabled channels, then you choose when it goes live.</p>
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-8 sm:pb-8 [&_button]:min-h-11 [&_select]:min-h-11 [&_input]:min-h-11 [&_summary]:min-h-11">
        <div className="mx-auto w-full max-w-6xl">
        <div className="sticky top-0 z-10 -mx-4 mb-5 border-b bg-background/95 px-4 py-2 shadow-sm backdrop-blur sm:-mx-8 sm:px-8 [&_button]:!min-h-9">
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-background p-1.5">
            <div className="mr-auto flex h-9 items-center gap-1 rounded-md bg-muted/50 p-1 text-xs font-medium text-muted-foreground"><span className="px-2">Create from</span><Button type="button" size="sm" variant={c.mode === "manual" ? "secondary" : "ghost"} disabled={c.busy} onClick={() => c.setMode("manual")}><Sparkles className="h-3.5 w-3.5" />Idea</Button><Button type="button" size="sm" variant={c.mode !== "manual" ? "secondary" : "ghost"} disabled={c.busy} onClick={() => c.setMode("url")}><Link2 className="h-3.5 w-3.5" />Article</Button></div>
            <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="sm" variant="outline" className="justify-between font-normal" disabled={c.busy || !c.toneOptions.length} aria-label="Select tones"><span>{c.selectedTones.length} {c.selectedTones.length === 1 ? "tone" : "tones"}</span><ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56"><DropdownMenuLabel>Select tones</DropdownMenuLabel><DropdownMenuSeparator />{c.toneOptions.map(tone => <DropdownMenuCheckboxItem key={tone.key} checked={c.selectedTones.includes(tone.key)} onCheckedChange={() => { const next = c.selectedTones.includes(tone.key) ? c.selectedTones.filter(value => value !== tone.key) : [...c.selectedTones, tone.key]; c.setSelectedTones(next); if (next.length && !next.includes(c.tone)) c.setTone(next[0]); }}>{tone.label}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
            <label className="sr-only" htmlFor="create-format">Format</label><select id="create-format" aria-label="Format" className="h-9 rounded-md border bg-background px-3 text-sm" value={c.format} disabled={c.busy} onChange={event => c.setFormat(event.target.value as typeof c.format)}><option value="short-post">Short post</option><option value="article" disabled={!supportsArticle(c.platform)}>Article</option></select>
            <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="sm" variant="outline" className="justify-between font-normal" disabled={c.busy || !c.platforms.length} aria-label="Select publish destinations"><span>{c.selectedPlatforms.length} {c.selectedPlatforms.length === 1 ? "destination" : "destinations"}</span><ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-h-80 w-[min(calc(100vw-2rem),420px)] overflow-y-auto"><DropdownMenuLabel>Select up to 4 destinations</DropdownMenuLabel><DropdownMenuSeparator />{c.platforms.map(destination => { const Icon = destination.icon; const checked = c.selectedPlatforms.includes(destination.value); const limitReached = !checked && c.selectedPlatforms.length >= 4; return <DropdownMenuCheckboxItem key={destination.value} checked={checked} disabled={limitReached} onCheckedChange={() => c.setSelectedPlatforms(checked ? c.selectedPlatforms.filter(value => value !== destination.value) : [...c.selectedPlatforms, destination.value])}><Icon className="mr-2 h-4 w-4" />{destination.label}</DropdownMenuCheckboxItem>; })}</DropdownMenuContent></DropdownMenu>
            <Button disabled={!c.canGenerate} onClick={() => void c.generate()} data-testid="button-regenerate"><Sparkles className="h-4 w-4" />{version ? "Regenerate" : "Generate"}</Button>
          </div>
          {c.preferencesError && <div role="alert" className="mt-2 text-xs text-destructive">Could not load publishing preferences. <Button variant="outline" size="sm" onClick={c.retryPreferences}>Retry</Button></div>}
          {c.preferencesReady && !c.platforms.length && <output className="mt-2 block text-xs text-destructive">No enabled platforms are available. Update your publishing preferences in Settings.</output>}
        </div>
        <main className="min-w-0 space-y-5">
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
          {c.item && <div className="rounded-md border p-3 text-sm"><p className="font-medium">{c.item.headline}</p><p className="text-muted-foreground">{c.item.source}</p><p className="mt-2 whitespace-pre-wrap">{c.item.summary ?? "Excerpt unavailable."}</p><p className="mt-2 text-xs text-muted-foreground">Inbox excerpt only, not independently verified — the full source is fetched after you click Generate.</p></div>}
        </section>}
        {c.mode === "manual" ? <RichArticleEditor value={c.manual} onChange={c.setManual} isPending={c.busy} onUploadingChange={c.setUploading} /> :
          <label className="block space-y-1 text-sm">Article URL<Input aria-label="Article URL" type="url" value={c.url} disabled={c.busy} onChange={event => c.setUrl(event.target.value)} placeholder="https://…" data-testid="input-instant-review-url" /></label>}
        <EditorialProgress {...c.generation} />
        {c.generation.error && !c.generation.pending && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <Button variant="outline" disabled={c.saving} onClick={() => void c.generate(true)}>Retry same request</Button>
          {c.generation.recoverable && <Button variant="outline" onClick={() => void c.generation.cancel()}>Cancel generation</Button>}
        </div>}
        {c.notice && <output className="block text-sm">{c.notice}</output>}
        {version ? <section className="min-w-0 space-y-4 border-t pt-5" aria-label="Draft review">
          <div><p className="text-sm font-semibold">Review your post</p><p className="mt-1 text-sm text-muted-foreground">Choose a destination to see its adapted version. Edit each version independently.</p></div>
          <div className="flex flex-wrap gap-2">{c.platforms.map(destination => { const Icon = destination.icon; return <Button key={destination.value} type="button" size="sm" variant={c.platform === destination.value ? "secondary" : "outline"} onClick={() => c.setPlatform(destination.value)}><Icon className="mr-1.5 h-4 w-4" />{destination.label}</Button>; })}</div>
          <div className="space-y-2 text-sm">
            <h3 className="font-medium">Source: {article?.title}</h3>
            <p className="text-muted-foreground">{article?.source} · Generated format: {version.review.format}</p>
            {originalUrl && <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 underline">Open original<ExternalLink className="h-4 w-4" /></a>}
            <details><summary className="cursor-pointer font-medium">{article?.domain === "manual" ? "Your supplied article content" : "Fetched article content"}</summary><p className="max-h-64 overflow-auto whitespace-pre-wrap break-words" data-testid="text-source-content">{article?.content}</p></details>
            {!!article?.media?.length && <p>{article.media.length} attachment(s) included. Media is not inspected as evidence.</p>}
          </div>
          <EditorialDetails evidence={version.review.evidence} detail={version.review.details?.[version.platform]?.[version.tone]} edited={isEdited(version)} currentContent={version.content} />
          <label className="block space-y-2 text-sm">Post content {isEdited(version) && <span className="font-medium">· Edited</span>}
            <Textarea aria-label="Post content" value={version.content} disabled={c.busy} onChange={event => c.edit(event.target.value)} className="min-h-60 resize-y" data-testid="textarea-post-content" />
          </label>
          <p className="text-xs text-muted-foreground">{version.content.length} / {Math.min(5000, meta.charLimit)} characters. Hashtags may be edited directly in the text.</p>
          {isEdited(version) && !c.busy && <ApproveVoiceEdit key={`${version.platform}:${version.tone}`} content={version.content} />}
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
        </section> : <p className="text-sm text-muted-foreground">Your generated content will appear here for review.</p>}
        </main>
        </div>
      </div>
  </div>;
}
