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
import { useCreationSession } from "@/hooks/use-creation-session";
import { MAX_CREATION_REFERENCES, type CreationChat, type CreationSession, type CreationStep } from "@shared/creation-session";
import { ALL_PLATFORM_KEYS } from "@shared/schema";
import { applyReview, CREATE_TONES, emptyArticle, isEdited, publicSourceUrl, versionKey, type CreateTone, type MainDraft, type ManualArticle, type PostVersion, type PostVersions } from "./create-post-state";

type ComposerSource = { mode: "article" | "manual"; url: string; item?: InboxItem; inboxItemId?: string; manual: ManualArticle };
type GenerationInput = { source: ComposerSource; tone: CreateTone; format: EditorialFormat; main?: MainDraft };
type GenerationSnapshot = GenerationInput & { platform: string; inboxItemId?: string };
type GenerationState = "generating" | "ready" | "failed" | "uncertain" | "not-attempted";
type Batch = { targets: string[]; completed: string[]; current?: string; failed?: string };
type BatchRecovery = GenerationInput & { unattempted: string[] };
const emptySource = (mode: ComposerSource["mode"]): ComposerSource => ({ mode, url: "", manual: emptyArticle() });
const emptyChat = (): CreationChat => ({ input: "", referenceUrls: [], messages: [] });
const hasSourceInput = (source: ComposerSource) => Boolean(source.url.trim() || source.manual.title.trim() || source.manual.content.trim() || source.manual.media.length);
const sameInput = (a: GenerationInput, b: GenerationInput) =>
  a.source === b.source && a.tone === b.tone && a.format === b.format &&
  a.main?.revision === b.main?.revision && a.main?.title === b.main?.title && a.main?.content === b.main?.content;

// Validate the fields rendered or saved with a card before replacing its prior
// revision. Optional legacy metadata stays optional; malformed metadata does not.
const detailMetadataSchema = z.object({
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
});
const reviewMetadataSchema = z.object({
  article: z.object({
    title: z.string(), content: z.string(), source: z.string(), url: z.string(), domain: z.string(),
    media: z.array(z.object({ id: z.string().optional(), type: z.enum(["image", "video", "audio"]), name: z.string(), url: z.string() })).optional(),
    references: z.array(z.object({ title: z.string(), source: z.string(), url: z.string() })).optional(),
  }),
  format: z.enum(["short-post", "article"]).optional(),
  evidence: z.object({
    sourceId: z.string(),
    warnings: z.array(z.object({ code: z.string(), message: z.string() })),
    excerpts: z.array(z.object({ id: z.string(), text: z.string() })),
  }).optional(),
  details: z.record(z.record(detailMetadataSchema)).optional(),
  mainDraft: detailMetadataSchema.extend({ content: z.string().min(1).max(5000) }).optional(),
});

function isReviewResponse(value: unknown): value is ReviewResponse {
  return reviewMetadataSchema.safeParse(value).success && z.object({
    posts: z.record(z.record(z.string())), details: z.record(z.record(z.unknown())),
    mainDraft: z.object({ content: z.string().min(1).max(5000) }).optional(),
  }).safeParse(value).success;
}
function storedReview(json: string): ReviewResponse {
  const value: unknown = JSON.parse(json);
  if (!isReviewResponse(value)) throw new Error("The saved generation details are invalid. Your saved creation was not overwritten.");
  return value;
}

