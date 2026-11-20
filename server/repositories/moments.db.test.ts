import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { auditLog, inboxItems, industryMoments, tenantMembers, tenants, userProfiles, users, userWatchlists, watchAlerts } from "@shared/schema";
import type { MomentInput } from "@shared/moments";
import type { TenantScope } from "../storage";

// Opt-in AFTER migration 0063 is applied to the explicit local test database:
// env -u DATABASE_URL -u OWNER_DATABASE_URL PHASE5_DB_TESTS=true pnpm exec vitest run server/repositories/moments.db.test.ts
const enabled = process.env.PHASE5_DB_TESTS === "true";

describe.skipIf(!enabled)("moments and watch alerts PostgreSQL repositories (0063 prerequisite)", () => {
  let app: typeof import("../db");
  let owner: typeof import("../../test/db-owner");
  let moments: typeof import("./moments");
  let alerts: typeof import("./watchAlerts");
  const tenantIds: string[] = [], userIds: string[] = [], momentIds: string[] = [];
  const marker = `P5 fixture ${randomUUID().slice(0, 8)}`;
  let scope: TenantScope;
  let admin: string;

  const input = (overrides: Partial<MomentInput> = {}): MomentInput => ({ title: `${marker} budget`, startsOn: "2031-02-01", endsOn: null,
    region: "global", tags: ["finance"], leadDays: 14, url: null, description: null, ...overrides });

  async function makeScope(existing: Partial<TenantScope> = {}): Promise<TenantScope> {
    const userId = existing.userId ?? randomUUID(), tenantId = existing.tenantId ?? randomUUID();
    if (!existing.userId) { await owner.ownerDb.insert(users).values({ id: userId, email: `${userId}@phase5.test` }); userIds.push(userId); }
    if (!existing.tenantId) { await owner.ownerDb.insert(tenants).values({ id: tenantId, kind: "corporate", name: "Phase 5 fixture" }); tenantIds.push(tenantId); }
    await owner.ownerDb.insert(tenantMembers).values({ tenantId, userId, role: "member" });
    await owner.ownerDb.insert(userProfiles).values({ tenantId, userId, companies: ["Zeta", "Acme Bank"], influencers: ["Satya Nadella"],
      keywords: [{ keyword: "Retail media", weight: 0.9 }] });
    return { tenantId, userId };
  }
  async function story(target: TenantScope, headline: string) {
    const [row] = await owner.ownerDb.insert(inboxItems).values({ ...target, headline, source: "Wire", articleUrl: `https://news.test/${randomUUID()}`, status: "active" }).returning();
    return row;
  }
  const actor = () => ({ userId: admin, platformRole: "platform_admin", reason: "Phase 5 DB test" });

  beforeAll(async () => {
    const target = requireLocalTestDatabase();
    app = await import("../db");
    owner = await import("../../test/db-owner");
    moments = await import("./moments");
    alerts = await import("./watchAlerts");
    expect((await app.pool.query("select current_user, current_database(), rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0])
      .toEqual({ current_user: "tsp_app", current_database: target.database, rolbypassrls: false, rolsuper: false });
    const ready = await app.pool.query(`select to_regclass('public.industry_moments') is not null as moments,
      to_regclass('public.watch_alerts') is not null as alerts, to_regclass('public.user_watchlists') is not null as watchlists`);
    expect(ready.rows[0]).toEqual({ moments: true, alerts: true, watchlists: true });
    admin = randomUUID();
    await owner.ownerDb.insert(users).values({ id: admin, email: `${admin}@phase5-admin.test` });
    userIds.push(admin);
  });
  beforeEach(async () => { scope = await makeScope(); });
  afterEach(async () => {
    if (momentIds.length) {
      await owner.ownerDb.delete(auditLog).where(inArray(auditLog.resourceId, momentIds));
      await owner.ownerDb.delete(industryMoments).where(inArray(industryMoments.id, momentIds));
      momentIds.length = 0;
    }
    if (tenantIds.length) {
      await owner.ownerDb.delete(watchAlerts).where(inArray(watchAlerts.tenantId, tenantIds));
      await owner.ownerDb.delete(userWatchlists).where(inArray(userWatchlists.tenantId, tenantIds));
      await owner.ownerDb.delete(inboxItems).where(inArray(inboxItems.tenantId, tenantIds));
      await owner.ownerDb.delete(userProfiles).where(inArray(userProfiles.tenantId, tenantIds));
      await owner.ownerDb.delete(tenantMembers).where(inArray(tenantMembers.tenantId, tenantIds));
      await owner.ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
      tenantIds.length = 0;
    }
  });
  afterAll(async () => {
    if (userIds.length) await owner?.ownerDb.delete(users).where(inArray(users.id, userIds));
    await app?.pool.end(); await owner?.ownerPool.end();
  });

  describe("industry moments (global)", () => {
    it("rejects writes from the app role outside the admin transaction, but anyone can read", async () => {
      await expect(app.pool.query("insert into industry_moments (title, starts_on) values ($1, '2031-01-01')", [`${marker} direct`])).rejects.toThrow(/row-level security/);
      const created = await moments.createMoment(input(), actor());
      momentIds.push(created.id);
      const updated = await app.pool.query("update industry_moments set title = 'hijacked' where id = $1", [created.id]);
      expect(updated.rowCount).toBe(0);
      await expect(app.pool.query("delete from industry_moments where id = $1", [created.id])).rejects.toThrow(/permission denied/);
      // Readable without any tenant context.
      const read = await app.pool.query("select title from industry_moments where id = $1", [created.id]);
      expect(read.rows).toEqual([{ title: `${marker} budget` }]);
    });

    it("creates, edits, archives and unarchives with an audit entry per change", async () => {
      const created = await moments.createMoment(input({ tags: ["finance", "tax"], url: "https://example.test/budget" }), actor());
      momentIds.push(created.id);
      expect(created).toMatchObject({ title: `${marker} budget`, startsOn: "2031-02-01", tags: ["finance", "tax"], archived: false });
      const edited = await moments.updateMoment(created.id, input({ endsOn: "2031-02-03", region: "IN" }), actor());
      expect(edited).toMatchObject({ endsOn: "2031-02-03", region: "IN" });
      expect((await moments.setMomentArchived(created.id, true, actor())).archived).toBe(true);
      expect((await moments.setMomentArchived(created.id, false, actor())).archived).toBe(false);
      const entries = await owner.ownerDb.select().from(auditLog).where(eq(auditLog.resourceId, created.id)).orderBy(auditLog.createdAt);
      expect(entries.map(entry => entry.action)).toEqual(["industry_moment.create", "industry_moment.update", "industry_moment.archive", "industry_moment.unarchive"]);
      expect(entries.every(entry => entry.actorUserId === admin && entry.justification === "Phase 5 DB test" && entry.tenantId === null)).toBe(true);
      await expect(moments.updateMoment(randomUUID(), input(), actor())).rejects.toBeInstanceOf(moments.MomentNotFoundError);
    });

    it("enforces dates, lead days and tag limits in the database too", async () => {
      await expect(moments.createMoment(input({ endsOn: "2031-01-01" }), actor())).rejects.toThrow();
      await expect(moments.createMoment(input({ leadDays: 91 }), actor())).rejects.toThrow();
      await expect(moments.createMoment(input({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }), actor())).rejects.toThrow();
    });

    it("finds overlapping, non-archived moments and filters the admin list", async () => {
      const ids = await Promise.all([
        moments.createMoment(input({ title: `${marker} past`, startsOn: "2020-01-01" }), actor()),
        moments.createMoment(input({ title: `${marker} spans`, startsOn: "2031-01-28", endsOn: "2031-02-05" }), actor()),
        moments.createMoment(input({ title: `${marker} later`, startsOn: "2031-06-01" }), actor()),
        moments.createMoment(input({ title: `${marker} archived`, startsOn: "2031-02-02" }), actor()),
      ]);
      momentIds.push(...ids.map(row => row.id));
      await moments.setMomentArchived(ids[3].id, true, actor());
      const found = (await moments.findMomentsBetween("2031-02-01", "2031-03-01")).filter(row => row.title.startsWith(marker));
      expect(found.map(row => row.title)).toEqual([`${marker} spans`]);
      const titles = async (filter: "upcoming" | "past" | "archived") =>
        (await moments.listAdminMoments(filter, "2026-11-16")).map(row => row.title).filter(title => title.startsWith(marker));
      expect(await titles("upcoming")).toEqual([`${marker} spans`, `${marker} later`]);
      expect(await titles("past")).toEqual([`${marker} past`]);
      expect(await titles("archived")).toEqual([`${marker} archived`]);
    });
  });

  describe("watchlists and watch alerts (tenant data)", () => {
    it("saves only profile terms and keeps each member's watchlist private", async () => {
      await expect(alerts.saveWatchlist(scope, [{ kind: "company", term: "Unknown Co" }])).rejects.toBeInstanceOf(alerts.WatchlistTermError);
      const saved = await alerts.saveWatchlist(scope, [{ kind: "company", term: "zeta" }, { kind: "person", term: "Satya Nadella" }]);
      expect(saved.terms).toEqual([{ kind: "company", term: "Zeta" }, { kind: "person", term: "Satya Nadella" }]);
      expect((await alerts.getWatchlist(scope)).terms).toEqual(saved.terms);
      const colleague = await makeScope({ tenantId: scope.tenantId });
      expect((await alerts.getWatchlist(colleague)).terms).toEqual([]);
      const stranger = await makeScope();
      const leaked = await app.db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.tenant_id', ${stranger.tenantId}, true)`);
        return tx.select().from(userWatchlists);
      });
      expect(leaked).toEqual([]);
    });

    it("records deduped alerts for admitted stories, lists unseen first and marks them seen", async () => {
      await alerts.saveWatchlist(scope, [{ kind: "company", term: "Zeta" }, { kind: "person", term: "Satya Nadella" }]);
      const first = await story(scope, "Zeta hires Satya Nadella");
      const second = await story(scope, "Quiet day");
      const third = await story(scope, "Zeta again");
      expect(await alerts.recordWatchAlerts(scope, [first, second])).toBe(2);
      expect(await alerts.recordWatchAlerts(scope, [first])).toBe(0);
      expect(await alerts.recordWatchAlerts(scope, [third])).toBe(1);
      let list = await alerts.listWatchAlerts(scope);
      expect(list[0]).toMatchObject({ headline: "Zeta again", term: "Zeta", kind: "company", seenAt: null, inboxItemId: third.id });
      expect(list.slice(1).map(row => row.term).sort()).toEqual(["Satya Nadella", "Zeta"]);
      expect(await alerts.markWatchAlertsSeen(scope, [list[0].id])).toBe(1);
      list = await alerts.listWatchAlerts(scope);
      expect(list.at(-1)?.headline).toBe("Zeta again");
      expect(list.at(-1)?.seenAt).not.toBeNull();
      expect(await alerts.markWatchAlertsSeen(scope)).toBe(2);
      expect((await alerts.listWatchAlerts(scope)).every(row => row.seenAt)).toBe(true);
    });

    it("never records alerts for another member's stories or shows them across tenants", async () => {
      await alerts.saveWatchlist(scope, [{ kind: "company", term: "Zeta" }]);
      const colleague = await makeScope({ tenantId: scope.tenantId });
      const theirs = await story(colleague, "Zeta news for the colleague");
      expect(await alerts.recordWatchAlerts(scope, [theirs])).toBe(0);
      const stranger = await makeScope();
      await alerts.saveWatchlist(stranger, [{ kind: "company", term: "Zeta" }]);
      const strangers = await story(stranger, "Zeta news elsewhere");
      expect(await alerts.recordWatchAlerts(stranger, [strangers])).toBe(1);
      expect(await alerts.listWatchAlerts(scope)).toEqual([]);
      expect(await alerts.markWatchAlertsSeen(scope)).toBe(0);
      expect((await alerts.listWatchAlerts(stranger))[0].seenAt).toBeNull();
    });

    it("claims an email batch once per slot, retries the open slot and closes it", async () => {
      await alerts.saveWatchlist(scope, [{ kind: "company", term: "Zeta" }]);
      await alerts.recordWatchAlerts(scope, [await story(scope, "Zeta one"), await story(scope, "Zeta two")]);
      expect(await alerts.watchAlertEmailState(scope)).toEqual({ pendingSlot: null, claimable: true });
      const batch = await alerts.takeWatchAlertBatch(scope, "2026-11-16T09", false);
      expect(batch.map(row => row.headline).sort()).toEqual(["Zeta one", "Zeta two"]);
      expect(await alerts.watchAlertEmailState(scope)).toEqual({ pendingSlot: "2026-11-16T09", claimable: false });
      expect(await alerts.takeWatchAlertBatch(scope, "2026-11-16T09", true)).toHaveLength(2);
      await alerts.closeWatchAlertSlot(scope, "2026-11-16T09");
      expect(await alerts.watchAlertEmailState(scope)).toEqual({ pendingSlot: null, claimable: false });
      expect(await alerts.takeWatchAlertBatch(scope, "2026-11-16T10", false)).toEqual([]);
      expect(await alerts.watchAlertEmailedWithinHour(scope.userId)).toBe(false);
    });
  });
});
