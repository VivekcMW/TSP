import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboxItem, UserProfile } from "@shared/schema";
import { supportsArticle, type EditorialFormat } from "@shared/editorial";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { getPlatformMeta, PLATFORMS } from "@/lib/platforms";
import { usablePost, type ReviewResponse } from "@/lib/editorial";
import { isUsableInboxArticle } from "@/lib/inbox-quality";
import { useEditorialGeneration } from "@/hooks/use-editorial-generation";
import { applyReview, CREATE_TONES, emptyArticle, isEdited, isUnsaved, publicSourceUrl, versionKey, type CreateTone, type ManualArticle, type PostVersions } from "./create-post-state";

/** Content stays in memory; only the scoped job/intent pointer survives reload. */
export function useCreatePostComposer(isOpen: boolean) {
  const client = useQueryClient();
  const { user } = useAuth();
  const profile = useQuery<UserProfile>({ queryKey: ["/api/profile"], enabled: isOpen });
  const integrations = useQuery<{ key: string; enabled: boolean }[]>({ queryKey: ["/api/integrations"], enabled: isOpen });
  const inbox = useQuery<InboxItem[]>({ queryKey: ["/api/inbox"], enabled: isOpen });
  const [platformChoice, setPlatform] = useState<string>();
  const [toneChoice, setTone] = useState<CreateTone>();
  const [format, setFormat] = useState<EditorialFormat>("short-post");
  const [mode, setMode] = useState<"url" | "article" | "manual">("url");
  const [url, setUrl] = useState("");
  const [item, setItem] = useState<InboxItem>();
  const [manual, setManual] = useState<ManualArticle>(emptyArticle());
  const [versions, setVersions] = useState<PostVersions>({});
  const versionsRef = useRef(versions);
  const [notice, setNotice] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const copyRevision = useRef(0);
  const saveLock = useRef(false);
  const generationLock = useRef(false);
  const lastGeneration = useRef<{ platform: string; tone: CreateTone; inboxItemId?: string }>();
  const generation = useEditorialGeneration<ReviewResponse>({
    scope: user?.id && profile.data?.tenantId ? { userId: user.id, tenantId: profile.data.tenantId } : undefined,
    onRecovered: data => {
      const recoveredPlatform = Object.keys(data?.posts ?? {})[0];
      const recoveredTone = CREATE_TONES.find(value => typeof data?.posts?.[recoveredPlatform]?.[value.key] === "string")?.key;
      if (!PLATFORMS.some(value => value.value === recoveredPlatform) || !recoveredTone) {
        setNotice("The recovered job returned no supported platform. Nothing was regenerated."); return;
      }
      const snapshot = { platform: recoveredPlatform, tone: recoveredTone };
      lastGeneration.current = snapshot;
      setPlatform(recoveredPlatform); setTone(recoveredTone);
      acceptResult(data, snapshot);
    },
  });
  const disabled = new Set((integrations.data ?? []).filter(value => !value.enabled).map(value => value.key));
  const preferencesReady = profile.isSuccess && integrations.isSuccess;
  const platforms = preferencesReady ? PLATFORMS.filter(value => (!profile.data?.enabledPlatforms || profile.data.enabledPlatforms.includes(value.value)) && !disabled.has(value.value)) : [];
  const preferred = platformChoice ?? profile.data?.defaultPlatform;
  const platform = platforms.some(value => value.value === preferred) ? preferred! : platforms[0]?.value ?? "";
  const tone = toneChoice ?? CREATE_TONES.find(value => value.value === profile.data?.defaultTone)?.key ?? "thoughtLeader";
  const effectiveFormat = supportsArticle(platform) ? format : "short-post";
  const key = versionKey(platform, tone);
  const version = versions[key];
  const sourceKey = JSON.stringify([mode, url, item?.id, manual]);
  const [savedSourceKey, setSavedSourceKey] = useState("");
  const hasInput = Boolean(url.trim() || manual.title.trim() || manual.content.trim() || manual.media.length);
  const dirty = (hasInput && sourceKey !== savedSourceKey) || Object.values(versions).some(isUnsaved);
  const busy = generation.pending || saving || uploading;
  const canGenerate = Boolean(platform) && !busy && !generation.recoverable && (mode === "manual"
    ? Boolean(manual.title.trim()) && manual.content.trim().length >= 20 && manual.content.length <= 20_000
    : Boolean(publicSourceUrl(url.trim())));
  const canUse = Boolean(platform && version && usablePost(version.content, Math.min(5000, getPlatformMeta(platform).charLimit), platform)) && !busy;

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

  const prefill = (next?: InboxItem) => {
    if (!next || next.id === item?.id && url === next.articleUrl) return true;
    if (busy || generation.recoverable) { setNotice("Finish, retry or cancel the current operation before changing stories."); return false; }
    if ((dirty || Object.keys(versionsRef.current).length > 0) && !window.confirm("Replace this creation session with the selected story? Unsaved versions will be discarded.")) return false;
    updateVersions(() => ({})); setItem(next); setUrl(next.articleUrl); setMode(next.articleUrl ? "article" : "manual");
    setManual(next.articleUrl ? emptyArticle() : { title: next.headline.slice(0, 200), content: next.summary ?? "", media: [] });
    setSavedSourceKey(""); setNotice(""); generation.reset();
    return true;
  };
  const acceptResult = (data: ReviewResponse, snapshot: { platform: string; tone: CreateTone; inboxItemId?: string }) => {
    const content = data?.posts?.[snapshot.platform]?.[snapshot.tone];
    if (!data?.article || typeof content !== "string") { setNotice("No usable text was returned. Your previous versions are unchanged."); return; }
    // Accept only the requested platform and tone, even if the response contains others.
    updateVersions(current => applyReview(current, { ...data, posts: { [snapshot.platform]: { [snapshot.tone]: content } } }, snapshot.inboxItemId));
    if (!content.trim()) setNotice("No usable text was returned. Your previous versions are unchanged.");
    else setNotice("Generation complete. Review and edit before saving; nothing has been published.");
  };
  const generate = async (retry = false) => {
    if (generationLock.current || saveLock.current || uploading || (!retry && !canGenerate)) return;
    if (retry && generation.reattached) { await generation.retry(); return; }
    const snapshot = retry ? lastGeneration.current : { platform, tone, inboxItemId: item?.articleUrl === url && mode !== "manual" ? item?.id : undefined };
    if (!snapshot || !platforms.some(value => value.value === snapshot.platform)) return;
    const existing = versionsRef.current[versionKey(snapshot.platform, snapshot.tone)];
    if (existing && isEdited(existing) &&
      !window.confirm("Regenerate this post and overwrite your edits? Other platforms and tones stay unchanged. Existing text is kept if generation fails.")) return;
    generationLock.current = true; lastGeneration.current = snapshot; setNotice("");
    try {
      const data = retry ? await generation.retry() : await generation.generate(mode === "manual" ? "/api/instant-review/manual" : "/api/instant-review/selected", {
        ...(mode === "manual" ? manual : { url: url.trim() }), selectedPlatforms: [snapshot.platform], tones: [snapshot.tone], format: effectiveFormat,
      });
      if (data) acceptResult(data, snapshot);
    } finally { generationLock.current = false; }
  };
  const edit = (content: string) => {
    if (busy || !version) return;
    updateVersions(current => ({ ...current, [key]: { ...current[key], content, error: undefined, status: current[key].savedId && content === current[key].savedContent ? "saved" : "unsaved" } }));
  };
  const save = async () => {
    const current = versionsRef.current[key];
    if (saveLock.current || generationLock.current || !canUse || !current) return;
    if (current.savedId && current.savedContent === current.content) return;
    saveLock.current = true; setSaving(true);
    updateVersions(all => ({ ...all, [key]: { ...current, status: "saving", error: undefined } }));
    try {
      const response = await apiRequest(current.savedId ? "PATCH" : "POST", current.savedId ? `/api/drafts/${encodeURIComponent(current.savedId)}` : "/api/drafts",
        current.savedId ? { content: current.content } : { platform: current.platform, tone: CREATE_TONES.find(value => value.key === current.tone)!.value,
          content: current.content, media: current.review.article.media ?? [], inboxItemId: current.inboxItemId });
      const saved = await response.json();
      if (typeof saved.id !== "string" || !saved.id) throw new Error("Save could not be confirmed. Check Content before trying again.");
      updateVersions(all => ({ ...all, [key]: { ...all[key], savedId: saved.id, savedContent: current.content, status: "saved", error: undefined } }));
      setSavedSourceKey(sourceKey);
      void client.invalidateQueries({ queryKey: ["/api/drafts"] });
    } catch (error) {
      updateVersions(all => ({ ...all, [key]: { ...all[key], status: "failed", error: `${error instanceof Error ? error.message : "Save failed"} Your text is retained. If the response was interrupted, check Content before retrying.` } }));
    } finally { saveLock.current = false; setSaving(false); }
  };
  const copy = async () => {
    if (!canUse || !version) return;
    const revision = ++copyRevision.current;
    setCopyStatus("");
    try { await navigator.clipboard.writeText(version.content); if (revision === copyRevision.current) setCopyStatus("Copied. Paste and publish manually; publication is not tracked here."); }
    catch { if (revision === copyRevision.current) setCopyStatus("Copy failed. Select and copy the text manually. Nothing was published."); }
  };
  return { platforms, preferencesReady, preferencesError: profile.isError || integrations.isError,
    retryPreferences: () => { void profile.refetch(); void integrations.refetch(); },
    inbox: (inbox.data ?? []).filter(isUsableInboxArticle), inboxLoading: inbox.isLoading, inboxError: inbox.isError, retryInbox: inbox.refetch,
    platform, setPlatform, tone, setTone, toneOptions: CREATE_TONES,
    hasVersion: (value: string, toneKey?: CreateTone) => Object.values(versions).some(version => version.platform === value && (!toneKey || version.tone === toneKey)), format: effectiveFormat, setFormat, mode, setMode, url, setUrl, item,
    manual, setManual, setUploading, versions, version, edit, generation, generate, save, copy, copyStatus, notice,
    dirty, busy, saving, canGenerate, canUse, prefill };
}
export type CreatePostComposer = ReturnType<typeof useCreatePostComposer>;