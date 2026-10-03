import { useState } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { Copy, Pencil, RefreshCw, Save, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { PlatformComposeAction } from "@/components/platform-compose-action";
import { cn } from "@/lib/utils";
import { getPlatformMeta } from "@/lib/platforms";
import { EASE } from "@/lib/motion";
import { MAX_DRAFT_CHARACTERS, platformTextValidation } from "@shared/editorial";
import { ApproveVoiceEdit } from "./approve-voice-edit";
import { EditorialDetails, SourceReview } from "./editorial-details";
import { HashtagSuggestions } from "./hashtag-suggestions";
import { isEdited, isSaved, saveLabel, versionKey, type PostVersion } from "./create-post-state";
import { WorkflowStatus } from "./workflow-status";
import type { CreatePostComposer } from "./use-create-post-composer";
import { draftSaveBlocked, type DraftEditingState } from "@shared/draft-revision";

/** Shared presentation for the two editors; all choices are explicit and local. */
export function DraftRevisionNotice({ state, disabled, onRefresh, onResolve }: Readonly<{
  state: DraftEditingState; disabled: boolean; onRefresh: () => void;
  onResolve: (choice: "load" | "keep" | "adopt") => void;
}>) {
  if (state.status === "checking") return <output className="block text-sm">Checking latest draft… Your text is retained.</output>;
  if (state.status === "immutable") return <p role="alert" className="text-sm text-destructive">This draft is read-only. {state.error}</p>;
  if (!["conflict", "refresh-failed"].includes(state.status)) return null;
  return <section aria-label="Draft revision review" className="min-w-0 space-y-3 rounded-md border p-3 text-sm">
    <p role="alert">{state.status === "conflict" ? "Draft changed elsewhere. Nothing was overwritten. Review both versions before saving." : "Could not check latest draft. Saved status is unconfirmed."} {state.error}</p>
    {state.status === "conflict" && state.latestRevision && <>
      <div><p className="font-medium">Acknowledged baseline</p><p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{state.savedContent}</p></div>
      <div><p className="font-medium">Latest saved text · {state.latestRevision.updatedAt ?? "legacy revision"}</p><p className="max-h-48 overflow-auto whitespace-pre-wrap break-words" data-testid="latest-draft-content">{state.latestRevision.content}</p></div>
      <p>Your local working text remains in the editor. Using the reviewed latest as baseline keeps that text; Save changes is still a separate action.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onResolve("load")}>Load latest</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onResolve("keep")}>Keep local text</Button>
        <Button type="button" size="sm" variant="outline" className="h-auto whitespace-normal" disabled={disabled} onClick={() => onResolve("adopt")}>Use reviewed latest as baseline</Button>
      </div>
    </>}
    {state.keptLocal && <output className="block">Local text kept. Nothing was saved; the conflict still needs review.</output>}
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onRefresh}>Check latest draft</Button>
  </section>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "YP";
}

function identityLine(platform: string, handle: string, industry?: string | null) {
  if (platform === "linkedin") return `${industry || "Professional profile"} · LinkedIn preview`;
  if (platform === "facebook") return "Profile preview · Public post";
  if (platform === "slack" || platform === "discord") return `${handle} · Channel preview`;
  return `@${handle}`;
}

type CardState = "idle" | "queued" | "generating" | "ready" | "failed" | "uncertain" | "not-attempted";

function cardStatus(state: CardState, version: PostVersion | undefined, saved: boolean) {
  if (state === "generating") return "Generating…";
  if (state === "queued") return "Queued";
  if (state === "uncertain") return "Check request";
  if (state === "not-attempted") return "Not attempted";
  if (state === "failed") return "Needs retry";
  if (!version) return "Ready to generate";
  if (version.status === "conflict") return "Draft conflict";
  if (version.status === "refresh-failed") return "Check failed";
  if (version.status === "checking") return "Checking…";
  if (version.status === "immutable") return "Read-only";
  if (version.status === "failed") return "Save failed";
  if (version.status === "saving") return "Saving…";
  return saved ? "Saved" : "Generated · not saved";
}

function cardStatusClass(state: CardState) {
  if (state === "failed") return "bg-destructive-subtle text-destructive";
  if (state === "uncertain") return "bg-warning-subtle text-warning";
  if (state === "generating") return "bg-info-subtle text-info";
  return "bg-muted text-muted-foreground";
}

