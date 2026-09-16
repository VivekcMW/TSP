import type { Draft, UserProfile } from "@shared/schema";
import { PLATFORMS } from "./platforms";
import { apiRequest, queryClient } from "./queryClient";

export interface ScheduleTarget { id: string; platform: string; status: string; lastError?: string | null; }
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

export function publicationOutcome(schedule?: PublishingSchedule | null): "pending" | "published" | "attention" | "unknown" {
  if (!schedule) return "unknown";
  const states = schedule.targets?.map((target) => target.status) ?? [];
  if (!states.length) return "unknown"; // Legacy parent status alone is not delivery evidence.
  if (states.some((state) => !["scheduled", "queued", "publishing", "published", "failed", "cancelled"].includes(state))) return "unknown";
  if (states.every((state) => state === "published") && schedule.status === "published") return "published";
  if (states.some((state) => ["scheduled", "queued", "publishing"].includes(state))) return "pending";
  return "attention";
}

export function canChangeSchedule(schedule?: PublishingSchedule) {
  return !!schedule && schedule.status === "scheduled" && !!schedule.targets?.length &&
    schedule.targets.every((target) => ["scheduled", "queued", "failed", "cancelled"].includes(target.status));
}

// No per-draft schedule GET exists. Paginate the existing endpoint so older
// partial/unknown schedules do not lose recovery controls at the first page cap.
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

// Actual implemented live adapters in server/services/publishers/index.ts,
// not the broad sandbox catalog. Application scheduling dispatches these same
// adapters; provider-native `schedule` capability is not required by our queue.
// /api/integrations DB rows omit capabilities, so catalog flags alone are unsafe.
export const DIRECT_PUBLISH_PLATFORMS = ["linkedin", "twitter", "bluesky", "mastodon", "telegram", "discord", "devto", "hashnode", "reddit"] as const;
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

export function publishingBlocker(platform: string, draft: Pick<Draft, "content" | "platformPublishRules"> | undefined, data: ReadinessData): string | null {
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
  const limit = Math.min(PLATFORMS.find((item) => item.value === platform)?.charLimit ?? 0, rule?.maxCharacters ?? Infinity);
  if (draft.content.length > limit) return `Too long: ${draft.content.length}/${limit} characters.`;
  if (rule?.minCharacters != null && draft.content.length < rule.minCharacters) return `Needs at least ${rule.minCharacters} characters.`;
  return null;
}

export function defaultSchedulePlatforms(draft: Pick<Draft, "platform" | "content" | "platformPublishRules"> | undefined, data: ReadinessData): string[] {
  if (!draft) return [];
  const preferred = data.profile?.defaultPlatform;
  if (preferred && !publishingBlocker(preferred, draft, data)) return [preferred];
  return !publishingBlocker(draft.platform, draft, data) ? [draft.platform] : [];
}

export function selectionBlockers(platforms: string[], draft: Pick<Draft, "content" | "platformPublishRules"> | undefined, data: ReadinessData) {
  const errors: string[] = [];
  if (!platforms.length) errors.push("Select at least one ready platform.");
  if (platforms.length > 4) errors.push("Select no more than 4 platforms.");
  for (const platform of platforms) {
    const reason = publishingBlocker(platform, draft, data);
    if (reason) errors.push(`${PLATFORMS.find((item) => item.value === platform)?.label ?? platform}: ${reason}`);
  }
  return errors;
}