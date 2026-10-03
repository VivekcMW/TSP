import { useRef } from "react";
import { Link2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldControlClassName } from "@/components/ui/field";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { PlatformComposeAction } from "@/components/platform-compose-action";
import { getPlatformMeta } from "@/lib/platforms";
import { EditorialDetails, EditorialProgress, SourceReview } from "./editorial-details";
import { HashtagSuggestions } from "./hashtag-suggestions";
import { RichArticleEditor } from "./rich-article-editor";
import { isEdited, isSaved, saveLabel } from "./create-post-state";
import { MAX_DRAFT_CHARACTERS, platformTextValidation, supportsArticle } from "@shared/editorial";
import type { CreatePostComposer } from "./use-create-post-composer";
import { ApproveVoiceEdit } from "./approve-voice-edit";
import { ArticleBentoBoard } from "./article-bento-board";
import { DraftRevisionNotice, SavedDraftLinks } from "./social-preview-card";
import { draftSaveBlocked } from "@shared/draft-revision";
import { PageBody, PageHeader } from "./page-header";
import { WorkflowStatus } from "./workflow-status";

interface InstantReviewPanelProps {
  isOpen: boolean;
  onClose: () => boolean;
  composer: CreatePostComposer;
}

function stickyActionHeight(element: HTMLElement | null) {
  return element && getComputedStyle(element).position === "sticky" ? element.offsetHeight : 0;
}