function EmptyPreview({ state, label }: Readonly<{ state: CardState; label: string }>) {
  if (state === "generating") {
    return <output className="block space-y-3 py-6">
      <span className="block h-3 w-11/12 motion-safe:animate-pulse rounded bg-muted" />
      <span className="block h-3 w-9/12 motion-safe:animate-pulse rounded bg-muted" />
      <span className="block h-3 w-10/12 motion-safe:animate-pulse rounded bg-muted" />
      <span className="block text-xs text-muted-foreground">Writing your {label} post…</span>
    </output>;
  }
  if (state === "queued") {
    return <div className="py-8 text-center text-sm text-muted-foreground">Waiting for the previous platform…</div>;
  }
  if (state === "not-attempted") {
    return <p className="py-8 text-center text-sm text-muted-foreground">No request was sent for this card. Continue the batch or generate this card explicitly.</p>;
  }
  if (state === "uncertain") {
    return <p className="py-8 text-sm text-muted-foreground">The original request may still be running. Check it above before starting any new generation.</p>;
  }
  if (state === "failed") {
    return <div className="rounded-[6px] bg-destructive-subtle p-4 text-sm text-destructive">
      This attempt did not complete. Check the error above. Other completed cards are retained.
    </div>;
  }
  return <div className="py-8 text-center">
    <Sparkles className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
    <p className="text-sm text-muted-foreground">Select Generate to create this post.</p>
  </div>;
}

