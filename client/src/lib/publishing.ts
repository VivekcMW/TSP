import type { Draft, UserProfile } from "@shared/schema";
import { platformTextValidation } from "@shared/editorial";
import { PLATFORMS } from "./platforms";
import { apiRequest, queryClient } from "./queryClient";
import { DIRECT_PUBLISH_PLATFORMS, publishingCapability } from "@shared/publishing-capabilities";
import type { ConsentScheduleSource } from "@shared/publishing-consent";
export { DIRECT_PUBLISH_PLATFORMS } from "@shared/publishing-capabilities";

export interface ScheduleTarget { id: string; platform: string; status: string; updatedAt?: string | null; lastError?: string | null; executionMode?: string | null; revision?: number; receiptKind?: string | null; providerPostId?: string | null; }
export interface PublishingSchedule {
  id: string;
  draftId: string;
  scheduledPublishAt: string;
  status: string;
  updatedAt?: string | null;
  lastError?: string | null;
  targets?: ScheduleTarget[];
  draft?: { content: string; platform: string } | null;
}

export function draftStatusGroup(status: string | null | undefined): "ready" | "scheduled" | "attention" | "published" {
  if (status === "draft") return "ready";
  if (["scheduled", "queued", "publishing"].includes(status ?? "")) return "scheduled";
  if (status === "published") return "published";
  return "attention"; // Includes partial, unknown, skipped and future server states.
}

export function publicationOutcome(schedule?: PublishingSchedule | null): "pending" | "published" | "simulated" | "attention" | "unknown" {
  if (!schedule) return "unknown";
  const states = schedule.targets?.map((target) => target.status) ?? [];
  if (!states.length) return "unknown"; // Legacy parent status alone is not delivery evidence.
  if (states.every(state => state === "simulated") && schedule.status === "simulated") return "simulated";
  if (["accepted_unverified", "manual_published", "unknown", "legacy_unverified"].includes(schedule.status) && states.includes(schedule.status)) return "attention";
  if (states.some((state) => !["scheduled", "queued", "publishing", "published", "failed", "cancelled", "simulated", "accepted_unverified", "manual_published", "unknown"].includes(state))) return "unknown";
  if (states.every((state) => state === "published") && schedule.status === "published") return "published";
  if (states.some((state) => ["scheduled", "queued", "publishing"].includes(state))) return "pending";
  // A mixed-time read is not a terminal failure (or evidence of success).
  // Reconcile until parent and targets agree; never synthesize a delivered parent.
  if (schedule.status === "failed" && states.includes("failed")) return "attention";
  // Older servers also used partial for a mixture of delivered and failed.
  if (schedule.status === "partial" && states.includes("published") && states.some((state) => state !== "published")) return "attention";
  if (schedule.status === "cancelled" && states.every((state) => state === "cancelled")) return "attention";
  return "unknown";
}

export function canChangeSchedule(schedule?: PublishingSchedule) {
  return !!schedule && schedule.status === "scheduled" && !!schedule.targets?.length &&
    schedule.targets.every((target) => ["scheduled", "queued", "failed", "cancelled"].includes(target.status));
}

