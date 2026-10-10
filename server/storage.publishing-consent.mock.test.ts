import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { drafts, draftSchedules, draftScheduleTargets, type Draft, type DraftSchedule, type DraftScheduleTarget } from "@shared/schema";
import { capturePublishingConsent, PublishingConsentError } from "@shared/publishing-consent";

const { transaction, policy } = vi.hoisted(() => ({ transaction: vi.fn(), policy: vi.fn() }));
vi.mock("./db", () => ({ db: { transaction } }));
vi.mock("./services/publishing-policy", () => ({ assertPublishingPolicy: policy, configuredPublishingMode: () => "sandbox", reviewFingerprint: () => "approved-B" }));
import { ScheduleConflictError, storage } from "./storage";

// Real repository and Drizzle SQL compilation, fake query/transaction boundary.
// No database, lock-contention proof, queue, worker or provider execution.
const query = vi.fn();
const database = drizzle({ query } as unknown as Pool);
const scope = { tenantId: "consent-tenant", userId: "owner" };
const when = new Date("2030-01-01T00:00:00.000Z");
let draft: Partial<Draft> | undefined;
let schedule: Partial<DraftSchedule> | undefined;
let targets: Partial<DraftScheduleTarget>[];
let liveReceipt: boolean;
let rolledBack: boolean;
const row = (table: PgTable, value: object) => Object.keys(getTableColumns(table)).map(key => {
  const item = (value as Record<string, unknown>)[key];
  return item instanceof Date ? item.toISOString().replace(/Z$/, "") : item ?? null;
});
const writes = () => query.mock.calls.filter(([config]) => /^(insert|update|delete)/.test(config.text));
const reviewed = () => capturePublishingConsent(draft as Draft, schedule ? { ...schedule, targets } as DraftSchedule & { targets: DraftScheduleTarget[] } : null)!;

beforeEach(() => {
  draft = { id: "d", ...scope, content: "A", platform: "linkedin", tone: "professional", status: "draft", publishStatus: "draft", updatedAt: when };
  schedule = undefined; targets = []; liveReceipt = false; rolledBack = false;
  policy.mockReset().mockResolvedValue(undefined);
  query.mockReset().mockImplementation(async (config, params) => {
    const text = config.text as string;
    if (/^(insert|update|delete)/.test(text)) return { rows: text.includes('"draft_schedules"') && schedule ? [row(draftSchedules, schedule)] : [] };
    if (text.includes('from "drafts"')) {
      const allowed = draft && params.includes(scope.tenantId) && params.includes(scope.userId);
      return { rows: allowed ? [[...row(drafts, draft!), ...(text.includes("liveReceipt") || text.includes("select 1 from draft_schedules s") ? [liveReceipt] : [])]] : [] };
    }
    if (text.includes('from "draft_schedules"')) return { rows: schedule ? [row(draftSchedules, schedule)] : [] };
    if (text.includes('from "draft_schedule_targets"')) return { rows: targets.map(target => row(draftScheduleTargets, target)) };
    return { rows: [] };
  });
  transaction.mockReset().mockImplementation(async callback => {
    try { return await callback(database); } catch (error) { rolledBack = true; throw error; }
  });
});
function scheduled() {
  schedule = { id: "s", draftId: "d", tenantId: scope.tenantId, status: "scheduled", scheduledPublishAt: when, updatedAt: when };
  targets = [{ id: "target-A", draftScheduleId: "s", tenantId: scope.tenantId, platform: "linkedin", status: "scheduled", revision: 0, updatedAt: when }];
  draft!.publishStatus = "scheduled";
}