/** One server-saved creation; platform publication drafts remain separate. */
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
  const { mode, url, manual } = source;
  const item = source.item ?? inbox.data?.find(value => value.id === source.inboxItemId);
  const [versions, setVersions] = useState<PostVersions>({});
  const versionsRef = useRef(versions);
  const [step, setStep] = useState<CreationStep>("source");
  const [main, setMainState] = useState<MainDraft>();
  const mainRef = useRef(main);
  const [chat, setChatState] = useState<CreationChat>(emptyChat);
  const chatRef = useRef(chat);
  const proposalReview = useMemo(() => chat.proposal ? storedReview(chat.proposal.reviewJson) : undefined, [chat.proposal]);
  const [reviewedRevision, setReviewedRevision] = useState<number>();
  const reviewedRef = useRef(reviewedRevision);
  const mainAttempt = useRef(false);
  const lifetime = useRef(new AbortController());
  const scopeKey = JSON.stringify([user?.id, profile.data?.tenantId]);
  const renderScope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const scopeRef = useRef(renderScope);
  scopeRef.current = renderScope;
  const persistence = useCreationSession(isOpen && profile.isSuccess, scopeKey, () => ({
    version: 1, step, source: { mode, url, manual, inboxItemId: item?.id ?? source.inboxItemId }, tone, format,
    selectedPlatforms: ALL_PLATFORM_KEYS.filter(value => platformSelection.includes(value)),
    main: main && { title: main.title, content: main.content, original: main.original, revision: main.revision, formatJson: main.formatJson, reviewJson: JSON.stringify(main.review) },
    reviewedRevision,
    chat: chatRef.current,
    versions: Object.values(versions).map(value => ({
      platform: z.enum(ALL_PLATFORM_KEYS).parse(value.platform), tone: value.tone, content: value.content, original: value.original,
      mainRevision: value.mainRevision, inboxItemId: value.inboxItemId, reviewJson: JSON.stringify(value.review),
      savedId: value.savedId, savedContent: value.savedContent, savedUpdatedAt: value.savedUpdatedAt,
    })),
  }), restoreCreation);
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
    scope: persistence.ready && user?.id && profile.data?.tenantId ? { userId: user.id, tenantId: profile.data.tenantId } : undefined,
    onRecovered: data => {
      if (data?.mainDraft) { receiveSuggestion(data); return; }
      const recoveredPlatform = Object.keys(data?.posts ?? {})[0];
      const recoveredTone = CREATE_TONES.find(value => typeof data?.posts?.[recoveredPlatform]?.[value.key] === "string")?.key;
      if (!PLATFORMS.some(value => value.value === recoveredPlatform) || !recoveredTone) {
        setNotice("The recovered job returned no supported platform. Nothing was regenerated."); return;
      }
      const snapshot = { platform: recoveredPlatform, tone: recoveredTone, source: sourceRef.current, format: data.format,
        main: mainRef.current?.content === data.article?.content && mainRef.current?.title === data.article?.title ? mainRef.current : undefined };
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
    const initial: string[] = [];
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
  const hasInput = hasSourceInput(source);
  const inputReady = mode === "manual"
    ? Boolean(manual.title.trim()) && manual.content.trim().length >= 20 && manual.content.length <= 20_000
    : Boolean(publicSourceUrl(url.trim()));
  const dirty = persistence.unsaved;
  const busy = generation.pending || saving || uploading || batching;
  const generationBusy = generation.pending || uploading || batching || generation.recoverable;
  const mainReady = Boolean(main?.title.trim() && main.content.trim().length >= 20 && main.content.length <= 5000);
  const mainReviewed = mainReady && main?.revision === reviewedRevision;
  const canGenerate = persistence.ready && Boolean(platform) && mainReviewed && !generationBusy && !saveLocks.current.has(key);
  const canUse = Boolean(platform && version && usablePost(version.content, Math.min(5000, getPlatformMeta(platform).charLimit), platform)) && !versionLockReason(platform, tone);
  const hasCreation = Boolean(main) || mode === "manual" || hasInput || Object.keys(versions).length > 0 || busy || generation.recoverable ||
    Boolean(chat.input.trim() || chat.referenceUrls.length || chat.messages.length);

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
  function staleVersion(platformValue: string, toneValue: CreateTone) {
    return Boolean(versionsRef.current[versionKey(platformValue, toneValue)] &&
      versionsRef.current[versionKey(platformValue, toneValue)].mainRevision !== mainRef.current?.revision);
  }
  function setMain(next: MainDraft | undefined) { mainRef.current = next; setMainState(next); }
  function updateChat(next: CreationChat) { chatRef.current = next; setChatState(next); }
  function restoreCreation(state: CreationSession) {
    const restoredMain = state.main && { ...state.main, review: state.main.reviewJson ? storedReview(state.main.reviewJson) : undefined };
    if (state.chat?.proposal) storedReview(state.chat.proposal.reviewJson);
    const restoredVersions: PostVersions = {};
    for (const value of state.versions) {
      restoredVersions[versionKey(value.platform, value.tone)] = { ...value, review: storedReview(value.reviewJson),
        status: value.savedId ? "refresh-failed" : "unsaved",
        error: value.savedId ? "Check the latest saved draft before changing it." : undefined };
    }
    const nextSource = { ...state.source, item: inbox.data?.find(value => value.id === state.source.inboxItemId) };
    sourceRef.current = nextSource; setSource(nextSource);
    setMain(restoredMain); updateVersions(() => restoredVersions);
    updateChat(state.chat ?? emptyChat());
    reviewedRef.current = state.reviewedRevision; setReviewedRevision(state.reviewedRevision);
    setStep(restoredMain ? state.step : "source");
    setToneChoice(state.tone); setFormatChoice(state.format);
    selectionInitialized.current = true; selectedPlatformsRef.current = state.selectedPlatforms; setPlatformSelection(state.selectedPlatforms);
    setBatchRecovery(undefined); setBatch({ targets: [], completed: [] });
    refreshOnArrival.current = true;
    setNotice("Saved creation restored. Nothing has been published.");
  }
  const editMain = (patch: Partial<Pick<MainDraft, "title" | "content" | "formatJson">>) => {
    const current = mainRef.current;
    if (!current || sourceLocked()) return;
    const next = { ...current, ...patch,
      ...(patch.content !== undefined && patch.content !== current.content && !("formatJson" in patch) ? { formatJson: undefined } : {}) };
    if (current.title === next.title && current.content === next.content) {
      if (current.formatJson !== next.formatJson) setMain(next);
      return;
    }
    setMain({ ...next, revision: current.revision + 1 });
    reviewedRef.current = undefined; setReviewedRevision(undefined);
    setBatchRecovery(undefined); setBatch({ targets: [], completed: [] });
    setGenerationStates({}); generationStatesRef.current = {}; attempts.current = {};
  };
  const editDocument = (patch: Partial<Pick<MainDraft, "title" | "content" | "formatJson">>) => {
    if (sourceLocked() || !persistence.ready) return;
    if (mainRef.current) { editMain(patch); return; }
    setMain({ title: "Untitled draft", content: "", original: "", revision: 1, ...patch });
    setStep("review");
  };
  const choosePlatforms = () => {
    if (!mainReady || sourceLocked()) return;
    reviewedRef.current = mainRef.current!.revision; setReviewedRevision(mainRef.current!.revision); setStep("platforms");
  };
  const goToStep = (next: CreationStep) => {
    if (sourceLocked() || !persistence.ready) return;
    if (next !== "source" && !mainRef.current) return;
    if (next === "platforms" && mainRef.current?.revision !== reviewedRef.current) return;
    setStep(next);
  };

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
  const inputSnapshot = (): GenerationInput => ({ source, tone, format, main });
  const inputIsCurrent = (snapshot: GenerationInput) => sameInput(snapshot, {
    source: sourceRef.current, tone: toneRef.current, format: formatRef.current, main: mainRef.current,
  });
  const snapshotFor = (platformValue: string, input = inputSnapshot()): GenerationSnapshot => ({ ...input, platform: platformValue,
    inboxItemId: input.source.mode === "article" ? input.source.item?.id ?? input.source.inboxItemId : undefined });
  const hasBatchRecovery = Boolean(batchRecovery && batch.completed.length < batch.targets.length);
  const batchInputMatches = Boolean(batchRecovery && sameInput(batchRecovery, inputSnapshot()));
  const continuationTargets = batchRecovery?.unattempted.filter(target => platforms.some(value => value.value === target)) ?? [];
  const canContinueBatch = persistence.ready && mainReviewed && !generationBusy && hasBatchRecovery && batchInputMatches && continuationTargets.length > 0 &&
    continuationTargets.every(target => !saveLocks.current.has(versionKey(target, tone)));
  const canGenerateBatch = persistence.ready && mainReviewed && !generationBusy && selectedPlatforms.length > 0 &&
    selectedPlatforms.every(target => !saveLocks.current.has(versionKey(target, tone)));
  function disabledGenerationReason() {
    if (generation.recoverable) return "Check or cancel the original uncertain request before generating again.";
    if (generation.pending || batching) return "Generation is sequential. Source, tone, format and selection stay locked until it settles.";
    if (uploading) return "Wait for the source attachment upload to finish.";
    if (!persistence.ready) return "Wait for the saved creation to load.";
    if (!mainReviewed) return "Create and review your main draft before choosing platforms.";
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
    const hasWork = Boolean(mainRef.current) || Object.keys(versionsRef.current).length > 0 || current.item ||
      Boolean(chatRef.current.input.trim() || chatRef.current.referenceUrls.length || chatRef.current.messages.length) || confirmInput && hasSourceInput(current);
    if (hasWork && !window.confirm(question)) return false;
    // Replace the active creation atomically; publication drafts are untouched.
    commitSource(next);
    setMain(undefined); reviewedRef.current = undefined; setReviewedRevision(undefined); setStep("source");
    updateChat(emptyChat());
    updateVersions(() => ({}));
    lastGeneration.current = undefined;
    attempts.current = {}; generationStatesRef.current = {}; setBatchRecovery(undefined);
    setGenerationStates({}); setGenerationErrors({}); setBatch({ targets: [], completed: [] });
    batchStop.current = false; setBatchStopRequested(false);
    copyRevision.current += 1; setCopyStatus("");
    setNotice(""); generation.reset();
    return true;
  };
  const startNewCreate = () => {
    if (!replaceSource(emptySource("article"), true, "Start a new post? This replaces your saved main draft and working platform versions. Saved platform drafts remain in Content. Cancel to resume this creation.")) return false;
    setPlatformChoice(undefined);
    const defaultTone = CREATE_TONES.find(value => value.value === profile.data?.defaultTone)?.key ?? "thoughtLeader";
    toneRef.current = defaultTone; setToneChoice(undefined);
    formatRef.current = "short-post"; setFormatChoice("short-post");
    const initial: string[] = [];
    selectionInitialized.current = preferencesReady;
    selectedPlatformsRef.current = initial; setPlatformSelection(initial);
    return true;
  };
  const setMode = (next: ComposerSource["mode"]) => next === sourceRef.current.mode || replaceSource(emptySource(next));
  const setUrl = (next: string) => next === sourceRef.current.url || replaceSource({ ...emptySource("article"), url: next }, false);
  const selectPasteUrl = () => !(sourceRef.current.item || sourceRef.current.inboxItemId) || replaceSource(emptySource("article"));
  const prefill = (next?: InboxItem) => {
    if (!next || next.id === sourceRef.current.item?.id && sourceRef.current.url === next.articleUrl) return true;
    const replaced = replaceSource({ mode: next.articleUrl ? "article" : "manual", url: next.articleUrl, item: next,
      manual: next.articleUrl ? emptyArticle() : { title: next.headline.slice(0, 200), content: next.summary ?? "", media: [] } });
    if (replaced && next.articleUrl) updateChat({ ...emptyChat(), referenceUrls: [next.articleUrl] });
    return replaced;
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
    if (mainRef.current && !window.confirm("Replace the source? The main draft and platform versions will be cleared. Saved platform drafts remain in Content.")) return;
    if (mainRef.current) {
      setMain(undefined); updateVersions(() => ({})); setStep("source");
      reviewedRef.current = undefined; setReviewedRevision(undefined);
    }
    commitSource({ ...sourceRef.current, manual: next });
  };
  function acceptMain(data: ReviewResponse, title?: string) {
    if (!isReviewResponse(data) || !data.mainDraft?.content.trim() || data.mainDraft.content.length > 5000) {
      setNotice("No usable main draft was returned. Your previous work is unchanged."); return false;
    }
    setMain({ title: (title ?? data.article.title).slice(0, 200), content: data.mainDraft.content,
      original: data.mainDraft.content, revision: (mainRef.current?.revision ?? 0) + 1, review: data });
    reviewedRef.current = undefined; setReviewedRevision(undefined); setStep("review");
    setBatchRecovery(undefined); setBatch({ targets: [], completed: [] });
    attempts.current = {}; generationStatesRef.current = {}; setGenerationStates({}); setGenerationErrors({});
    setNotice("Main draft ready. Read and edit it before choosing platforms.");
    return true;
  }
  function documentSnapshot() {
    return { id: crypto.randomUUID(), title: mainRef.current?.title ?? "", content: mainRef.current?.content ?? "",
      revision: mainRef.current?.revision ?? 0, formatJson: mainRef.current?.formatJson };
  }
  function receiveSuggestion(data: ReviewResponse) {
    if (!isReviewResponse(data) || !data.mainDraft?.content.trim()) {
      setNotice("No usable suggestion was returned. Your document is unchanged.");
      updateChat({ ...chatRef.current, pending: undefined });
      return false;
    }
    const current = chatRef.current;
    updateChat({ ...current, pending: undefined,
      proposal: { ...(current.pending ?? documentSnapshot()), reviewJson: JSON.stringify(data) },
      messages: [...current.messages, { id: crypto.randomUUID(), role: "assistant", content: "Your suggested changes are ready. Review the proposal, then apply or discard it." }],
    });
    setNotice(""); setStep("review");
    return true;
  }
  const setChatInput = (input: string) => {
    if (!persistence.ready) return;
    updateChat({ ...chatRef.current, input: input.slice(0, 4000) });
  };
  const setChatReferences = (urls: string[]) => {
    if (sourceLocked() || chatRef.current.pending || !persistence.ready) return;
    const unique = [...new Set(urls)];
    if (unique.length > MAX_CREATION_REFERENCES) { setNotice(`Choose up to ${MAX_CREATION_REFERENCES} articles for one suggestion.`); return; }
    if (unique.some(url => !publicSourceUrl(url))) { setNotice("Choose articles with valid public URLs."); return; }
    updateChat({ ...chatRef.current, referenceUrls: unique });
  };
  const suggest = async (retry = false) => {
    if (!persistence.ready || scopeRef.current !== renderScope || lifetime.current.signal.aborted ||
      generationLock.current || batchLock.current || saving || uploading || generation.pending) return;
    if (!retry && (generation.hasActiveRequest() || chatRef.current.pending || chatRef.current.proposal)) return;
    const instruction = chatRef.current.input.trim();
    if (!retry && !instruction) return;
    if (!retry && chatRef.current.messages.length > 96) { setNotice("This conversation is full. Start a new creation to continue."); return; }
    const document = mainRef.current;
    const sourceUrls = chatRef.current.referenceUrls;
    const content = (document?.review?.article.content ?? document?.content ?? manual.content) || instruction;
    if (!retry && !sourceUrls.length && !publicSourceUrl(url) && content.trim().length < 20) {
      setNotice("Attach articles or provide an idea with at least 20 characters."); return;
    }
    if (!retry) updateChat({ ...chatRef.current, input: "", pending: documentSnapshot(),
      messages: [...chatRef.current.messages, { id: crypto.randomUUID(), role: "user", content: instruction }] });
    mainAttempt.current = true; generationLock.current = true; setNotice("");
    try {
      const common = { stage: "main", selectedPlatforms: [], tones: [tone], format, instruction,
        currentDraft: document?.content };
      const fromUrl = !sourceUrls.length && mode === "article" && publicSourceUrl(url);
      const data = retry ? await generation.retry() : fromUrl
        ? await generation.generate("/api/instant-review/selected", { ...common, url: fromUrl })
        : await generation.generate("/api/instant-review/manual", { ...common, title: document?.title.trim() || manual.title.trim() || "Untitled draft",
          content: content.slice(0, 24_000), media: document?.review?.article.media ?? manual.media,
          ...(sourceUrls.length ? { sourceUrls } : {}),
          sourceUrl: publicSourceUrl(document?.review?.article.url ?? ""), sourceLabel: document?.review?.article.source,
        });
      if (scopeRef.current !== renderScope || lifetime.current.signal.aborted) return;
      if (data && !generation.reattached) receiveSuggestion(data);
      else if (!data && !generation.hasActiveRequest()) updateChat({ ...chatRef.current, pending: undefined,
        messages: [...chatRef.current.messages, { id: crypto.randomUUID(), role: "assistant", content: "No changes were applied. Check the generation status before trying another suggestion." }] });
    } finally {
      generationLock.current = false;
      if (!generation.hasActiveRequest()) mainAttempt.current = false;
    }
  };
  const proposalStale = Boolean(chat.proposal && (chat.proposal.revision !== (main?.revision ?? 0) ||
    chat.proposal.title !== (main?.title ?? "") || chat.proposal.content !== (main?.content ?? "") || chat.proposal.formatJson !== main?.formatJson));
  const applySuggestion = () => {
    const proposal = chatRef.current.proposal;
    if (!proposal || sourceLocked()) return;
    if (proposal.revision !== (mainRef.current?.revision ?? 0) || proposal.title !== (mainRef.current?.title ?? "") || proposal.content !== (mainRef.current?.content ?? "") || proposal.formatJson !== mainRef.current?.formatJson) {
      setNotice("Your document changed after this suggestion. Discard it and request a fresh revision; your edits were not overwritten."); return;
    }
    const review = storedReview(proposal.reviewJson);
    if (acceptMain(review, proposal.revision > 0 ? proposal.title : review.article.title)) updateChat({ ...chatRef.current, proposal: undefined,
      messages: [...chatRef.current.messages, { id: crypto.randomUUID(), role: "assistant", content: "Changes applied to your document. Existing platform versions may need regenerating." }] });
  };
  const discardSuggestion = () => {
    if (sourceLocked()) return;
    updateChat({ ...chatRef.current, proposal: undefined, pending: undefined,
      messages: [...chatRef.current.messages, { id: crypto.randomUUID(), role: "assistant", content: "Suggestion discarded. Your document is unchanged." }] });
    setNotice("");
  };
  const generateMain = async (retry = false) => {
    if (!persistence.ready || sourceLocked() && !(retry && generation.recoverable && !generation.pending) || !retry && !inputReady) return;
    if (!retry && mainRef.current && !window.confirm("Regenerate the main draft and replace its edits? Existing platform versions will be kept and marked out of date.")) return;
    mainAttempt.current = true; generationLock.current = true;
    setNotice("");
    try {
      const data = retry ? await generation.retry() : await generation.generate(mode === "manual" ? "/api/instant-review/manual" : "/api/instant-review/selected",
        { ...(mode === "manual" ? manual : { url: url.trim() }), stage: "main", selectedPlatforms: [], tones: [tone], format });
      if (scopeRef.current === renderScope && !lifetime.current.signal.aborted && data && !generation.reattached) acceptMain(data);
    } finally { generationLock.current = false; if (!generation.hasActiveRequest()) mainAttempt.current = false; }
  };
  const acceptResult = (data: ReviewResponse, snapshot: { platform: string; tone: CreateTone; inboxItemId?: string; main?: MainDraft }) => {
    const content = data?.posts?.[snapshot.platform]?.[snapshot.tone];
    if (!reviewMetadataSchema.safeParse(data).success || typeof content !== "string" ||
      content.trim() && !usablePost(content, Math.min(5000, getPlatformMeta(snapshot.platform).charLimit), snapshot.platform)) {
      setGenerationErrors(current => ({ ...current, [versionKey(snapshot.platform, snapshot.tone)]: "This attempt returned no usable text; previous versions were kept." }));
      setNotice("No usable text was returned. Your previous versions are unchanged."); return false;
    }
    // Accept only the requested platform and tone, even if the response contains others.
    updateVersions(current => {
      const next = applyReview(current, { ...data, posts: { [snapshot.platform]: { [snapshot.tone]: content } } }, snapshot.inboxItemId);
      const key = versionKey(snapshot.platform, snapshot.tone);
      if (next[key] && content.trim()) next[key] = { ...next[key], mainRevision: snapshot.main?.revision };
      return next;
    });
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
      (!retry && (!mainReviewed || generation.hasActiveRequest()))) return false;
    if (!platforms.some(value => value.value === snapshot.platform)) return;
    const existing = versionsRef.current[versionKey(snapshot.platform, snapshot.tone)];
    if (!retry && confirmOverwrite && existing && isEdited(existing) &&
      !window.confirm("Regenerate this post and overwrite your edits? Other platforms and tones stay unchanged. Existing text is kept if generation fails.")) return;
    generationLock.current = true; lastGeneration.current = snapshot; setNotice("");
    markAttempted(snapshot);
    let succeeded = false;
    try {
      const reviewed = snapshot.main;
      if (!retry && (!reviewed || reviewed.revision !== reviewedRef.current)) return false;
      const data = retry ? await generation.retry() : await generation.generate("/api/instant-review/manual", {
        title: reviewed!.title, content: reviewed!.content, media: reviewed!.review?.article.media ?? manual.media,
        sourceUrl: publicSourceUrl(reviewed!.review?.article.url ?? ""), sourceLabel: reviewed!.review?.article.source,
        stage: "platform", selectedPlatforms: [snapshot.platform], tones: [snapshot.tone], format: supportsArticle(snapshot.platform) ? snapshot.format : "short-post",
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
    if (retry && mainAttempt.current) {
      if (chatRef.current.pending) await suggest(true);
      else await generateMain(true);
      return;
    }
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
    return persistence.ready && mainReviewed && !generationBusy && !saveLocks.current.has(targetKey) && (generationStates[targetKey] !== "failed" || !attempt || sameInput(attempt, inputSnapshot()));
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
    if (!recovery || generationStartLocked() || !mainReviewed || !inputIsCurrent(recovery)) return;
    // The ledger, never the current platform selection, owns continuation.
    const targets = recovery.unattempted.filter(target => generationStatesRef.current[versionKey(target, recovery.tone)] === "not-attempted" && platforms.some(value => value.value === target));
    if (targets.some(target => saveLocks.current.has(versionKey(target, recovery.tone)))) return;
    if (targets.some(target => { const existing = versionsRef.current[versionKey(target, recovery.tone)]; return existing && isEdited(existing); }) &&
      !window.confirm("Generate the unattempted posts and overwrite their edits? Completed cards stay unchanged. Existing text is retained if generation fails.")) return;
    if (targets.length) await runBatch(recovery, targets);
  };
  const generateBatch = async (targets: string[]) => {
    if (!mainReviewed || !persistence.ready || generationStartLocked() || !inputIsCurrent(inputSnapshot())) return;
    if (batchRecoveryRef.current && batchRef.current.completed.length < batchRef.current.targets.length) { await continueBatch(); return; }
    const unique = [...new Set(targets)].filter(target => platforms.some(value => value.value === target)).slice(0, 4);
    if (!unique.length) return;
    if (unique.some(target => saveLocks.current.has(versionKey(target, tone)))) return;
    const edited = unique.some(target => {
      const existing = versionsRef.current[versionKey(target, tone)];
      return existing && isEdited(existing);
    });
    if (edited && !window.confirm("Regenerate the selected posts and overwrite your edits? Saved drafts keep their IDs; existing text is retained if generation fails.")) return;
    setStep("versions");
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
    if (onCreateRoute && persistence.ready && refreshOnArrival.current && !saveLocks.current.size && !generationBusy) {
      refreshOnArrival.current = false;
      Object.values(versionsRef.current).forEach(value => { if (value.savedId) void refreshVersion(value.platform, value.tone); });
    }
  }, [onCreateRoute, saving, scopeKey, generationBusy, persistence.ready]);
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
    if (sourceRef.current !== source || scopeRef.current !== renderScope || lifetime.current.signal.aborted || staleVersion(platformValue, toneValue) || versionLockReason(platformValue, toneValue) || !usable || !current || current.status === "saved" || draftSaveBlocked(current)) return;
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
    if (sourceRef.current !== source || scopeRef.current !== renderScope || staleVersion(platformValue, toneValue) || !usable || !target || versionLockReason(platformValue, toneValue)) return;
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
  return { step, goToStep, main, editMain, generateMain, mainReady, mainReviewed, choosePlatforms, staleVersion, persistence,
    sourceIdentity: source,
    chat, setChatInput, setChatReferences, suggest, editDocument, proposalReview, proposalStale, applySuggestion, discardSuggestion,
    canGenerateMain: persistence.ready && inputReady && !busy && !generation.recoverable,
    platforms, preferencesReady, preferencesError: profile.isError || integrations.isError,
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
    canUse, canUseVersion: (platformValue: string, toneValue: CreateTone, expectedVersion?: PostVersion) => { const target = versionsRef.current[versionKey(platformValue, toneValue)]; return mainReviewed && !staleVersion(platformValue, toneValue) && (!expectedVersion || target === expectedVersion) && !versionLockReason(platformValue, toneValue) && Boolean(target && usablePost(target.content, Math.min(5000, getPlatformMeta(platformValue).charLimit), platformValue)); }, prefill, prefillUrl, selectPasteUrl };
}
export type CreatePostComposer = ReturnType<typeof useCreatePostComposer>;