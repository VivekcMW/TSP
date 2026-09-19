import type { InboxItem } from "./schema";

export const INBOX_CAPACITY = 10;
export const INBOX_CANDIDATE_LIMIT = 600;
export class InboxOperationConflictError extends Error {
  constructor() { super("Refresh operation does not match its original request."); }
}
export type InboxRefreshOutcome = "updated" | "capacity" | "no_new" | "needs_setup" | "failure";
export interface InboxRefreshResult {
  success: boolean;
  outcome: InboxRefreshOutcome;
  count: number;
  newInboxItems: number;
  articlesCreated: number;
  items: InboxItem[];
  activeCount: number;
  replacedCount: number;
  articlesProcessed: number;
  articlesMatched: number;
  durationMs: number;
  needsSetup?: boolean;
  errors?: string[];
  discoveryWarnings?: string[];
  message: string;
}
export interface InboxRefreshOptions { operationId?: string; autoRefresh?: boolean }
export type InboxRefreshSnapshot = Array<{ id: string; version: number }>;
export function inboxRefreshMessage(outcome: InboxRefreshOutcome, count = 0): string {
  switch (outcome) {
    case "updated": return `${count} new articles added.`;
    case "capacity": return "Your inbox is full. Save or dismiss articles before refreshing.";
    case "no_new": return "No new articles found. Your existing articles are unchanged.";
    case "needs_setup": return "Add interests or an active source to start discovering articles.";
    case "failure": return "Article fetching could not complete. Your inbox is unchanged. Please try again.";
  }
}