/** Presentation only: the provider owns the single persistent creation session. */
export function InstantReviewPanel({ onClose, composer: c }: Readonly<InstantReviewPanelProps>) {
  const ideaActionsRef = useRef<HTMLDivElement>(null);
  const version = c.version;
  const meta = getPlatformMeta(c.platform);
  const toneLabel = c.toneOptions.find(value => value.key === c.tone)?.label ?? c.tone;
  const saved = Boolean(version && isSaved(version));
  const sourceLocked = c.busy || c.generation.recoverable;
  const versionLock = version && c.versionLockReason(version.platform, version.tone);
  const validation = platformTextValidation(version?.content ?? "", c.platform, meta.charLimit);
  return <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <PageHeader width="workbench" sticky={false} title="Create post"
        help="Bring an idea or source. Generate, review, then save a draft or copy it to a platform." />
      <PageBody as="div" width="workbench" className="pt-0 sm:pt-0"
        onFocusCapture={event => {
          const viewport = event.currentTarget;
          const editor = event.target;
          if (!editor.isContentEditable || editor.getAttribute("role") !== "textbox") return;
          // Native contenteditable focus reveals the caret, not the whole box.
          // After that scroll settles, reveal its ring in this viewport only;
          // account for the sticky actions' actual (possibly wrapped) height.
          requestAnimationFrame(() => {
            if (document.activeElement !== editor || !viewport.contains(editor)) return;
            const bounds = viewport.getBoundingClientRect();
            const box = editor.getBoundingClientRect();
            const top = bounds.top + viewport.clientTop + stickyActionHeight(ideaActionsRef.current) + 8;
            const bottom = bounds.top + viewport.clientTop + viewport.clientHeight - 8;
            // A taller editor must retain native caret scrolling instead.
            if (box.height > bottom - top) return;
            if (box.top < top) viewport.scrollTop -= top - box.top;
            else if (box.bottom > bottom) viewport.scrollTop += box.bottom - bottom;
          });
        }}>
        {c.mode === "article" ? <ArticleBentoBoard composer={c} /> : <>
        <div ref={ideaActionsRef} className="relative z-10 mb-5 min-w-0 border-b bg-card py-2 lg:sticky lg:top-0">
          <div className="flex min-w-0 flex-wrap items-end justify-end gap-3 rounded-[6px] border bg-card p-2">
            <SegmentedControl aria-label="Create from" className="mr-auto"><span className="px-2 text-sm font-medium">Create from</span><SegmentedControlItem selected={c.mode === "manual"} disabled={sourceLocked} onClick={() => c.setMode("manual")}><Sparkles />Idea</SegmentedControlItem><SegmentedControlItem selected={c.mode !== "manual"} disabled={sourceLocked} onClick={() => c.setMode("article")}><Link2 />Article</SegmentedControlItem></SegmentedControl>
            <Field label="Format" render={controlProps => <select {...controlProps} className={fieldControlClassName} value={c.format} disabled={sourceLocked} onChange={event => c.setFormat(event.target.value as typeof c.format)}><option value="short-post">Short post</option><option value="article" disabled={!supportsArticle(c.platform)}>Article</option></select>} />
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
              <Button disabled={!c.canGenerate} onClick={() => void c.generate()} data-testid="button-regenerate"><Sparkles className="h-4 w-4" />{version ? `Regenerate ${meta.label}` : `Generate for ${meta.label}`}</Button>
              <InfoTooltip label="Generate post">{c.generationDisabledReason || "Add a title and 20–20,000 characters of source text."}</InfoTooltip>
            </div>
          </div>
          {c.generationDisabledReason && c.generationDisabledReason !== "Add a title and 20–20,000 characters of source text." && <p className="mt-2 text-sm text-muted-foreground">{c.generationDisabledReason}</p>}
          {c.saving && <p className="mt-2 text-sm text-muted-foreground">Saving this version. Wait for acknowledgement before changing source controls.</p>}
          {c.preferencesError && <WorkflowStatus tone="error" actions={<Button variant="outline" onClick={c.retryPreferences}>Retry</Button>}>Could not load publishing preferences.</WorkflowStatus>}
          {c.preferencesReady && !c.platforms.length && <WorkflowStatus tone="warning">No enabled platforms are available. Update your publishing preferences in Settings.</WorkflowStatus>}
        </div>
        <div className="min-w-0 space-y-5">
        <RichArticleEditor value={c.manual} onChange={c.setManual} isPending={c.busy || c.generation.recoverable} onUploadingChange={c.setUploading} />
        {c.platforms.length > 0 && <div className="space-y-3">
          <div className="space-y-1.5"><p className="text-xs font-medium text-muted-foreground">Platform · one at a time</p>
            <SegmentedControl aria-label="Platform" className="flex gap-2">{c.platforms.map(destination => { const Icon = destination.icon; const current = c.platform === destination.value; return <SegmentedControlItem key={destination.value} selected={current} disabled={sourceLocked} onClick={() => c.setPlatform(destination.value)}><Icon />{destination.label}{c.hasVersion(destination.value) && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />}</SegmentedControlItem>; })}</SegmentedControl></div>
          <div className="space-y-1.5"><p className="text-xs font-medium text-muted-foreground">Tone</p>
            <SegmentedControl aria-label="Tone" className="flex gap-2">{c.toneOptions.map(option => { const current = c.tone === option.key; return <SegmentedControlItem key={option.key} selected={current} disabled={sourceLocked} onClick={() => c.setTone(option.key)}>{option.label}{c.hasVersion(c.platform, option.key) && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />}</SegmentedControlItem>; })}</SegmentedControl></div>
        </div>}
        <EditorialProgress {...c.generation} />
        {c.generation.error && !c.generation.pending && c.generation.recoverable && <div className="flex flex-wrap items-center gap-2 rounded-[6px] border bg-warning-subtle p-3 text-sm text-warning">
          <Button variant="outline" disabled={c.saving} onClick={() => void c.generate(true)}>Retry same request</Button>
          <Button variant="outline" onClick={() => void c.generation.cancel()}>Cancel generation</Button>
        </div>}
        {c.notice && <WorkflowStatus tone="info">{c.notice}</WorkflowStatus>}
        {version ? <section className="min-w-0 space-y-4 border-t pt-5" aria-label="Draft review">
          <div className="flex min-w-0 items-center gap-1"><h2 className="text-base font-semibold">Review your {meta.label} post</h2><InfoTooltip label={`Review your ${meta.label} post`}>Each platform and tone is its own version. Edit and save each one separately.</InfoTooltip></div>
          <SourceReview article={version.review.article} format={version.review.format} />
          <EditorialDetails evidence={version.review.evidence} detail={version.review.details?.[version.platform]?.[version.tone]} edited={isEdited(version)} currentContent={version.content} />
          <Field label="Post content" error={validation.error}
            help={`Hashtags may be edited directly in the text.${version.platform === "twitter" ? " X counts each link as 23 platform characters." : ""} The application also limits text to 5,000 raw characters (UTF-16), regardless of link weighting.`}
            counter={`${validation.length} / ${meta.charLimit} characters · ${validation.rawLength} / ${MAX_DRAFT_CHARACTERS} raw characters${isEdited(version) ? " · Edited" : ""}`}
            render={controlProps => <Textarea {...controlProps} value={version.content} disabled={Boolean(versionLock)} onChange={event => c.edit(event.target.value)} className="min-h-60 resize-y" data-testid="textarea-post-content" />} />
          <HashtagSuggestions content={version.content} platform={c.platform} disabled={Boolean(versionLock)} onAppend={tag => c.edit(`${version.content}${/\s$/.test(version.content) ? "" : " "}${tag}`)} />
          {versionLock && <WorkflowStatus tone="info" live={false}>{versionLock}</WorkflowStatus>}
          {version.status === "failed" && <WorkflowStatus tone="error">Could not save draft. {version.error}</WorkflowStatus>}
          <DraftRevisionNotice state={version} disabled={Boolean(versionLock)} onRefresh={() => void c.refreshVersion(version.platform, version.tone)}
            onResolve={choice => c.resolveVersion(version.platform, version.tone, choice)} />
          <div className="flex flex-wrap gap-2" onClickCapture={event => {
            if (c.versionLockReason(version.platform, version.tone)) { event.preventDefault(); event.stopPropagation(); }
          }}>
            <Button disabled={!c.canUse || saved || draftSaveBlocked(version)} onClick={() => void c.save()} data-testid="button-save-draft">{saveLabel(version)}</Button>
            <Button variant="outline" disabled={!c.canUse} onClick={() => void c.copy()} data-testid="button-copy-content">Copy text</Button>
            {c.canUse && <PlatformComposeAction key={`${c.platform}:${c.tone}`} platform={c.platform} text={version.content} canProceed={() => c.canUseVersion(version.platform, version.tone, version)} testId="button-post-now" />}
          </div>
          {c.copyStatus && <WorkflowStatus>{c.copyStatus}</WorkflowStatus>}
          <SavedDraftLinks version={version} onNavigate={onClose} />
          <p className="text-sm text-muted-foreground">Copying or opening a platform is a manual handoff, not delivery confirmation. Saving does not schedule or publish.</p>
          {isEdited(version) && !versionLock && <ApproveVoiceEdit key={`${version.platform}:${version.tone}`} content={version.content} />}
        </section> : <p className="text-sm text-muted-foreground">{Object.keys(c.versions).length
          ? `No ${meta.label} post in the ${toneLabel} tone yet. Choose Generate for ${meta.label} when you're ready.`
          : "Your generated content will appear here for review."}</p>}
        </div>
        </>}
        <div className="mt-5"><WorkflowStatus live={false} title="Creation stays in memory">
          Route navigation keeps your inputs, selected platforms, tone and versions in this session. Save each draft to retain it. Reload or sign-out loses unsaved text and selection.
          Only an acknowledged unfinished job pointer can reconnect in this tab while its server result is retained; delivered cards and inputs are not restored. No draft text is stored in browser storage.
        </WorkflowStatus></div>
      </PageBody>
  </main>;
}
