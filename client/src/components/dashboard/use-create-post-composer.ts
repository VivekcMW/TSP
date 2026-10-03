import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { InboxItem, UserProfile } from "@shared/schema";
import { supportsArticle, type EditorialFormat } from "@shared/editorial";
import { accountCache, ApiError, apiRequest } from "@/lib/queryClient";
import { acknowledgeDraftSave, adoptDraftRevision, draftSaveBlocked, editDraftText, observeDraftRevision, parseDraftEditingSnapshot } from "@shared/draft-revision";
import { useAuth } from "@/lib/auth";
import { getPlatformMeta, PLATFORMS } from "@/lib/platforms";
import { usablePost, type ReviewResponse } from "@/lib/editorial";
import { isUsableInboxArticle } from "@/lib/inbox-quality";
import { useEditorialGeneration } from "@/hooks/use-editorial-generation";
import { applyReview, CREATE_TONES, emptyArticle, isEdited, isUnsaved, publicSourceUrl, versionKey, type CreateTone, type ManualArticle, type PostVersion, type PostVersions } from "./create-post-state";

type ComposerSource = { mode: "article" | "manual"; url: string; item?: InboxItem; manual: ManualArticle };
type GenerationInput = { source: ComposerSource; tone: CreateTone; format: EditorialFormat };
type GenerationSnapshot = GenerationInput & { platform: string; inboxItemId?: string };
type GenerationState = "generating" | "ready" | "failed" | "uncertain" | "not-attempted";
type Batch = { targets: string[]; completed: string[]; current?: string; failed?: string };
type BatchRecovery = GenerationInput & { unattempted: string[] };
const emptySource = (mode: ComposerSource["mode"]): ComposerSource => ({ mode, url: "", manual: emptyArticle() });
const hasSourceInput = (source: ComposerSource) => Boolean(source.url.trim() || source.manual.title.trim() || source.manual.content.trim() || source.manual.media.length);
const sameInput = (a: GenerationInput, b: GenerationInput) => a.source === b.source && a.tone === b.tone && a.format === b.format;

// Validate the fields rendered or saved with a card before replacing its prior
// revision. Optional legacy metadata stays optional; malformed metadata does not.
const reviewMetadataSchema = z.object({
  article: z.object({
    title: z.string(), content: z.string(), source: z.string(), url: z.string(), domain: z.string(),
    media: z.array(z.object({ id: z.string().optional(), type: z.enum(["image", "video", "audio"]), name: z.string(), url: z.string() })).optional(),
  }),
  format: z.enum(["short-post", "article"]).optional(),
  evidence: z.object({
    sourceId: z.string(),
    warnings: z.array(z.object({ code: z.string(), message: z.string() })),
    excerpts: z.array(z.object({ id: z.string(), text: z.string() })),
  }).optional(),
  details: z.record(z.record(z.object({
    content: z.string(),
    attributions: z.array(z.object({ text: z.string(), excerptIds: z.array(z.string()) })).optional(),
    generation: z.object({ provider: z.string(), model: z.string(), fallbackUsed: z.boolean().optional() }).optional(),
    claimSupport: z.object({
      method: z.literal("conservative-source-comparison-v1"), status: z.literal("needs-review"),
      factualVerification: z.literal("not-performed"), requiresHumanReview: z.literal(true), truncated: z.boolean(),
      claims: z.array(z.object({
        text: z.string(), start: z.number(), end: z.number(), status: z.enum(["supported", "unsupported", "contradictory", "unknown"]),
        reason: z.string(), sourceSpans: z.array(z.object({ excerptId: z.string(), text: z.string(), start: z.number(), end: z.number() })),
      })),
    }).optional(),
  }))).optional(),
});

