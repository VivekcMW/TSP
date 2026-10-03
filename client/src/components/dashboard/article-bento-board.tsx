import { useId } from "react";
import { ChevronDown, Link2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, fieldControlClassName } from "@/components/ui/field";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { supportsArticle } from "@shared/editorial";
import { SocialPreviewCard } from "./social-preview-card";
import { EditorialProgress } from "./editorial-details";
import { WorkflowStatus } from "./workflow-status";
import { publicSourceUrl, versionCounts } from "./create-post-state";
import type { CreatePostComposer } from "./use-create-post-composer";

const MAX_PLATFORMS = 4;

export function ArticleBentoBoard({ composer: c }: Readonly<{ composer: CreatePostComposer }>) {
  const id = useId();
  const sourceHelpId = `${id}-story-help`;
  const platformSummaryId = `${id}-platform-summary`;
  const platformLimitId = `${id}-platform-limit`;
  const selected = c.selectedPlatforms;
  const selectedPlatforms = c.platforms.filter(platform => selected.includes(platform.value));
  const sourceLocked = c.busy || c.generation.recoverable;
  const counts = versionCounts(c.versions);
  const cardState = (platform: string) => {
    const state = c.generationState(platform, c.tone);
    if (state === "not-attempted" && c.batching && c.batchInputMatches) return "queued" as const;
    if (state) return state;
    if (c.hasVersion(platform, c.tone)) return "ready" as const;
    return "idle" as const;
  };
  const unattempted = c.batchRecovery?.unattempted.length ?? 0;
  const sourceGuidance = "Enter a valid public HTTP(S) article URL or choose a story.";
  let generateLabel = `Generate ${selected.length} ${selected.length === 1 ? "post" : "posts"}`;
  if (c.hasBatchRecovery) generateLabel = unattempted ? `Continue ${unattempted} not attempted` : "No unattempted posts";
  if (c.batching) generateLabel = "Generating…";
  return <div className="space-y-5 [&_button]:transition-colors [&_button]:duration-150 [&_select]:transition-colors [&_select]:duration-150 motion-reduce:[&_button]:transition-none motion-reduce:[&_select]:transition-none">
    <div className="min-w-0 border-b bg-card py-2">
      <div className="flex min-w-0 flex-wrap items-end gap-3 rounded-[6px] border bg-card p-2">
        <SegmentedControl aria-label="Create from">
          <span className="px-2 text-sm font-medium">Create from</span>
          <SegmentedControlItem selected={c.mode === "manual"} disabled={sourceLocked} onClick={() => c.setMode("manual")}><Sparkles />Idea</SegmentedControlItem>
          <SegmentedControlItem selected={c.mode === "article"} disabled={sourceLocked} onClick={() => c.setMode("article")}><Link2 />Article</SegmentedControlItem>
        </SegmentedControl>
        {/* A zero flex basis fits these fields beside Create from even when the
          remaining width is less than a select's padding. Wrap before shrinking. */}
        <Field label="Tone" className="basis-48 grow sm:ml-auto sm:basis-auto sm:grow-0" render={controlProps =>
          <select {...controlProps} className={fieldControlClassName} value={c.tone} disabled={sourceLocked} onChange={event => c.setTone(event.target.value as typeof c.tone)}>{c.toneOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select>} />
        <Field label="Format" className="basis-48 grow sm:basis-auto sm:grow-0" render={controlProps =>
          <select {...controlProps} className={fieldControlClassName} value={c.requestedFormat} disabled={sourceLocked} onChange={event => c.setFormat(event.target.value as typeof c.requestedFormat)}><option value="short-post">Short post</option><option value="article">Article where supported</option></select>} />
        {c.batching && <Button type="button" variant="outline" disabled={c.batchStopRequested} onClick={c.stopBatchAfterCurrent}>{c.batchStopRequested ? "Stopping after this post…" : "Stop after current post"}</Button>}
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
          <Button disabled={c.hasBatchRecovery ? !c.canContinueBatch : !c.canGenerateBatch} onClick={() => void (c.hasBatchRecovery ? c.continueBatch() : c.generateBatch(selected))} data-testid="button-generate-selected"><Sparkles className="h-4 w-4" />{generateLabel}</Button>
          <InfoTooltip label="Generate posts">{c.generationDisabledReason || sourceGuidance}</InfoTooltip>
        </div>
      </div>
      {c.generationDisabledReason && c.generationDisabledReason !== sourceGuidance && <p className="mt-2 text-sm text-muted-foreground">{c.generationDisabledReason}</p>}
      {!selected.length && c.preferencesReady && <p className="mt-2 text-sm text-muted-foreground">Choose at least one platform; up to four can be selected.</p>}
      {c.saving && <p className="mt-2 text-sm text-muted-foreground">Saving a version locks that version and the source controls. Other completed cards remain available.</p>}
      {c.hasBatchRecovery && !c.batching && <output className="mt-2 block text-xs text-muted-foreground">
        {c.batch.completed.length} completed; {unattempted} not attempted. Completed cards will not be regenerated. Failed cards require a separate new attempt on that card.
        {unattempted > 0 && " Continue starts new generation only for unattempted cards and may count toward usage."}
        {!c.batchInputMatches && ` Restore the original ${c.toneOptions.find(option => option.key === c.batchRecovery?.tone)?.label} tone and ${c.batchRecovery?.format} format to continue this batch.`}
      </output>}
      {c.preferencesError && <WorkflowStatus tone="error" actions={<Button variant="outline" onClick={c.retryPreferences}>Retry</Button>}>Could not load publishing preferences.</WorkflowStatus>}
      {c.preferencesReady && !c.platforms.length && <WorkflowStatus tone="warning">No enabled platforms are available. Update your publishing preferences in Settings.</WorkflowStatus>}
    </div>
    <EditorialProgress {...c.generation} batch={c.batching ? c.batch : undefined} />
    {c.generation.error && !c.generation.pending && c.generation.recoverable && <WorkflowStatus tone="warning" live={false} actions={<>
      <Button variant="outline" disabled={c.busy} onClick={() => void c.generate(true)}>Retry same request</Button>
      <Button variant="outline" disabled={c.busy} onClick={() => void c.generation.cancel()}>Cancel generation</Button>
    </>}>Check the original uncertain request; this does not start a new generation or create a new usage intent. Resolve it before continuing. Completed cards are retained.</WorkflowStatus>}

    <section aria-label="Choose a story" aria-busy={c.inboxLoading} className="min-w-0 space-y-3">
      {c.inboxLoading && <output className="block text-sm text-muted-foreground">Loading stories… You can still paste an article URL.</output>}
      {c.inboxError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">Could not load stories. Paste a URL or retry.<Button type="button" variant="outline" disabled={c.busy} onClick={() => void c.retryInbox()}>Retry stories</Button></div>}
      {!c.inboxLoading && !c.inboxError && !c.inbox.length && !c.item && <p className="text-sm text-muted-foreground">No saved stories available. Paste an article URL.</p>}
      <div className="grid items-start gap-4 md:grid-cols-2" data-testid="article-source-row">
        <Field id={`${id}-story`} label="Story" help="Choose a saved story or paste an article URL. Only one source is needed." render={controlProps => <select {...controlProps} className={fieldControlClassName} disabled={sourceLocked} value={c.item?.id ?? ""} onChange={event => { if (!event.target.value) { c.selectPasteUrl(); return; } const item = c.inbox.find(value => value.id === event.target.value); if (item) c.prefill(item); }}><option value="">Paste an article URL</option>{c.item && !c.inbox.some(value => value.id === c.item!.id) && <option value={c.item.id}>{c.item.headline}</option>}{c.inbox.map(item => <option key={item.id} value={item.id}>{item.headline}</option>)}</select>} />
        <Field label="Article URL" controlProps={{ "aria-describedby": sourceHelpId }} help="Use the original public article URL. Changing a source replaces this creation only after your confirmation."
          error={c.url.trim() && !publicSourceUrl(c.url.trim()) ? "Enter a valid HTTP(S) URL without embedded credentials." : undefined}
          render={controlProps => <Input {...controlProps} type="url" value={c.url} disabled={sourceLocked} onChange={event => c.setUrl(event.target.value)} placeholder="https://…" data-testid="input-instant-review-url" />} />
      </div>
      {c.item && <div data-testid="selected-story-preview" className="min-w-0 break-words rounded-[6px] border bg-muted/20 p-3 text-sm"><p className="font-medium">{c.item.headline}</p><p className="text-xs text-muted-foreground">{c.item.source}</p><p className="mt-2 line-clamp-2">{c.item.summary ?? "Excerpt unavailable."}</p></div>}
    </section>

    <section className="space-y-3" aria-labelledby="platform-posts-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <h2 id="platform-posts-heading" className="min-w-0 text-base font-semibold">Your platform posts</h2>
          <InfoTooltip label="Your platform posts">Choose up to four. Posts generate one at a time and remain visible as you review. Selection stays with this creation when you visit another page.</InfoTooltip>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" disabled={sourceLocked || !c.preferencesReady || !c.platforms.length} aria-describedby={platformSummaryId} data-testid="button-platforms">
              Platforms · {selected.length}/{MAX_PLATFORMS} selected <ChevronDown aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" aria-label="Choose platforms" className="max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain p-2 motion-reduce:!animate-none">
            <fieldset aria-describedby={platformLimitId} className="min-w-0 space-y-1">
              <legend className="sr-only">Platforms to generate</legend>
              {c.platforms.map(platform => {
                const Icon = platform.icon;
                const active = selected.includes(platform.value);
                return <label key={platform.value} className={`control-touch-target flex min-h-9 min-w-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${active ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
                  <input type="checkbox" checked={active} disabled={sourceLocked || (!active && selected.length >= MAX_PLATFORMS)}
                    onChange={() => { c.toggleSelectedPlatform(platform.value); c.setPlatform(platform.value); }}
                    className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{platform.label}</span>
                </label>;
              })}
            </fieldset>
            <output id={platformLimitId} className="mt-2 block px-2 text-xs text-muted-foreground">{selected.length === MAX_PLATFORMS ? "Four selected. Deselect a platform to choose another." : `Choose up to four platforms. ${selected.length} selected.`}</output>
          </PopoverContent>
        </Popover>
      </div>
      <p id={platformSummaryId} aria-live="polite" aria-atomic="true" className="break-words text-sm text-muted-foreground">{selectedPlatforms.length ? selectedPlatforms.map(platform => platform.label).join(" · ") : "No platforms selected. Choose at least one to generate."}</p>
      {counts.total > 0 && <WorkflowStatus live={false} title="Draft storage" tone="neutral">{counts.saved} saved · {counts.unsaved} unsaved or unconfirmed across all platform/tone versions. Saving does not schedule or publish.</WorkflowStatus>}
      {c.requestedFormat === "article" && selectedPlatforms.some(platform => !supportsArticle(platform.value)) && <p className="text-xs text-muted-foreground">Platforms without article support will receive a short post.</p>}
      <div className="grid items-start gap-4 lg:grid-cols-2">{selectedPlatforms.map(platform => <SocialPreviewCard key={`${platform.value}:${c.tone}`} composer={c} platform={platform.value} state={cardState(platform.value)} />)}</div>
    </section>
    {c.notice && <WorkflowStatus tone="info">{c.notice}</WorkflowStatus>}
    {c.copyStatus && <WorkflowStatus>{c.copyStatus}</WorkflowStatus>}
  </div>;
}