describe("publishing consent under owner lock (mocked SQL)", () => {
  it.each(["review disabled", "B separately approved"])("rejects confirmed A after writer B even with %s", async approval => {
    const consent = reviewed();
    Object.assign(draft!, { content: "B", updatedAt: new Date(when.getTime() + 1),
      ...(approval === "B separately approved" ? { publishApprovalHash: "approved-B", publishApprovedAt: when } : {}) });
    await expect(storage.scheduleDraftPublish(scope, "d", when, ["linkedin"], "schedule", consent)).rejects.toBeInstanceOf(PublishingConsentError);
    expect(policy).not.toHaveBeenCalled(); expect(writes()).toEqual([]); expect(rolledBack).toBe(true);
    const [lock, params] = query.mock.calls.find(([config]) => config.text.endsWith("for update"))!;
    expect(lock.text).toMatch(/where .*"id" = .*"tenant_id" = .*"user_id" = .*for update$/);
    expect(params).toEqual(["d", scope.tenantId, scope.userId]);
  });
  it.each(["schedule", "publish"] as const)("rejects identical-text revision changes and exact whitespace changes for %s", async intent => {
    const consent = reviewed(); draft!.updatedAt = new Date(when.getTime() + 1);
    await expect(storage.scheduleDraftPublish(scope, "d", when, undefined, intent, consent)).rejects.toBeInstanceOf(PublishingConsentError);
    draft!.updatedAt = when; draft!.content = " A ";
    await expect(storage.scheduleDraftPublish(scope, "d", when, undefined, intent, consent)).rejects.toBeInstanceOf(PublishingConsentError);
    expect(writes()).toEqual([]); expect(policy).not.toHaveBeenCalled();
  });
  it("compares consent before reusing a due publish-now generation; approval of B cannot bypass it", async () => {
    scheduled(); const consent = reviewed();
    draft!.content = "B"; draft!.publishApprovedAt = when;
    await expect(storage.scheduleDraftPublish(scope, "d", when, undefined, "publish", consent)).rejects.toBeInstanceOf(PublishingConsentError);
    expect(writes()).toEqual([]); expect(policy).not.toHaveBeenCalled();
  });
  it.each(["target platform", "target generation", "target revision", "target status", "target time", "schedule time", "schedule revision", "schedule status", "added target"])("rejects rescheduling after changed %s even when draft revision is unchanged", async change => {
    scheduled(); const consent = reviewed();
    if (change === "target platform") targets[0].platform = "twitter";
    if (change === "target generation") targets[0].id = "target-B";
    if (change === "target revision") targets[0].revision = 1;
    if (change === "target status") targets[0].status = "queued";
    if (change === "target time") targets[0].updatedAt = new Date(when.getTime() + 1);
    if (change === "schedule time") schedule!.scheduledPublishAt = new Date(when.getTime() + 1);
    if (change === "schedule revision") schedule!.updatedAt = new Date(when.getTime() + 1);
    if (change === "schedule status") schedule!.status = "cancelled";
    if (change === "added target") targets.push({ ...targets[0], id: "extra", platform: "twitter" });
    await expect(storage.scheduleDraftPublish(scope, "d", when, undefined, "schedule", consent)).rejects.toBeInstanceOf(PublishingConsentError);
    expect(writes()).toEqual([]); expect(policy).not.toHaveBeenCalled();
  });
  it("null schedule and null revision are exact states, not wildcards", async () => {
    draft!.updatedAt = null; const consent = reviewed(); scheduled();
    await expect(storage.scheduleDraftPublish(scope, "d", when, undefined, "publish", consent)).rejects.toBeInstanceOf(PublishingConsentError);
    schedule = undefined; targets = []; draft!.updatedAt = when;
    await expect(storage.scheduleDraftPublish(scope, "d", when, undefined, "schedule", consent)).rejects.toBeInstanceOf(PublishingConsentError);
    expect(writes()).toEqual([]);
  });
  it("preserves a matching due generation after locked comparison and current policy, including nullable legacy timestamps", async () => {
    scheduled(); draft!.updatedAt = null;
    const result = await storage.scheduleDraftPublish(scope, "d", when, undefined, "publish", reviewed());
    expect(result.id).toBe("s"); expect(result.targets[0].id).toBe("target-A");
    expect(policy).toHaveBeenCalledExactlyOnceWith(expect.anything(), scope, expect.objectContaining({ content: "A" }), ["linkedin"], "publish", "sandbox");
    expect(writes()).toEqual([]);
  });
  it("allows an exactly reviewed reschedule, with owner lock and policy before the first mutation", async () => {
    scheduled();
    policy.mockImplementation(async () => {
      expect(query.mock.calls.some(([config]) => config.text.endsWith("for update"))).toBe(true);
      expect(writes()).toEqual([]);
    });
    await storage.scheduleDraftPublish(scope, "d", new Date(when.getTime() + 60_000), undefined, "schedule", reviewed());
    expect(policy).toHaveBeenCalledOnce();
    expect(writes()[0][0].text).toMatch(/^insert into "draft_schedules"/);
    expect(writes().some(([config]) => config.text.startsWith('delete from "draft_schedule_targets"'))).toBe(true);
    expect(writes().some(([config]) => config.text.startsWith('insert into "draft_schedule_targets"'))).toBe(true);
    expect(rolledBack).toBe(false);
  });
  it.each(["published", "unknown", "partial", "simulated", "accepted_unverified"])("keeps %s delivery non-replayable even with matching consent", async status => {
    scheduled(); schedule!.status = status;
    await expect(storage.scheduleDraftPublish(scope, "d", when, undefined, "publish", reviewed())).rejects.toBeInstanceOf(ScheduleConflictError);
    expect(writes()).toEqual([]);
  });
  it("allows trusted internal callers to omit consent without bypassing policy", async () => {
    scheduled();
    await storage.scheduleDraftPublish(scope, "d", when, undefined, "publish");
    expect(policy).toHaveBeenCalledOnce(); expect(writes()).toEqual([]);
  });
  it("does not compare or mutate an inaccessible owner row", async () => {
    await expect(storage.scheduleDraftPublish({ ...scope, userId: "other" }, "d", when, undefined, "publish", reviewed())).rejects.toThrow("Draft not found");
    expect(writes()).toEqual([]); expect(policy).not.toHaveBeenCalled();
  });
});

