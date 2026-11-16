import { track } from "@/lib/analytics-consent";

/**
 * LinkedIn Inbox funnel events (consent-gated through `track`, no-ops otherwise). Parameters
 * describe the action only — never text, names, URLs or anything a person typed.
 *
 * Funnel: story_opened → compose_opened → draft_saved → post_queued → post_result(published).
 */
export type InboxEvent =
  | "story_opened" | "compose_opened" | "draft_saved" | "post_queued" | "post_undone" | "post_result" | "post_scheduled"
  | "news_searched" | "search_followed" | "idea_drafted" | "feedback_given" | "feed_tuned" | "input_set_up";

export function trackInbox(event: InboxEvent, params: Record<string, string | number | boolean> = {}): void {
  try { track(`inbox_${event}`, params); } catch { /* Analytics must never break the workspace. */ }
}