/** Content stays in memory; only the scoped job/intent pointer survives reload. */
export function useCreatePostComposer(isOpen: boolean, onCreateRoute = isOpen) {
  const client = useQueryClient();
  const { user } = useAuth();
  const me = useQuery<{ name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null; profileImageUrl?: string | null; industry?: string | null }>({ queryKey: ["/api/me"], enabled: isOpen });
  const profile = useQuery<UserProfile>({ queryKey: ["/api/profile"], enabled: isOpen });
  const integrations = useQuery<{ key: string; enabled: boolean }[]>({ queryKey: ["/api/integrations"], enabled: isOpen });
  const inbox = useQuery<InboxItem[]>({ queryKey: ["/api/inbox"], enabled: isOpen });
  const [platformChoice, setPlatformChoice] = useState<string>();
  const [platformSelection, setPlatformSelection] = useState<string[]>([]);
  const selectedPlatformsRef = useRef<string[]>([]);
  const selectionInitialized = useRef(false);
  const [toneChoice, setToneChoice] = useState<CreateTone>();
  const [format, setFormatChoice] = useState<EditorialFormat>("short-post");
  const [source, setSource] = useState<ComposerSource>(() => emptySource("article"));
  const sourceRef = useRef(source);
  const { mode, url, item, manual } = source;
  const [versions, setVersions] = useState<PostVersions>({});
  const versionsRef = useRef(versions);
  const lifetime = useRef(new AbortController());
  const scopeKey = JSON.stringify([user?.id, profile.data?.tenantId]);
  const renderScope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const scopeRef = useRef(renderScope);
  scopeRef.current = renderScope;
  const revisionReads = useRef(new Map<string, AbortController>());
  const refreshOnArrival = useRef(false);
  const wasOnCreate = useRef(false);
  useEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => { lifetime.current.abort(); revisionReads.current.forEach(read => read.abort()); revisionReads.current.clear(); };
  }, []);
  const [notice, setNotice] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploadingState] = useState(false);
  const uploadLock = useRef(false);
  const setUploading = useCallback((value: boolean) => {
    uploadLock.current = value;
    setUploadingState(value);
  }, []);
  const [batching, setBatching] = useState(false);
  const [batchStopRequested, setBatchStopRequested] = useState(false);
  const [batch, setBatchState] = useState<Batch>({ targets: [], completed: [] });
  const batchRef = useRef(batch);
  const [batchRecovery, setBatchRecoveryState] = useState<BatchRecovery>();
  const batchRecoveryRef = useRef(batchRecovery);
  const [generationStates, setGenerationStates] = useState<Record<string, GenerationState>>({});
  const [generationErrors, setGenerationErrors] = useState<Record<string, string>>({});
  const generationStatesRef = useRef(generationStates);
  const attempts = useRef<Record<string, GenerationSnapshot>>({});
  const copyRevision = useRef(0);
  const saveLocks = useRef(new Set<string>());
  // Reserve the whole active sequence before its first await, not just the
  // currently generating card. Release each target as its request settles.
  const reservations = useRef(new Set<string>());
  const generationLock = useRef(false);
  const batchLock = useRef(false);
  const batchStop = useRef(false);
  const lastGeneration = useRef<GenerationSnapshot>();
  const generation = useEditorialGeneration<ReviewResponse>({
    scope: user?.id && profile.data?.tenantId ? { userId: user.id, tenantId: profile.data.tenantId } : undefined,
    onRecovered: data => {
      const recoveredPlatform = Object.keys(data?.posts ?? {})[0];
      const recoveredTone = CREATE_TONES.find(value => typeof data?.posts?.[recoveredPlatform]?.[value.key] === "string")?.key;
      if (!PLATFORMS.some(value => value.value === recoveredPlatform) || !recoveredTone) {
        setNotice("The recovered job returned no supported platform. Nothing was regenerated."); return;
      }
      const snapshot = { platform: recoveredPlatform, tone: recoveredTone, source: sourceRef.current, format: data.format };
      lastGeneration.current = snapshot;
      setPlatformChoice(recoveredPlatform); setToneChoice(recoveredTone);
      const succeeded = acceptResult(data, snapshot);
      setGenerationState(snapshot, succeeded ? "ready" : "failed");
    },
  });
  const disabled = new Set((integrations.data ?? []).filter(value => !value.enabled).map(value => value.key));
  const preferencesReady = profile.isSuccess && integrations.isSuccess;
  const platforms = preferencesReady ? PLATFORMS.filter(value => (!profile.data?.enabledPlatforms || profile.data.enabledPlatforms.includes(value.value)) && !disabled.has(value.value)) : [];
  const availableKey = platforms.map(value => value.value).join("|");
  useEffect(() => {
    if (!preferencesReady || selectionInitialized.current) return;
    selectionInitialized.current = true;
    const initial = availableKey ? availableKey.split("|").slice(0, 4) : [];
    selectedPlatformsRef.current = initial;
    setPlatformSelection(initial);
  }, [preferencesReady, availableKey]);
  const selectedPlatforms = platformSelection.filter(value => platforms.some(option => option.value === value));
  const preferred = platformChoice ?? profile.data?.defaultPlatform;
  const platform = platforms.some(value => value.value === preferred) ? preferred! : platforms[0]?.value ?? "";
  const tone = toneChoice ?? CREATE_TONES.find(value => value.value === profile.data?.defaultTone)?.key ?? "thoughtLeader";
  const toneRef = useRef(tone);
  const formatRef = useRef(format);
  toneRef.current = tone;
  formatRef.current = format;
  const effectiveFormat = supportsArticle(platform) ? format : "short-post";
  const key = versionKey(platform, tone);
  const version = versions[key];
  const sourceKey = JSON.stringify([mode, url, item?.id, manual]);
  const [savedSourceKey, setSavedSourceKey] = useState("");
  const hasInput = hasSourceInput(source);
  const inputReady = mode === "manual"
    ? Boolean(manual.title.trim()) && manual.content.trim().length >= 20 && manual.content.length <= 20_000
    : Boolean(publicSourceUrl(url.trim()));
  const dirty = (hasInput && sourceKey !== savedSourceKey) || Object.values(versions).some(isUnsaved);
  const busy = generation.pending || saving || uploading || batching;
  const generationBusy = generation.pending || uploading || batching || generation.recoverable;
  const canGenerate = Boolean(platform) && !generationBusy && !saveLocks.current.has(key) && inputReady;
  const canUse = Boolean(platform && version && usablePost(version.content, Math.min(5000, getPlatformMeta(platform).charLimit), platform)) && !versionLockReason(platform, tone);
  const hasCreation = mode === "manual" || hasInput || Object.keys(versions).length > 0 || busy || generation.recoverable;

  function versionLockReason(platformValue: string, toneValue: CreateTone): string | undefined {
    if (sourceRef.current !== source || scopeRef.current !== renderScope || lifetime.current.signal.aborted) return "This creation has changed. Use the current creation’s controls.";
    const targetKey = versionKey(platformValue, toneValue);
    if (saveLocks.current.has(targetKey)) return "Saving this version. Wait for acknowledgement before changing or using it.";
    if (reservations.current.has(targetKey)) return "This version is reserved for the active batch. Other completed cards remain available.";
    if ((generationLock.current || generation.hasActiveRequest()) && (!lastGeneration.current ||
      versionKey(lastGeneration.current.platform, lastGeneration.current.tone) === targetKey)) {
      return "This version has an active or uncertain generation. Check or cancel that request first.";
    }
    if (uploadLock.current) return "Wait for the source attachment upload to finish.";
    return undefined;
  }

  function setBatch(next: Batch) { batchRef.current = next; setBatchState(next); }
  function setBatchRecovery(next: BatchRecovery | undefined) { batchRecoveryRef.current = next; setBatchRecoveryState(next); }
  function setGenerationState(snapshot: { platform: string; tone: CreateTone }, state: GenerationState) {
    const next = { ...generationStatesRef.current, [versionKey(snapshot.platform, snapshot.tone)]: state };
    generationStatesRef.current = next;
    setGenerationStates(next);
    if (state === "generating") setGenerationErrors(current => ({ ...current, [versionKey(snapshot.platform, snapshot.tone)]: "" }));
  }
  function settleBatch(snapshot: GenerationSnapshot, succeeded: boolean) {
    const recovery = batchRecoveryRef.current;
    const current = batchRef.current;
    if (!recovery || !sameInput(recovery, snapshot) || !current.targets.includes(snapshot.platform)) return;
    const completed = current.targets.filter(target => target === snapshot.platform ? succeeded : current.completed.includes(target));
    const failed = current.targets.find(target => ["failed", "uncertain"].includes(generationStatesRef.current[versionKey(target, recovery.tone)]));
    setBatch({ targets: current.targets, completed, ...(failed ? { failed } : {}) });
  }
  function updateVersions(update: (current: PostVersions) => PostVersions) {
    const next = update(versionsRef.current);
    versionsRef.current = next;
    setVersions(next);
  }
  useEffect(() => { copyRevision.current += 1; setCopyStatus(""); }, [key, version?.content]);
  useEffect(() => {
    if (!dirty && !busy && !generation.recoverable) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, busy, generation.recoverable]);

  const sourceLocked = () => sourceRef.current !== source || scopeRef.current !== renderScope || busy || saveLocks.current.size > 0 || uploadLock.current || generationLock.current || batchLock.current || generation.hasActiveRequest();
  const generationStartLocked = () => sourceRef.current !== source || scopeRef.current !== renderScope || lifetime.current.signal.aborted || uploadLock.current || generationLock.current || batchLock.current || generation.hasActiveRequest();
  const setSelectedPlatforms = (next: string[]) => {
    if (!preferencesReady || sourceLocked()) return;
    const selection = [...new Set(next)].filter(value => platforms.some(option => option.value === value)).slice(0, 4);
    selectionInitialized.current = true;
    selectedPlatformsRef.current = selection;
    setPlatformSelection(selection);
  };
  const toggleSelectedPlatform = (value: string) => {
    const current = selectedPlatformsRef.current;
    setSelectedPlatforms(current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  };
  const setTone = (next: CreateTone) => {
    if (sourceLocked()) return;
    toneRef.current = next; setToneChoice(next);
  };
  const setFormat = (next: EditorialFormat) => {
    if (sourceLocked()) return;
    formatRef.current = next; setFormatChoice(next);
  };
  const setPlatform = (next: string) => { if (!sourceLocked()) setPlatformChoice(next); };
  const inputSnapshot = (): GenerationInput => ({ source, tone, format });
  const inputIsCurrent = (snapshot: GenerationInput) => snapshot.source === sourceRef.current && snapshot.tone === toneRef.current && snapshot.format === formatRef.current;
  const snapshotFor = (platformValue: string, input = inputSnapshot()): GenerationSnapshot => ({ ...input, platform: platformValue,
    inboxItemId: input.source.mode === "article" && input.source.item?.articleUrl === input.source.url ? input.source.item?.id : undefined });
  const hasBatchRecovery = Boolean(batchRecovery && batch.completed.length < batch.targets.length);
  const batchInputMatches = Boolean(batchRecovery && sameInput(batchRecovery, inputSnapshot()));
  const continuationTargets = batchRecovery?.unattempted.filter(target => platforms.some(value => value.value === target)) ?? [];
  const canContinueBatch = !generationBusy && inputReady && hasBatchRecovery && batchInputMatches && continuationTargets.length > 0 &&
    continuationTargets.every(target => !saveLocks.current.has(versionKey(target, tone)));
  const canGenerateBatch = !generationBusy && inputReady && selectedPlatforms.length > 0 &&
    selectedPlatforms.every(target => !saveLocks.current.has(versionKey(target, tone)));
  function disabledGenerationReason() {
    if (generation.recoverable) return "Check or cancel the original uncertain request before generating again.";
    if (generation.pending || batching) return "Generation is sequential. Source, tone, format and selection stay locked until it settles.";
    if (uploading) return "Wait for the source attachment upload to finish.";
    if (!preferencesReady) return "Wait for publishing preferences to load.";
    if (!platforms.length) return "Enable a platform in Settings before generating.";
    if (!inputReady) return mode === "manual" ? "Add a title and 20–20,000 characters of source text." : "Enter a valid public HTTP(S) article URL or choose a story.";
    return undefined;
  }
  const generationDisabledReason = disabledGenerationReason();
  // Cancellation may finish outside runGeneration (after a paused uncertain
  // request). Reflect its terminal outcome without inventing a new attempt.
  useEffect(() => {
    const snapshot = lastGeneration.current;
    if (!snapshot || generation.pending || generation.recoverable || generation.hasActiveRequest()) return;
    if (generationStatesRef.current[versionKey(snapshot.platform, snapshot.tone)] === "uncertain") {
      setGenerationState(snapshot, "failed");
      settleBatch(snapshot, false);
    }
  }, [generation.pending, generation.recoverable, generation.hasActiveRequest]);
  // Retain each target's failure even when another card starts generating and
  // clears the request-level notice. Only the current request announces live.
  useEffect(() => {
    const snapshot = lastGeneration.current;
    if (!snapshot || generation.pending || !generation.error) return;
    const targetKey = versionKey(snapshot.platform, snapshot.tone);
    if (!["failed", "uncertain"].includes(generationStatesRef.current[targetKey])) return;
    setGenerationErrors(current => ({ ...current, [targetKey]: generation.error }));
  }, [generation.error, generation.pending, generationStates]);
  const commitSource = (next: ComposerSource) => {
    revisionReads.current.forEach(read => read.abort()); revisionReads.current.clear();
    updateVersions(all => Object.fromEntries(Object.entries(all).map(([key, value]) => [key,
      value.status === "checking" ? { ...value, status: "refresh-failed" as const } : value])));
    sourceRef.current = next; setSource(next);
  };
  const replaceSource = (next: ComposerSource, confirmInput = true, question = "Replace the source? Current cards and unsaved edits will be discarded. Saved drafts remain in Content.") => {
    if (sourceLocked()) { setNotice("Finish, retry or cancel the current operation before changing the source."); return false; }
    const current = sourceRef.current;
    const hasWork = Object.keys(versionsRef.current).length > 0 || current.item || confirmInput && hasSourceInput(current);
    if (hasWork && !window.confirm(question)) return false;
    // One atomic transition for every story, URL and mode entry. No browser
    // persistence, implicit generation, save, or cancellation is introduced.
    commitSource(next);
    updateVersions(() => ({}));
    lastGeneration.current = undefined;
    attempts.current = {}; generationStatesRef.current = {}; setBatchRecovery(undefined);
    setGenerationStates({}); setGenerationErrors({}); setBatch({ targets: [], completed: [] });
    batchStop.current = false; setBatchStopRequested(false);
    copyRevision.current += 1; setCopyStatus("");
    setSavedSourceKey(""); setNotice(""); generation.reset();
    return true;
  };
  const startNewCreate = () => {
    if (!replaceSource(emptySource("article"), true, "Start a new post? Current inputs, cards and unsaved edits will be discarded. Saved drafts remain in Content. Cancel to resume this creation.")) return false;
    setPlatformChoice(undefined);
    const defaultTone = CREATE_TONES.find(value => value.value === profile.data?.defaultTone)?.key ?? "thoughtLeader";
    toneRef.current = defaultTone; setToneChoice(undefined);
    formatRef.current = "short-post"; setFormatChoice("short-post");
    const initial = platforms.slice(0, 4).map(value => value.value);
    selectionInitialized.current = preferencesReady;
    selectedPlatformsRef.current = initial; setPlatformSelection(initial);
    return true;
  };
  const setMode = (next: ComposerSource["mode"]) => next === sourceRef.current.mode || replaceSource(emptySource(next));
  const setUrl = (next: string) => next === sourceRef.current.url || replaceSource({ ...emptySource("article"), url: next }, false);
  const selectPasteUrl = () => !sourceRef.current.item || replaceSource(emptySource("article"));
  const prefill = (next?: InboxItem) => {
    if (!next || next.id === sourceRef.current.item?.id && sourceRef.current.url === next.articleUrl) return true;
    return replaceSource({ mode: next.articleUrl ? "article" : "manual", url: next.articleUrl, item: next,
      manual: next.articleUrl ? emptyArticle() : { title: next.headline.slice(0, 200), content: next.summary ?? "", media: [] } });
  };
  const prefillUrl = (next: string) => {
    // Navigation links only seed fresh sessions; arrival never replaces work or
    // resets the original job pointer, even if all visible versions were saved.
    if (sourceLocked() || hasSourceInput(sourceRef.current) || Object.keys(versionsRef.current).length) {
      setNotice("Your existing creation was kept. Use the source controls to replace it when ready."); return false;
    }
    return replaceSource({ ...emptySource("article"), url: next });
  };
  const setManual = (next: ManualArticle) => {
    // Normal Idea editing keeps its existing revision workflow. Upload completion
    // may attach media while its own upload lock is still held.
    if (sourceRef.current !== source || scopeRef.current !== renderScope || sourceRef.current.mode !== "manual" || saveLocks.current.size || generationLock.current || batchLock.current || generation.hasActiveRequest()) return;
    commitSource({ ...sourceRef.current, manual: next });
  };
  const acceptResult = (data: ReviewResponse, snapshot: { platform: string; tone: CreateTone; inboxItemId?: string }) => {
    const content = data?.posts?.[snapshot.platform]?.[snapshot.tone];
    if (!reviewMetadataSchema.safeParse(data).success || typeof content !== "string" ||
      content.trim() && !usablePost(content, Math.min(5000, getPlatformMeta(snapshot.platform).charLimit), snapshot.platform)) {
      setGenerationErrors(current => ({ ...current, [versionKey(snapshot.platform, snapshot.tone)]: "This attempt returned no usable text; previous versions were kept." }));
      setNotice("No usable text was returned. Your previous versions are unchanged."); return false;
    }
    // Accept only the requested platform and tone, even if the response contains others.
    updateVersions(current => applyReview(current, { ...data, posts: { [snapshot.platform]: { [snapshot.tone]: content } } }, snapshot.inboxItemId));
    if (!content.trim()) {
      setGenerationErrors(current => ({ ...current, [versionKey(snapshot.platform, snapshot.tone)]: "This attempt returned no usable text; previous versions were kept." }));
      setNotice("No usable text was returned. Your previous versions are unchanged.");
    }
    else setNotice("Generation complete. Review and edit before saving; nothing has been published.");
    return Boolean(content.trim());
  };
  const markAttempted = (snapshot: GenerationSnapshot) => {
    // Freeze a profile-derived default too; a later preferences refresh must
    // not switch the visible tone while this request owns the inputs.
    setToneChoice(snapshot.tone);
    attempts.current[versionKey(snapshot.platform, snapshot.tone)] = snapshot;
    setGenerationState(snapshot, "generating");
    const recovery = batchRecoveryRef.current;
    if (recovery && sameInput(recovery, snapshot) && batchRef.current.targets.includes(snapshot.platform)) {
      setBatchRecovery({ ...recovery, unattempted: recovery.unattempted.filter(target => target !== snapshot.platform) });
      setBatch({ ...batchRef.current, current: snapshot.platform });
    }
  };
  const runGeneration = async (snapshot: GenerationSnapshot, retry = false, confirmOverwrite = true) => {
    if (sourceRef.current !== source || scopeRef.current !== renderScope || lifetime.current.signal.aborted || !inputIsCurrent(snapshot) || generationLock.current || saveLocks.current.has(versionKey(snapshot.platform, snapshot.tone)) || uploadLock.current || generation.pending ||
      (!retry && (!inputReady || generation.hasActiveRequest()))) return false;
    if (!platforms.some(value => value.value === snapshot.platform)) return;
    const existing = versionsRef.current[versionKey(snapshot.platform, snapshot.tone)];
    if (!retry && confirmOverwrite && existing && isEdited(existing) &&
      !window.confirm("Regenerate this post and overwrite your edits? Other platforms and tones stay unchanged. Existing text is kept if generation fails.")) return;
    generationLock.current = true; lastGeneration.current = snapshot; setNotice("");
    markAttempted(snapshot);
    let succeeded = false;
    try {
      const original = snapshot.source;
      const endpoint = original.mode === "manual" ? "/api/instant-review/manual" : "/api/instant-review/selected";
      const data = retry ? await generation.retry() : await generation.generate(endpoint, {
        ...(original.mode === "manual" ? original.manual : { url: original.url.trim() }), selectedPlatforms: [snapshot.platform], tones: [snapshot.tone], format: supportsArticle(snapshot.platform) ? snapshot.format : "short-post",
      });
      if (scopeRef.current !== renderScope || lifetime.current.signal.aborted || !inputIsCurrent(snapshot)) return false;
      succeeded = data !== undefined && acceptResult(data, snapshot);
      return succeeded;
    } finally {
      const unsuccessfulState = generation.hasActiveRequest() ? "uncertain" : "failed";
      setGenerationState(snapshot, succeeded ? "ready" : unsuccessfulState);
      settleBatch(snapshot, succeeded);
      reservations.current.delete(versionKey(snapshot.platform, snapshot.tone));
      generationLock.current = false;
    }
  };
  const generate = async (retry = false) => {
    if (scopeRef.current !== renderScope || sourceRef.current !== source || batchLock.current || generationLock.current || uploadLock.current || (!retry && !canGenerate)) return;
    if (retry && !generation.hasActiveRequest()) return;
    // Reattached jobs own their source/selection; a reload need not restore inputs.
    if (retry && generation.reattached) { await generation.retry(); return; }
    const snapshot = retry ? lastGeneration.current : snapshotFor(platform);
    if (snapshot) await runGeneration(snapshot, retry);
  };
  const canGeneratePlatform = (platformValue: string) => {
    const targetKey = versionKey(platformValue, tone);
    const attempt = attempts.current[targetKey];
    const recovery = batchRecoveryRef.current;
    if (generationStates[targetKey] === "not-attempted" && recovery && !sameInput(recovery, inputSnapshot())) return false;
    return !generationBusy && inputReady && !saveLocks.current.has(targetKey) && (generationStates[targetKey] !== "failed" || !attempt || sameInput(attempt, inputSnapshot()));
  };
  const generatePlatform = async (platformValue: string) => {
    if (generationStartLocked() || !canGeneratePlatform(platformValue) || !platforms.some(value => value.value === platformValue)) return;
    const targetKey = versionKey(platformValue, tone);
    const attempt = attempts.current[targetKey];
    const snapshot = generationStatesRef.current[targetKey] === "failed" && attempt ? attempt : snapshotFor(platformValue);
    if (!inputIsCurrent(snapshot)) return;
    setPlatformChoice(platformValue);
    await runGeneration(snapshot);
  };
  const runBatch = async (input: GenerationInput, targets: string[]) => {
    batchLock.current = true;
    reservations.current = new Set(targets.map(target => versionKey(target, input.tone)));
    batchStop.current = false;
    setBatchStopRequested(false);
    setBatching(true);
    setNotice("");
    try {
      for (const target of targets) {
        if (batchStop.current || !inputIsCurrent(input)) return;
        setPlatformChoice(target);
        const succeeded = await runGeneration(snapshotFor(target, input), false, false);
        if (!succeeded) return;
        if (batchStop.current) {
          const completed = batchRef.current.completed;
          setNotice(`Stopped after ${completed.length} completed ${completed.length === 1 ? "post" : "posts"}. Generated cards are retained.`);
          return;
        }
      }
      const completed = batchRef.current.completed;
      setNotice(`${completed.length} platform ${completed.length === 1 ? "post is" : "posts are"} ready. Review each card before saving or publishing.`);
    } finally {
      reservations.current.clear();
      batchLock.current = false;
      setBatching(false);
      setBatchStopRequested(false);
    }
  };
  const continueBatch = async () => {
    const recovery = batchRecoveryRef.current;
    if (!recovery || generationStartLocked() || !inputReady || !inputIsCurrent(recovery)) return;
    // The ledger, never the current platform selection, owns continuation.
    const targets = recovery.unattempted.filter(target => generationStatesRef.current[versionKey(target, recovery.tone)] === "not-attempted" && platforms.some(value => value.value === target));
    if (targets.some(target => saveLocks.current.has(versionKey(target, recovery.tone)))) return;
    if (targets.some(target => { const existing = versionsRef.current[versionKey(target, recovery.tone)]; return existing && isEdited(existing); }) &&
      !window.confirm("Generate the unattempted posts and overwrite their edits? Completed cards stay unchanged. Existing text is retained if generation fails.")) return;
    if (targets.length) await runBatch(recovery, targets);
  };
  const generateBatch = async (targets: string[]) => {
    if (generationStartLocked() || !inputReady || !inputIsCurrent(inputSnapshot())) return;
    if (batchRecoveryRef.current && batchRef.current.completed.length < batchRef.current.targets.length) { await continueBatch(); return; }
    const unique = [...new Set(targets)].filter(target => platforms.some(value => value.value === target)).slice(0, 4);
    if (!unique.length) return;
    if (unique.some(target => saveLocks.current.has(versionKey(target, tone)))) return;
    const edited = unique.some(target => {
      const existing = versionsRef.current[versionKey(target, tone)];
      return existing && isEdited(existing);
    });
    if (edited && !window.confirm("Regenerate the selected posts and overwrite your edits? Saved drafts keep their IDs; existing text is retained if generation fails.")) return;
    const input = inputSnapshot();
    setBatch({ targets: unique, completed: [] });
    setBatchRecovery({ ...input, unattempted: unique });
    for (const target of unique) setGenerationState({ platform: target, tone }, "not-attempted");
    await runBatch(input, unique);
  };
  const stopBatchAfterCurrent = () => {
    if (!batchLock.current) return;
    batchStop.current = true;
    setBatchStopRequested(true);
  };
  const cancelGeneration = () => {
    // Stop the sequence even if cancellation races with result delivery.
    if (batchLock.current) batchStop.current = true;
    return generation.cancel();
  };
  const editVersion = (platformValue: string, toneValue: CreateTone, content: string) => {
    const targetKey = versionKey(platformValue, toneValue);
    const target = versionsRef.current[targetKey];
    if (sourceRef.current !== source || scopeRef.current !== renderScope || versionLockReason(platformValue, toneValue) || !target) return;
    copyRevision.current += 1; setCopyStatus("");
    updateVersions(current => ({ ...current, [targetKey]: editDraftText(current[targetKey], content) }));
  };
  const edit = (content: string) => editVersion(platform, tone, content);
  const refreshVersion = async (platformValue: string, toneValue: CreateTone) => {
    const targetKey = versionKey(platformValue, toneValue);
    const target = versionsRef.current[targetKey];
    if (sourceRef.current !== source || scopeRef.current !== renderScope || versionLockReason(platformValue, toneValue) || !target?.savedId || target.status === "immutable" || lifetime.current.signal.aborted) return;
    revisionReads.current.get(targetKey)?.abort();
    const read = new AbortController();
    revisionReads.current.set(targetKey, read);
    const signal = AbortSignal.any([read.signal, lifetime.current.signal, accountCache.getSignal()]);
    const ownsRead = () => !signal.aborted && scopeRef.current === renderScope && sourceRef.current === source &&
      revisionReads.current.get(targetKey) === read && versionsRef.current[targetKey]?.savedId === target.savedId &&
      versionsRef.current[targetKey]?.review === target.review;
    updateVersions(all => ({ ...all, [targetKey]: { ...all[targetKey], status: "checking", error: undefined } }));
    try {
      const response = await apiRequest("GET", `/api/drafts/${encodeURIComponent(target.savedId)}/editing-snapshot`, undefined, { signal, cache: "no-store" });
      const latest = parseDraftEditingSnapshot(await response.json(), { id: target.savedId, platform: target.platform,
        tone: CREATE_TONES.find(value => value.key === target.tone)!.value });
      if (!ownsRead()) return;
      updateVersions(all => ({ ...all, [targetKey]: observeDraftRevision(all[targetKey], latest) }));
    } catch (error) {
      if (!ownsRead()) return;
      updateVersions(all => ({ ...all, [targetKey]: { ...all[targetKey], status: "refresh-failed",
        error: error instanceof ApiError && error.status === 404 ? "This saved draft is missing or no longer accessible. Your local text is retained; no new draft was created."
          : "Latest revision is unavailable. Your local text is retained; cached data is not confirmation." } }));
    } finally { if (revisionReads.current.get(targetKey) === read) revisionReads.current.delete(targetKey); }
  };
  const resolveVersion = (platformValue: string, toneValue: CreateTone, choice: "load" | "keep" | "adopt") => {
    const targetKey = versionKey(platformValue, toneValue), target = versionsRef.current[targetKey];
    if (sourceRef.current !== source || scopeRef.current !== renderScope || versionLockReason(platformValue, toneValue) || target?.status !== "conflict" ||
      target.latestRevision !== versions[targetKey]?.latestRevision) return;
    if (choice === "keep") {
      updateVersions(all => ({ ...all, [targetKey]: { ...target, keptLocal: true } })); return;
    }
    if (!target.latestRevision) return;
    if (choice === "load" && target.content !== target.latestRevision.content && target.content !== target.savedContent &&
      !window.confirm("Load latest and discard your local edits? This cannot be undone. Nothing will be saved.")) return;
    updateVersions(all => ({ ...all, [targetKey]: adoptDraftRevision(target, choice === "load") }));
  };
  // isOpen stays true during ordinary sidebar navigation. Only actual route
  // arrivals (plus returning to a hidden tab) trigger uncached reads; writes are never retried.
  useEffect(() => {
    if (onCreateRoute && !wasOnCreate.current) refreshOnArrival.current = true;
    wasOnCreate.current = onCreateRoute;
    if (onCreateRoute && refreshOnArrival.current && !saveLocks.current.size && !generationBusy) {
      refreshOnArrival.current = false;
      Object.values(versionsRef.current).forEach(value => { if (value.savedId) void refreshVersion(value.platform, value.tone); });
    }
  }, [onCreateRoute, saving, scopeKey, generationBusy]);
  useEffect(() => {
    if (!onCreateRoute) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      if (saveLocks.current.size || generationStartLocked()) { refreshOnArrival.current = true; return; }
      Object.values(versionsRef.current).forEach(value => { if (value.savedId) void refreshVersion(value.platform, value.tone); });
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [onCreateRoute, source, scopeKey]);
  const saveVersion = async (platformValue: string, toneValue: CreateTone) => {
    const targetKey = versionKey(platformValue, toneValue);
    const current = versionsRef.current[targetKey];
    const usable = Boolean(current && usablePost(current.content, Math.min(5000, getPlatformMeta(platformValue).charLimit), platformValue));
    if (sourceRef.current !== source || scopeRef.current !== renderScope || lifetime.current.signal.aborted || versionLockReason(platformValue, toneValue) || !usable || !current || current.status === "saved" || draftSaveBlocked(current)) return;
    saveLocks.current.add(targetKey); setSaving(true);
    revisionReads.current.get(targetKey)?.abort(); revisionReads.current.delete(targetKey);
    const signal = AbortSignal.any([lifetime.current.signal, accountCache.getSignal()]);
    const ownsSave = () => !signal.aborted && scopeRef.current === renderScope && sourceRef.current === source &&
      versionsRef.current[targetKey]?.savedId === current.savedId && versionsRef.current[targetKey]?.review === current.review;
    updateVersions(all => ({ ...all, [targetKey]: { ...current, status: "saving", error: undefined } }));
    try {
      const response = await apiRequest(current.savedId ? "PATCH" : "POST", current.savedId ? `/api/drafts/${encodeURIComponent(current.savedId)}` : "/api/drafts",
        current.savedId ? { content: current.content, expectedContent: current.savedContent, expectedUpdatedAt: current.savedUpdatedAt }
          : { platform: current.platform, tone: CREATE_TONES.find(value => value.key === current.tone)!.value,
          content: current.content, media: current.review.article.media ?? [], inboxItemId: current.inboxItemId }, { signal });
      const saved = parseDraftEditingSnapshot(await response.json(), { id: current.savedId, platform: current.platform,
        tone: CREATE_TONES.find(value => value.key === current.tone)!.value });
      if (!ownsSave()) return;
      updateVersions(all => ({ ...all, [targetKey]: acknowledgeDraftSave(all[targetKey], current.content, saved) }));
      setSavedSourceKey(sourceKey);
      void client.invalidateQueries({ queryKey: ["/api/drafts"] });
    } catch (error) {
      if (!ownsSave()) return;
      const conflict = error instanceof ApiError && error.status === 409 && error.code === "draft_conflict";
      const immutable = error instanceof ApiError && error.status === 409 && error.code === "draft_immutable";
      let status: typeof current.status = "failed";
      if (conflict) status = "conflict";
      else if (immutable) status = "immutable";
      updateVersions(all => ({ ...all, [targetKey]: { ...all[targetKey], latestRevision: undefined,
        status,
        error: `${error instanceof Error ? error.message : "Save failed"} Your text is retained. If the response was interrupted, check Content before retrying.` } }));
    } finally { saveLocks.current.delete(targetKey); if (!lifetime.current.signal.aborted) setSaving(saveLocks.current.size > 0); }
  };
  const save = () => saveVersion(platform, tone);
  const copyVersion = async (platformValue: string, toneValue: CreateTone) => {
    const target = versionsRef.current[versionKey(platformValue, toneValue)];
    const usable = Boolean(target && usablePost(target.content, Math.min(5000, getPlatformMeta(platformValue).charLimit), platformValue));
    if (sourceRef.current !== source || scopeRef.current !== renderScope || !usable || !target || versionLockReason(platformValue, toneValue)) return;
    const revision = ++copyRevision.current;
    const ownsCopy = () => revision === copyRevision.current && scopeRef.current === renderScope && sourceRef.current === source &&
      !lifetime.current.signal.aborted && versionsRef.current[versionKey(platformValue, toneValue)]?.content === target.content;
    setCopyStatus("");
    try { await navigator.clipboard.writeText(target.content); if (ownsCopy()) setCopyStatus("Copied. Paste and publish manually; publication is not tracked here."); }
    catch { if (ownsCopy()) setCopyStatus("Copy failed. Select and copy the text manually. Nothing was published."); }
  };
  const copy = () => copyVersion(platform, tone);
  const identityName = me.data?.name?.trim() || [me.data?.firstName, me.data?.lastName].filter(Boolean).join(" ").trim()
    || [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || "Your profile";
  const identityEmail = me.data?.email || user?.email;
  return { platforms, preferencesReady, preferencesError: profile.isError || integrations.isError,
    generationState: (platformValue: string, toneValue: CreateTone) => generationStates[versionKey(platformValue, toneValue)],
    generationError: (platformValue: string, toneValue: CreateTone) => generationErrors[versionKey(platformValue, toneValue)],
    retryPreferences: () => { void profile.refetch(); void integrations.refetch(); },
    inbox: (inbox.data ?? []).filter(isUsableInboxArticle), inboxLoading: inbox.isLoading, inboxError: inbox.isError, retryInbox: inbox.refetch,
    platform, setPlatform, selectedPlatforms, setSelectedPlatforms, toggleSelectedPlatform, tone, setTone, toneOptions: CREATE_TONES,
    hasVersion: (value: string, toneKey?: CreateTone) => Object.values(versions).some(version => version.platform === value && (!toneKey || version.tone === toneKey)), format: effectiveFormat, setFormat, mode, setMode, url, setUrl, item,
    manual, setManual, setUploading, versions, version, edit, editVersion, generation: { ...generation, cancel: cancelGeneration }, generate, generatePlatform, canGeneratePlatform, generateBatch, continueBatch, canContinueBatch, hasBatchRecovery, batchInputMatches, batchRecovery, stopBatchAfterCurrent, batch, batching, batchStopRequested, requestedFormat: format,
    save, saveVersion, refreshVersion, resolveVersion, copy, copyVersion, copyStatus, notice, identity: { name: identityName, handle: identityEmail?.split("@")[0] || "your-profile", imageUrl: me.data?.profileImageUrl || user?.imageUrl, industry: me.data?.industry },
    dirty, busy, saving, hasCreation, startNewCreate, versionLockReason, canGenerate, canGenerateBatch, generationDisabledReason,
    // A delayed handoff supplies its admitted revision, fencing even same-turn
    // edits/source replacements before the child receives updated props.
    canUse, canUseVersion: (platformValue: string, toneValue: CreateTone, expectedVersion?: PostVersion) => { const target = versionsRef.current[versionKey(platformValue, toneValue)]; return (!expectedVersion || target === expectedVersion) && !versionLockReason(platformValue, toneValue) && Boolean(target && usablePost(target.content, Math.min(5000, getPlatformMeta(platformValue).charLimit), platformValue)); }, prefill, prefillUrl, selectPasteUrl };
}
export type CreatePostComposer = ReturnType<typeof useCreatePostComposer>;