describe("exact detail query reuses receipt-aware projection (mocked SQL)", () => {
  it.each([false, true])("filters by ID before limit with tenant/owner predicates, live receipt = %s", async evidence => {
    draft!.publishStatus = "published"; draft!.publishedAt = when; liveReceipt = evidence;
    const [result] = await storage.getDrafts(scope, { id: "d", limit: 1 });
    expect(result.publishStatus).toBe(evidence ? "published" : "legacy_unverified");
    expect(result.publishedAt).toEqual(evidence ? when : null);
    const [config, params] = query.mock.calls[1];
    expect(config.text).toMatch(/where .*"drafts"\."tenant_id" = .*"drafts"\."user_id" = .*"drafts"\."id" = .*order by .*limit/);
    expect(config.text).toContain('s.draft_id = "drafts"."id"');
    expect(config.text).toContain("t.receipt_kind is distinct from 'provider_id'");
    for (const [column, value] of [["tenant_id", scope.tenantId], ["user_id", scope.userId], ["id", "d"]]) {
      const match = config.text.match(new RegExp('"drafts"\\."' + column + '" = \\$(\\d+)'));
      expect(match).not.toBeNull(); expect(params[Number(match![1]) - 1]).toBe(value);
    }
    expect(params[Number(config.text.match(/limit \$(\d+)/)![1]) - 1]).toBe(1);
    expect(writes()).toEqual([]);
  });
  it.each(["other owner", "other tenant"])("returns no projected detail for %s", async foreign => {
    expect(await storage.getDrafts({ ...scope, ...(foreign === "other owner" ? { userId: "other" } : { tenantId: "other" }) }, { id: "d", limit: 1 })).toEqual([]);
    expect(writes()).toEqual([]);
  });
});