import { vi } from "vitest";
import { inboxRefreshMessage } from "@shared/inbox-refresh";
import { selectDiverse } from "../server/services/inboxDiversity";

/** Mock ONLY the storage boundary in engine/caller tests. Concurrency, history,
 * rollback and receipts are independently exercised against PostgreSQL. */
export function installInboxRefreshFixture(storage: Record<string, ReturnType<typeof vi.fn<(...args: any[]) => any>>>) {
  storage.beginInboxRefresh.mockResolvedValue({ snapshot: [], activeCount: 0 });
  storage.getInboxRefreshReceipt?.mockResolvedValue(undefined);
  storage.commitInboxRefresh.mockImplementation(async (scope, _operationId, _auto, _snapshot, candidates, metrics) => {
    const items = [];
    const fresh = [];
    for (const item of candidates) {
      if (await storage.getInboxItemByUrl(scope, item.articleUrl)) continue;
      fresh.push(item);
    }
    for (const item of selectDiverse(fresh, 10)) {
      items.push(await storage.createInboxItem(scope, item));
    }
    const outcome = items.length ? "updated" : metrics.needsSetup ? "needs_setup" : "no_new";
    return { ...metrics, success: true, outcome, count: items.length, newInboxItems: items.length,
      articlesCreated: items.length, items, activeCount: items.length, replacedCount: 0,
      message: inboxRefreshMessage(outcome, items.length) };
  });
}