function GeneratedPreview({ composer: c, platform, version }: Readonly<{ composer: CreatePostComposer; platform: string; version: PostVersion }>) {
  const [editing, setEditing] = useState(false);
  const meta = getPlatformMeta(platform);
  const usable = c.canUseVersion(platform, version.tone);
  const lockReason = c.versionLockReason(platform, version.tone);
  const saved = isSaved(version);
  const validation = platformTextValidation(version.content, platform, meta.charLimit);
  return <>
    <Field label={`${meta.label} post content`} error={validation.error}
      help={`Plain text; hashtags and links are editable.${platform === "twitter" ? " X links count as 23 platform characters." : ""} The application also limits text to ${MAX_DRAFT_CHARACTERS.toLocaleString("en-US")} raw characters (UTF-16), regardless of link weighting.`}
      counter={`${validation.length} / ${meta.charLimit} characters · ${validation.rawLength} / ${MAX_DRAFT_CHARACTERS} raw characters${isEdited(version) ? " · Edited" : ""}`}
      render={controlProps => editing ? <Textarea {...controlProps} value={version.content} disabled={Boolean(lockReason)}
        onChange={event => c.editVersion(platform, version.tone, event.target.value)} className="min-h-64 resize-y" data-testid={`textarea-post-content-${platform}`} />
        : <div {...controlProps} role="textbox" aria-readonly="true" aria-multiline="true" tabIndex={0} className="whitespace-pre-wrap break-words text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`text-post-content-${platform}`}>{version.content}</div>} />
    <SourceReview article={version.review.article} format={version.review.format} headingLevel={4} />
    <HashtagSuggestions content={version.content} platform={platform} disabled={Boolean(lockReason)} onAppend={tag => c.editVersion(platform, version.tone, `${version.content}${/\s$/.test(version.content) ? "" : " "}${tag}`)} />
    <EditorialDetails evidence={version.review.evidence} detail={version.review.details?.[platform]?.[version.tone]} edited={isEdited(version)} currentContent={version.content} />
    {lockReason && <WorkflowStatus tone="info" live={false}>{lockReason}</WorkflowStatus>}
    {version.status === "failed" && <WorkflowStatus tone="error">Could not save draft. {version.error}</WorkflowStatus>}
    <DraftRevisionNotice state={version} disabled={Boolean(lockReason)}
      onRefresh={() => void c.refreshVersion(platform, version.tone)} onResolve={choice => c.resolveVersion(platform, version.tone, choice)} />
    <div className="flex flex-wrap gap-2" onClickCapture={event => {
      // A queued reservation may have been acquired this turn, before the
      // handoff child unmounts. Fence its click without changing that owner.
      if (c.versionLockReason(platform, version.tone)) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <Button type="button" size="sm" variant="outline" disabled={Boolean(lockReason)} onClick={() => setEditing(value => !value)}>
        <Pencil className="h-3.5 w-3.5" />{editing ? "Preview" : "Edit"}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={!usable} onClick={() => void c.copyVersion(platform, c.tone)}>
        <Copy className="h-3.5 w-3.5" />Copy
      </Button>
      <Button type="button" size="sm" disabled={!usable || saved || draftSaveBlocked(version)} onClick={() => void c.saveVersion(platform, c.tone)}>
        <Save className="h-3.5 w-3.5" />{saveLabel(version)}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={!c.canGeneratePlatform(platform)} onClick={() => void c.generatePlatform(platform)}>
        <RefreshCw className="h-3.5 w-3.5" />{c.generationState(platform, c.tone) === "failed" ? `Generate ${meta.label} again` : "Regenerate"}
      </Button>
      {usable && <PlatformComposeAction key={`${platform}:${c.tone}`} platform={platform} text={version.content} canProceed={() => c.canUseVersion(platform, version.tone, version)} testId={`button-open-${platform}`} />}
    </div>
    {saved && <SavedDraftLinks version={version} />}
    <p className="text-sm text-muted-foreground">Copying or opening a platform is a manual handoff, not delivery confirmation. Nothing is scheduled or published by these actions.</p>
    {isEdited(version) && !lockReason && <ApproveVoiceEdit key={`${platform}:${c.tone}`} content={version.content} />}
  </>;
}

export function SavedDraftLinks({ version, onNavigate }: Readonly<{ version: PostVersion; onNavigate?: () => boolean }>) {
  if (!isSaved(version) || !version.savedId) return null;
  const query = `?draft=${encodeURIComponent(version.savedId)}`;
  return <WorkflowStatus title="Draft saved" tone="success" actions={<>
    <Button variant="outline" asChild><Link href={`/dashboard/content${query}`} onClick={event => { if (onNavigate && !onNavigate()) event.preventDefault(); }}>Go to Content</Link></Button>
    <Button variant="outline" asChild><Link href={`/dashboard/calendar${query}`} onClick={event => { if (onNavigate && !onNavigate()) event.preventDefault(); }}>Go to Calendar</Link></Button>
  </>}>Review publishing readiness in Content or choose a time in Calendar. This draft has not been scheduled or published by saving.</WorkflowStatus>;
}

export function SocialPreviewCard({ composer: c, platform, state }: Readonly<{
  composer: CreatePostComposer;
  platform: string;
  state: CardState;
}>) {
  const reducedMotion = useReducedMotion();
  const meta = getPlatformMeta(platform);
  const Icon = meta.icon;
  const version = c.versions[versionKey(platform, c.tone)];
  const saved = Boolean(version && isSaved(version));
  const status = cardStatus(state, version, saved);
  return <motion.article
    data-testid={`social-preview-${platform}`}
    initial={reducedMotion ? false : { opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: reducedMotion ? 0 : 0.22, ease: EASE }}
    className="min-w-0 overflow-hidden rounded-[6px] border border-border bg-card text-card-foreground shadow-sm transition-shadow duration-200 hover:shadow-md focus-within:shadow-md motion-reduce:transition-none"
  >
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <Avatar className="h-10 w-10">
        {c.identity.imageUrl && <AvatarImage src={c.identity.imageUrl} alt="" />}
        <AvatarFallback className="bg-muted text-xs font-semibold text-foreground">{initials(c.identity.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 basis-24">
        <h3 className="break-words text-sm font-semibold">{meta.label} post</h3>
        <p className="break-words text-sm">{c.identity.name}</p>
        <p className="break-words text-xs text-muted-foreground">{identityLine(platform, c.identity.handle, c.identity.industry)}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn("rounded-full px-2 py-1 text-[11px] font-medium transition-colors duration-150 motion-reduce:transition-none", cardStatusClass(state))}>
          <motion.span key={status} className="inline-block" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}>{status}</motion.span>
        </span>
        <Icon className="h-5 w-5" aria-label={meta.label} />
      </div>
    </header>
    <motion.div
      key={version ? "content" : state}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.18, ease: EASE }}
      className="space-y-4 p-4"
    >
      {version ? <GeneratedPreview composer={c} platform={platform} version={version} /> : <>
        <EmptyPreview state={state} label={meta.label} />
        <Button type="button" size="sm" variant="outline" disabled={!c.canGeneratePlatform(platform)} onClick={() => void c.generatePlatform(platform)}>
          <RefreshCw className="h-3.5 w-3.5" />Generate {meta.label}{state === "failed" || state === "uncertain" ? " again" : ""}
        </Button>
      </>}
      {(state === "failed" || state === "uncertain") && c.generationError(platform, c.tone) && <WorkflowStatus tone={state === "uncertain" ? "warning" : "error"} live={false} title="Generation needs attention">{c.generationError(platform, c.tone)}</WorkflowStatus>}
      {state === "not-attempted" && !c.canGeneratePlatform(platform) && c.canGenerate && (
        <p className="text-xs text-muted-foreground">Restore the original tone and format to generate this unattempted card.</p>
      )}
      {state === "failed" && !c.generation.recoverable && <p className="text-xs text-muted-foreground">This starts a new attempt for {meta.label} only and may count toward usage. Previous usable text is retained if it fails.{!c.canGeneratePlatform(platform) && c.canGenerate && " Restore the original tone and format before trying this card again."}</p>}
    </motion.div>
  </motion.article>;
}