export function publishingStatus(item: PublishingSchedule) {
  if (item.status === "cancelled") return { key: "cancelled", label: "Cancelled", className: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
  const outcome = publicationOutcome(item);
  if (outcome === "published") return { key: "published", label: "Published", className: "bg-success-subtle text-success", dot: "bg-success" };
  if (outcome === "simulated") return { key: "simulated", label: "Demo only", className: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
  if (item.targets?.some(target => ["failed", "unknown", "accepted_unverified", "legacy_unverified"].includes(target.status))) {
    return { key: "attention", label: "Needs attention", className: "bg-warning-subtle text-warning", dot: "bg-warning" };
  }
  if (outcome === "pending") return {
    key: "pending", label: item.targets?.some(target => target.status === "publishing") ? "Publishing" : "Scheduled",
    className: "bg-info-subtle text-info", dot: "bg-info",
  };
  return { key: "attention", label: "Check delivery", className: "bg-warning-subtle text-warning", dot: "bg-warning" };
}

// Paginate list views so older partial/unknown schedules retain recovery controls.
export async function fetchPublishingSchedules(signal?: AbortSignal): Promise<{ items: PublishingSchedule[] }> {
  const items: PublishingSchedule[] = [];
  for (let offset = 0; ; offset += 200) {
    const response = await apiRequest("GET", `/api/drafts/scheduled?limit=200&offset=${offset}`, undefined, { signal });
    const page = await response.json() as { items: PublishingSchedule[]; total?: number };
    if (!Array.isArray(page.items)) throw new Error("Schedule status is unavailable.");
    items.push(...page.items);
    if (page.items.length < 200 || (page.total !== undefined && items.length >= page.total)) return { items };
  }
}

export function invalidatePublishingQueries() {
  return queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/drafts") });
}

export async function fetchDraftDetails(draftId: string, signal?: AbortSignal): Promise<Draft> {
  const response = await apiRequest("GET", `/api/drafts/${encodeURIComponent(draftId)}/details`, undefined, { signal, cache: "no-store" });
  const draft = await response.json();
  if (draft?.id !== draftId || typeof draft.content !== "string" || typeof draft.platform !== "string" ||
    typeof draft.tone !== "string" || typeof draft.publishStatus !== "string" ||
    !(draft.updatedAt === null || typeof draft.updatedAt === "string" && Number.isFinite(Date.parse(draft.updatedAt)))) {
    throw new Error("Draft details could not be verified. Refresh before publishing.");
  }
  return draft;
}

export async function fetchDraftPublishStatus(draftId: string, signal?: AbortSignal): Promise<PublishingSchedule | undefined> {
  const response = await apiRequest("GET", `/api/drafts/${encodeURIComponent(draftId)}/publish-status`, undefined, { signal });
  const body = await response.json() as { schedule: PublishingSchedule | null };
  if (body.schedule === null) return undefined;
  if (body.schedule?.draftId !== draftId || !Array.isArray(body.schedule.targets)) throw new Error("Schedule status is unavailable.");
  return body.schedule;
}

// Recovery is separate from query invalidation: monitor outcomes themselves
// invalidate list queries, so subscribing to every invalidation would loop.
const recoveryListeners = new Set<(draftId: string) => void>();
export function subscribePublishingRecovery(listener: (draftId: string) => void) {
  recoveryListeners.add(listener);
  return () => { recoveryListeners.delete(listener); };
}
export function recheckPublishingRecovery(draftId: string) {
  for (const listener of recoveryListeners) listener(draftId);
}

// Actual implemented live adapters in server/services/publishers/index.ts,
// not the broad sandbox catalog. Application scheduling dispatches these same
// adapters; provider-native `schedule` capability is not required by our queue.
// /api/integrations DB rows omit capabilities, so catalog flags alone are unsafe.
export interface PublishingIntegration { key: string; enabled: boolean; capabilities?: string[]; }
export interface PublishingConnection {
  connected: boolean;
  assessment?: { canPublish: boolean; status: string; reason?: string };
}
export interface PublishingRule { platform: string; enabled: boolean; minCharacters?: number | null; maxCharacters?: number | null; }
export interface ReadinessData {
  profile?: UserProfile;
  integrations?: PublishingIntegration[];
  rules?: PublishingRule[];
  connections: Record<string, PublishingConnection | undefined>;
  unavailable?: boolean;
}

export type ReadinessDraft = Pick<Draft, "content" | "platformPublishRules"> & Partial<Pick<Draft, "media" | "publishApprovedAt">>;

export function publishingTextValidation(content: string, platform: string, data: ReadinessData) {
  const rule = data.rules?.find(item => item.platform === platform);
  const limit = publishingCapability(platform)?.maxCharacters ?? PLATFORMS.find(item => item.value === platform)?.charLimit ?? 5000;
  return platformTextValidation(content, platform, Math.min(limit, rule?.maxCharacters ?? Infinity), rule?.minCharacters ?? 1);
}

export function publishingBlocker(platform: string, draft: ReadinessDraft | undefined, data: ReadinessData): string | null {
  if (!(DIRECT_PUBLISH_PLATFORMS as readonly string[]).includes(platform)) return "Manual copy & open only; direct scheduling is not supported.";
  if (data.unavailable || !data.profile || !data.integrations || !data.rules) return "Publishing readiness is unavailable or still loading. Refresh to check again.";
  const integration = data.integrations.find((item) => item.key === platform);
  if (!integration?.enabled) return "Unavailable platform-wide.";
  if (integration.capabilities && !integration.capabilities.includes("publish")) return "Direct publishing is not supported.";
  if (!data.profile.enabledPlatforms?.includes(platform)) return "Disabled in your publishing preferences.";
  const connection = data.connections[platform];
  if (!connection) return "Connection readiness is unavailable or still loading.";
  if (!connection.connected || !connection.assessment?.canPublish || connection.assessment.status !== "connected") return connection.assessment?.reason || "Connect or reconnect this account before publishing.";
  const rule = data.rules.find((item) => item.platform === platform);
  if (rule?.enabled === false || draft?.platformPublishRules?.[platform] === false) return "Disabled by a publishing rule.";
  if (!draft?.content.trim()) return "Choose a draft with content.";
  const capability = publishingCapability(platform)!;
  const text = publishingTextValidation(draft.content, platform, data);
  if (text.error) return text.error;
  if ((draft.media?.length ?? 0) > capability.maxMedia || draft.media?.some(item => !capability.mediaTypes.some(mime => mime.startsWith(`${item.type}/`)))) return "Attached media is unsupported by this publishing adapter.";
  if (data.profile.requirePublishReview && !draft.publishApprovedAt) return "Review and approve this exact draft in Publishing options first.";
  return null;
}

/** Presentation grouping only; publishingBlocker still decides what can be scheduled. */
export function accountPublishingBlocker(platform: string, data: ReadinessData): string | null {
  if (!(DIRECT_PUBLISH_PLATFORMS as readonly string[]).includes(platform)) return "Manual copy & open only; direct scheduling is not supported.";
  if (data.unavailable || !data.profile || !data.integrations || !data.rules) return null;
  const integration = data.integrations.find((item) => item.key === platform);
  if (!integration?.enabled) return "Unavailable platform-wide.";
  if (integration.capabilities && !integration.capabilities.includes("publish")) return "Direct publishing is not supported.";
  if (!data.profile.enabledPlatforms?.includes(platform)) return "Disabled in your publishing preferences.";
  const connection = data.connections[platform];
  if (connection && (!connection.connected || !connection.assessment?.canPublish || connection.assessment.status !== "connected")) return connection.assessment?.reason || "Connect or reconnect this account before publishing.";
  if (data.rules.find((item) => item.platform === platform)?.enabled === false) return "Disabled by a publishing rule.";
  return null;
}

export function defaultSchedulePlatforms(draft: ReadinessDraft & Pick<Draft, "platform"> | undefined, data: ReadinessData): string[] {
  if (!draft) return [];
  // A saved destination is intent, not a hint. Never substitute the profile
  // default when it is blocked (including connection, review and manual-only).
  const destination = draft.platform || data.profile?.defaultPlatform;
  return destination && !publishingBlocker(destination, draft, data) ? [destination] : [];
}

/** In-memory consent identity; never persisted and never a server approval. */
export function scheduleConfirmationKey(draft: Pick<Draft, "id" | "updatedAt" | "content" | "media" | "platformPublishRules"> | undefined, platforms: string[], date: string, time: string, timeZone: string, schedule?: ConsentScheduleSource | null): string {
  return JSON.stringify([draft?.id, draft?.updatedAt, draft?.content, draft?.media, draft?.platformPublishRules, platforms, date, time, timeZone,
    schedule && [schedule.id, schedule.status, schedule.scheduledPublishAt, schedule.updatedAt,
      schedule.targets?.map(target => [target.id, target.platform, target.status, target.revision, target.updatedAt])]]);
}

export function selectionBlockers(platforms: string[], draft: ReadinessDraft | undefined, data: ReadinessData) {
  const errors: string[] = [];
  if (!platforms.length) errors.push("Select at least one ready platform.");
  if (platforms.length > 4) errors.push("Select no more than 4 platforms.");
  if (new Set(platforms).size !== platforms.length) errors.push("Select distinct platforms.");
  for (const platform of platforms) {
    const reason = publishingBlocker(platform, draft, data);
    if (reason) errors.push(`${PLATFORMS.find((item) => item.value === platform)?.label ?? platform}: ${reason}`);
  }
  return errors;
}