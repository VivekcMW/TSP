import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
const m = vi.hoisted(() => ({
  results: [] as unknown[][], updates: [] as { table: string; data: unknown; where?: SQL }[], queries: [] as { table: string; where?: SQL }[],
  execute: vi.fn(), dispatch: vi.fn(), insert: vi.fn(), created: {} as Record<string, unknown>, updateResults: [] as unknown[][],
}));
vi.mock("../../db", () => {
  const select = () => {
    let table = ""; let where: SQL | undefined;
    const chain = {
      from(value: Parameters<typeof getTableName>[0]) { table = getTableName(value); return chain; },
      where(value: SQL) { where = value; return chain; },
      innerJoin() { return chain; }, leftJoin() { return chain; }, groupBy() { return chain; }, orderBy() { return chain; }, limit() { return chain; },
      then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        m.queries.push({ table, where }); return Promise.resolve(m.results.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  };
  const tx = { execute: m.execute, select,
    insert: () => ({ values: (data: unknown) => { m.insert(data); return { returning: async () => [m.created] }; } }),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (data: unknown) => ({ where: (where: SQL) => {
      m.updates.push({ table: getTableName(table), data, where });
      return {
        returning: async () => m.updateResults.shift() ?? [],
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
      };
    } }) }),
  };
  return { db: { ...tx, transaction: async (work: (value: typeof tx) => Promise<unknown>) => work(tx) } };
});
vi.mock("./index", async () => ({ emailTemplates: (await import("./templates")).emailTemplates, wrapEmail: (email: { html: string }) => email.html }));
vi.mock("./durable-dispatch", () => ({ dispatchDurableEmail: m.dispatch }));
import { confirmAnnouncement, prepareAnnouncement, runAnnouncementBatch, setAnnouncementPaused, sendAnnouncementTest } from "./announcements";
const content = { type: "product_update" as const, title: "A new feature", body: "<script>no execution</script>\n\nExplore the update.", actionLabel: "Explore", actionUrl: "https://example.invalid/update" };
const campaign = { id: "campaign", content, createdAt: new Date("2026-10-26T09:00:00Z"), status: "active" };
const recipient = { userId: "u", email: "reader@example.invalid", name: "Reader", verified: true };
beforeEach(() => {
  vi.clearAllMocks(); m.results = []; m.updateResults = []; m.updates = []; m.queries = []; m.created = { ...campaign, status: "draft" }; m.dispatch.mockResolvedValue("sent");
});
it("activates only the requested draft without sending during confirmation", async () => {
  m.updateResults = [[{ id: "campaign" }]];
  expect(await confirmAnnouncement("campaign")).toBe(true);
  expect(m.updates[0].data).toMatchObject({ status: "active", confirmedAt: expect.any(Date) });
  const guard = new PgDialect().sqlToQuery(m.updates[0].where!);
  expect(guard.sql).toContain('"email_campaigns"."status"');
  expect(guard.params).toEqual(["campaign", "draft"]);
  expect(m.queries).toEqual([]);
  expect(m.dispatch).not.toHaveBeenCalled();
});
it("acknowledges confirmation retries without resetting recipients or campaign progress", async () => {
  m.results = [[{ id: "campaign" }]];
  expect(await confirmAnnouncement("campaign")).toBe(true);
  expect(m.updates).toHaveLength(1);
  expect(m.updates[0].table).toBe("email_campaigns");
  expect(new PgDialect().sqlToQuery(m.updates[0].where!).params).toEqual(["campaign", "draft"]);
  expect(new PgDialect().sqlToQuery(m.queries[0].where!).params).toEqual(["campaign"]);
  expect(m.dispatch).not.toHaveBeenCalled();
});
it("rejects confirmation of a missing campaign", async () => {
  expect(await confirmAnnouncement("missing")).toBe(false);
  expect(m.dispatch).not.toHaveBeenCalled();
});
it("saves a draft and snapshots verified opted-in accounts once, not tenant memberships or client email addresses", async () => {
  m.results = [[{ value: 2 }]];
  const preview = await prepareAnnouncement("admin", content);
  expect(m.insert).toHaveBeenCalledWith({ createdBy: "admin", content });
  const snapshot = new PgDialect().sqlToQuery(m.execute.mock.calls[0][0]);
  expect(snapshot.sql).toContain("u.email_verified = true");
  expect(snapshot.sql).toContain("coalesce(p.product_updates, true) = true");
  expect(snapshot.sql).toContain("p.unsubscribed_at is null");
  expect(snapshot.sql).toContain("exists (select 1 from tenant_members");
  expect(snapshot.sql).toContain("t.status = 'active'");
  expect(preview.campaign.audienceCount).toBe(2);
  expect(preview.html).toContain("&lt;script&gt;");
  expect(preview.html).not.toContain("<script>");
  expect(m.dispatch).not.toHaveBeenCalled();
});
it.each(["product_update", "maintenance", "incident"] as const)("dispatches %s with stable account/campaign identity and records completion", async type => {
  m.results = [[{ ...campaign, content: { ...content, type } }], [recipient], [{ status: "active" }]];
  const connected = vi.fn();
  await runAnnouncementBatch(connected, Date.now() + 5000);
  expect(connected).toHaveBeenCalledOnce();
  expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type, userId: "u", recipient: "reader@example.invalid", dedupeKey: '["announcement-v1","campaign","u"]' }));
  expect(m.updates[0].data).toMatchObject({ outcome: "sent" });
  expect(m.updates[1].table).toBe("email_campaigns");
  expect(new PgDialect().sqlToQuery(m.updates[1].where!).sql).toContain("not exists");
});
it.each([null, "suppressed", "unknown", "failed"] as const)("retains the exact %s outcome instead of reporting successful sends", async outcome => {
  m.results = [[campaign], [recipient], [{ status: "active" }]]; m.dispatch.mockResolvedValue(outcome);
  await runAnnouncementBatch(async () => undefined, Date.now() + 5000);
  expect(m.updates[0].data).toMatchObject({ outcome });
});
it("retains retryable work after transport failure and does not send to unverified accounts", async () => {
  m.results = [[campaign], [recipient, { ...recipient, userId: "other", verified: false }], [{ status: "active" }], [{ status: "active" }]];
  m.dispatch.mockRejectedValue(new Error("transport unavailable"));
  await runAnnouncementBatch(async () => undefined, Date.now() + 5000);
  expect(m.dispatch).toHaveBeenCalledOnce();
  expect(m.updates[0].data).toMatchObject({ outcome: null });
  expect(m.updates[1].data).toMatchObject({ outcome: "suppressed" });
});
it("stops at the admission deadline and fails closed on scheduler lock loss", async () => {
  m.results = [[campaign]];
  await runAnnouncementBatch(async () => undefined, Date.now() - 1);
  expect(m.dispatch).not.toHaveBeenCalled();
  m.results = [[campaign], [recipient]];
  await expect(runAnnouncementBatch(async () => { throw new Error("lost lock"); }, Date.now() + 5000)).rejects.toThrow("lost lock");
  expect(m.dispatch).not.toHaveBeenCalled();
});
it("stops admitting recipients after a pause even when a batch already loaded its audience", async () => {
  m.results = [[campaign], [recipient, { ...recipient, userId: "second" }], [{ status: "active" }], [{ status: "paused" }]];
  await runAnnouncementBatch(async () => undefined, Date.now() + 5000);
  expect(m.dispatch).toHaveBeenCalledOnce();
  expect(new PgDialect().sqlToQuery(m.updates.at(-1)!.where!).params).toContain("active");
});
it.each([true, false])("changes pause state %s without resetting outcomes", async paused => {
  m.updateResults = [[{ id: "campaign" }]];
  expect(await setAnnouncementPaused("campaign", paused)).toBe(true);
  expect(m.updates[0].data).toEqual({ status: paused ? "paused" : "active" });
  expect(new PgDialect().sqlToQuery(m.updates[0].where!).params).toEqual(["campaign", paused ? "active" : "paused"]);
  expect(m.updates).toHaveLength(1);
});
it("treats repeated pauses idempotently and refuses to resume completed campaigns", async () => {
  m.results = [[{ status: "paused" }]];
  expect(await setAnnouncementPaused("campaign", true)).toBe(true);
  m.results = [[{ status: "completed" }]];
  expect(await setAnnouncementPaused("campaign", false)).toBe(false);
});
it("sends a stable test only to the authenticated actor, not the saved audience", async () => {
  m.results = [[{ content }]];
  expect(await sendAnnouncementTest("campaign", { id: "admin", email: "hello@thesocialpundit.com", name: "Admin" })).toBe("sent");
  expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({
    subject: expect.stringContaining("[TEST]"), userId: "admin", recipient: "hello@thesocialpundit.com", dedupeKey: '["announcement-test-v1","campaign","admin"]',
  }));
  expect(m.updates).toHaveLength(0);
});
