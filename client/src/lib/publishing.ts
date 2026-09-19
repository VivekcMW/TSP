import type { Draft, UserProfile } from "@shared/schema";
import { PLATFORMS } from "./platforms";
import { apiRequest, queryClient } from "./queryClient";
import { DIRECT_PUBLISH_PLATFORMS, publishingCapability } from "@shared/publishing-capabilities";
export { DIRECT_PUBLISH_PLATFORMS } from "@shared/publishing-capabilities";

export interface ScheduleTarget { id: string; platform: string; status: string; lastError?: string | null; executionMode?: string | null; revision?: number; receiptKind?: string | null; providerPostId?: string | null; }
export interface PublishingSchedule {
  id: string;
  draftId: string;
  scheduledPublishAt: string;
  status: string;
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

type ReadinessDraft = Pick<Draft, "content" | "platformPublishRules"> & Partial<Pick<Draft, "media" | "publishApprovedAt">>;
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
  const limit = Math.min(capability.maxCharacters, rule?.maxCharacters ?? Infinity);
  if (draft.content.length > limit) return `Too long: ${draft.content.length}/${limit} characters.`;
  if (rule?.minCharacters != null && draft.content.length < rule.minCharacters) return `Needs at least ${rule.minCharacters} characters.`;
  if ((draft.media?.length ?? 0) > capability.maxMedia || draft.media?.some(item => !capability.mediaTypes.some(mime => mime.startsWith(`${item.type}/`)))) return "Attached media is unsupported by this publishing adapter.";
  if (data.profile.requirePublishReview && !draft.publishApprovedAt) return "Review and approve this exact draft in Publishing options first.";
  return null;
}

export function defaultSchedulePlatforms(draft: Pick<Draft, "platform" | "content" | "platformPublishRules"> | undefined, data: ReadinessData): string[] {
  if (!draft) return [];
  const preferred = data.profile?.defaultPlatform;
  if (preferred && !publishingBlocker(preferred, draft, data)) return [preferred];
  return !publishingBlocker(draft.platform, draft, data) ? [draft.platform] : [];
}

export function selectionBlockers(platforms: string[], draft: ReadinessDraft | undefined, data: ReadinessData) {
  const errors: string[] = [];
  if (!platforms.length) errors.push("Select at least one ready platform.");
  if (platforms.length > 4) errors.push("Select no more than 4 platforms.");
  for (const platform of platforms) {
    const reason = publishingBlocker(platform, draft, data);
    if (reason) errors.push(`${PLATFORMS.find((item) => item.value === platform)?.label ?? platform}: ${reason}`);
  }
  return errors;
}