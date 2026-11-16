import { ApiError, apiRequest } from "@/lib/queryClient";
import { capturePublishingConsent } from "@shared/publishing-consent";
import type { Draft } from "@shared/schema";

/** LinkedIn-only composer contract. Server publishing policy remains authoritative for every action. */
export const LINKEDIN_CHARACTER_LIMIT = 3000;
export const UNDO_WINDOW_OPTIONS = [5, 10, 20, 30] as const;
export const DEFAULT_UNDO_SECONDS = 10;
const UNDO_KEY = "tsp:post-undo-seconds";

export type SavedDraft = Pick<Draft, "id" | "content"> & { updatedAt: string | null };
type DraftTone = "professional" | "authoritative" | "contrarian" | "ai-recommended";
export interface PublishResult { jobIds?: string[]; results?: Array<{ platform: string; status: string }>; status?: string; message?: string }

export function readUndoSeconds(): number {
  try {
    const value = Number(window.localStorage.getItem(UNDO_KEY));
    return (UNDO_WINDOW_OPTIONS as readonly number[]).includes(value) ? value : DEFAULT_UNDO_SECONDS;
  } catch { return DEFAULT_UNDO_SECONDS; }
}
export function storeUndoSeconds(seconds: number) {
  try { window.localStorage.setItem(UNDO_KEY, String(seconds)); } catch { /* Preference only. */ }
}

const revision = (value: unknown): string | null => value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
const toSaved = (draft: Draft): SavedDraft => ({ id: draft.id, content: draft.content, updatedAt: revision(draft.updatedAt) });

/** Create once, then revision-checked PATCHes; never overwrites a draft edited elsewhere. */
export async function saveLinkedInDraft(previous: SavedDraft | undefined, content: string, tone: DraftTone, inboxItemId?: string): Promise<SavedDraft> {
  if (!content.trim()) throw new Error("Write something before saving.");
  if (!previous) {
    return toSaved(await (await apiRequest("POST", "/api/drafts", { platform: "linkedin", tone, content, ...(inboxItemId ? { inboxItemId } : {}) })).json());
  }
  if (previous.content === content) return previous;
  return toSaved(await (await apiRequest("PATCH", `/api/drafts/${encodeURIComponent(previous.id)}`, {
    content, expectedContent: previous.content, expectedUpdatedAt: previous.updatedAt,
  })).json());
}

/** The Post click is the explicit approval of exactly this revision. */
export async function approveLinkedInDraft(draft: SavedDraft, requireReview: boolean): Promise<SavedDraft> {
  if (!requireReview) return draft;
  if (!draft.updatedAt) throw new Error("This draft has no saved revision yet. Save it and try again.");
  return toSaved(await (await apiRequest("POST", `/api/drafts/${encodeURIComponent(draft.id)}/approve-publishing`, { content: draft.content, updatedAt: draft.updatedAt })).json());
}

function consentFor(draft: SavedDraft) {
  const consent = capturePublishingConsent({ content: draft.content, updatedAt: draft.updatedAt }, null);
  if (!consent) throw new Error("The draft revision could not be confirmed. Reopen it and try again.");
  return consent;
}

/** Call only with the row returned by approveLinkedInDraft. */
export async function publishApprovedDraft(approved: SavedDraft): Promise<PublishResult> {
  return (await apiRequest("POST", `/api/drafts/${encodeURIComponent(approved.id)}/publish-now`, { consent: consentFor(approved) })).json();
}

/**
 * Only a 4xx (other than a timeout) proves publish-now was refused before admission. Network
 * failures and 5xx can follow a committed admission that the scheduler will still deliver.
 */
export function definitelyNotAdmitted(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
}

export async function scheduleLinkedInDraft(draft: SavedDraft, publishAt: Date, requireReview: boolean): Promise<void> {
  const approved = await approveLinkedInDraft(draft, requireReview);
  await apiRequest("POST", `/api/drafts/${encodeURIComponent(approved.id)}/schedule`, { publishAt: publishAt.toISOString(), platforms: ["linkedin"], consent: consentFor(approved) });
}

export async function cancelLinkedInSchedule(draftId: string): Promise<void> {
  await apiRequest("DELETE", `/api/drafts/${encodeURIComponent(draftId)}/schedule`);
}

/** Never claims publication without a provider outcome: queued and simulated are reported as such. */
export function postingOutcome(result: PublishResult): { tone: "success" | "info" | "error"; title: string; description: string } {
  const status = result.results?.find(item => item.platform === "linkedin")?.status ?? result.results?.[0]?.status;
  if (result.jobIds?.length) return { tone: "info", title: "Sending to LinkedIn", description: "Your post is queued. Check Posted for the delivery result." };
  if (status === "published") return { tone: "success", title: "Posted to LinkedIn", description: "LinkedIn returned a post receipt. Find it in Posted." };
  if (status === "simulated") return { tone: "info", title: "Simulated — nothing was posted", description: "Publishing is in sandbox mode, so LinkedIn was not contacted." };
  if (status === "failed" || status === "skipped") return { tone: "error", title: "Not posted", description: "LinkedIn did not accept the post. Your draft is kept in Drafts." };
  return { tone: "error", title: "Delivery not confirmed", description: "Check Posted before trying again so the post is not duplicated." };
}

/** 9:00 local time on the next day, or the next weekday when weekdays only. */
export function nextMorning(now: Date, weekdaysOnly = false, hour = 9): Date {
  const date = new Date(now);
  date.setHours(hour, 0, 0, 0);
  do date.setDate(date.getDate() + 1);
  while (weekdaysOnly && (date.getDay() === 0 || date.getDay() === 6));
  return date;
}

export function scheduleLabel(date: Date, locale?: string): string {
  return date.toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export interface ComposeSource { id: string; headline: string; source: string; articleUrl: string }

/** One LinkedIn post, no platform adaptation stage. Manual ideas need enough substance to write from. */
export function generationRequest(input: { source?: ComposeSource; angle: string; take: string; toneKey: string }):
  { endpoint: string; body: Record<string, unknown> } | { error: string } {
  const context = [input.angle.trim() && `Angle: ${input.angle.trim()}`, input.take.trim() && `My take: ${input.take.trim()}`].filter(Boolean).join("\n");
  const common = { selectedPlatforms: ["linkedin"], tones: [input.toneKey], format: "short-post", ...(context ? { userContext: context.slice(0, 4000) } : {}) };
  if (input.source) return { endpoint: "/api/instant-review/selected", body: { ...common, url: input.source.articleUrl } };
  const idea = [input.angle.trim(), input.take.trim()].filter(Boolean).join("\n\n");
  if (idea.length < 20) return { error: "Describe your idea in at least 20 characters, or start from a story." };
  return { endpoint: "/api/instant-review/manual", body: { ...common, title: (input.angle.trim() || "LinkedIn post").slice(0, 200), content: idea.slice(0, 20_000) } };
}
