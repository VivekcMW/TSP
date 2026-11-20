import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { contentStrategies, draftScheduleTargets, draftSchedules, drafts, experienceCheckins, tenantMembers, tenants, topicIdeaStates, users } from "@shared/schema";
import { ideaId, type ContentStrategy, type TopicIdea } from "@shared/topic-ideas";
import type { TenantScope } from "../storage";

// Opt-in AFTER migration 0061 is applied to the explicit local test database.
// Never migrates, reads dotenv or touches development data; imports open no pool when skipped.
const enabled = process.env.TOPIC_DISCOVERY_DB_TESTS === "true";

describe.skipIf(!enabled)("topic discovery PostgreSQL repository (0061 prerequisite)", () => {
  let app: typeof import("../db");
  let owner: typeof import("../../test/db-owner");
  let repo: typeof import("./strategy");
  const tenantIds: string[] = [], userIds: string[] = [];
  let scope: TenantScope;
  const strategy: ContentStrategy = {
    audience: "Founders", goal: "build_authority", goalNote: "", pillars: [{ name: "Pricing", expertise: 2, proof: "" }],
    cadence: { postsPerWeek: 2, slots: [{ weekday: 2, time: "09:00" }] },
  };
  const idea = (template: string): TopicIdea => ({ id: ideaId("pillar", "Pricing", template), title: `Idea ${template}`, angle: "Angle", pillar: "Pricing", kind: "pillar", why: "Why", score: 0.5 });

  async function makeScope(existing: Partial<TenantScope> = {}): Promise<TenantScope> {
    const userId = existing.userId ?? randomUUID(), tenantId = existing.tenantId ?? randomUUID();
    if (!existing.userId) { await owner.ownerDb.insert(users).values({ id: userId, email: `${userId}@topic-discovery.test` }); userIds.push(userId); }
    if (!existing.tenantId) { await owner.ownerDb.insert(tenants).values({ id: tenantId, kind: "corporate", name: "Topic discovery fixture" }); tenantIds.push(tenantId); }
    await owner.ownerDb.insert(tenantMembers).values({ tenantId, userId, role: "member" });
    return { tenantId, userId };
  }

  beforeAll(async () => {
    const target = requireLocalTestDatabase();
    app = await import("../db");
    owner = await import("../../test/db-owner");
    repo = await import("./strategy");
    expect((await app.pool.query("select current_user, current_database(), rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0])
      .toEqual({ current_user: "tsp_app", current_database: target.database, rolbypassrls: false, rolsuper: false });
    const ready = await app.pool.query(`select to_regclass('public.content_strategies') is not null as strategies,
      to_regclass('public.experience_checkins') is not null as checkins, to_regclass('public.topic_idea_states') is not null as states`);
    expect(ready.rows[0]).toEqual({ strategies: true, checkins: true, states: true });
  });
  beforeEach(async () => { scope = await makeScope(); });
  afterEach(async () => {
    if (tenantIds.length) {
      for (const table of [contentStrategies, experienceCheckins, topicIdeaStates, draftScheduleTargets, draftSchedules, drafts]) {
        await owner.ownerDb.delete(table).where(inArray(table.tenantId, tenantIds));
      }
      await owner.ownerDb.delete(tenantMembers).where(inArray(tenantMembers.tenantId, tenantIds));
      await owner.ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
    }
    if (userIds.length) await owner.ownerDb.delete(users).where(inArray(users.id, userIds));
    tenantIds.length = 0; userIds.length = 0;
  });
  afterAll(async () => { await app?.pool.end(); await owner?.ownerPool.end(); });

  it("creates and updates the strategy with revision checks, per user", async () => {
    const first = await repo.strategyRepository.saveStrategy(scope, strategy, 0);
    expect(first).toMatchObject({ strategy, revision: 1 });
    await expect(repo.strategyRepository.saveStrategy(scope, strategy, 0)).rejects.toBeInstanceOf(repo.StrategyConflictError);
    const stale = await repo.strategyRepository.saveStrategy(scope, { ...strategy, audience: "Other" }, 5).catch(error => error);
    expect(stale).toBeInstanceOf(repo.StrategyConflictError);
    expect(stale.current).toMatchObject({ strategy, revision: 1 });
    expect(await repo.strategyRepository.saveStrategy(scope, { ...strategy, audience: "CFOs" }, 1)).toMatchObject({ revision: 2, strategy: { audience: "CFOs" } });

    const teammate = await makeScope({ tenantId: scope.tenantId });
    expect(await repo.strategyRepository.getStrategy(teammate)).toBeNull();
    expect(await repo.strategyRepository.getStrategy({ tenantId: (await makeScope()).tenantId, userId: scope.userId })).toBeNull();
  });

  it("keeps one check-in per Monday, newest first", async () => {
    await repo.strategyRepository.saveCheckin(scope, "2026-11-09", { win: "Old win", lesson: "", question: "" });
    await repo.strategyRepository.saveCheckin(scope, "2026-11-16", { win: "First", lesson: "", question: "" });
    const updated = await repo.strategyRepository.saveCheckin(scope, "2026-11-16", { win: "Second", lesson: "Lesson", question: "" }, true);
    expect(updated).toMatchObject({ weekStart: "2026-11-16", answers: { win: "Second", lesson: "Lesson", question: "" } });
    expect((await repo.strategyRepository.recentCheckins(scope)).map(checkin => checkin.weekStart)).toEqual(["2026-11-16", "2026-11-09"]);
    expect(await repo.strategyRepository.getCheckin(scope, "2026-11-02")).toBeNull();
    // An answered week is never replaced without `replace` (stale tab Save or Skip); a skipped week can be answered.
    const conflict = await repo.strategyRepository.saveCheckin(scope, "2026-11-16", { win: "", lesson: "", question: "" }).catch(error => error);
    expect(conflict).toBeInstanceOf(repo.CheckinConflictError);
    expect(conflict.current).toMatchObject({ answers: { win: "Second", lesson: "Lesson" } });
    expect(await repo.strategyRepository.saveCheckin(scope, "2026-11-16", { win: "Third", lesson: "", question: "" }, true)).toMatchObject({ answers: { win: "Third" } });
    await repo.strategyRepository.saveCheckin(scope, "2026-11-23", { win: "", lesson: "", question: "" });
    expect(await repo.strategyRepository.saveCheckin(scope, "2026-11-23", { win: "After a skip", lesson: "", question: "" })).toMatchObject({ answers: { win: "After a skip" } });
    await expect(repo.strategyRepository.saveCheckin(scope, "2026-11-17", { win: "", lesson: "", question: "" })).rejects.toThrow();
    expect(await repo.strategyRepository.recentCheckins(await makeScope({ tenantId: scope.tenantId }))).toEqual([]);
  });

  it("stores idea states with saved snapshots, clears them and caps saved ideas", async () => {
    const saved = idea("myth");
    await repo.strategyRepository.setIdeaState(scope, saved.id, "saved", saved);
    await repo.strategyRepository.setIdeaState(scope, idea("checklist").id, "dismissed");
    const byId = <T extends { ideaId: string }>(rows: T[]) => [...rows].sort((a, b) => (a.ideaId < b.ideaId ? -1 : 1));
    // Saved ideas always come back (with their snapshot); others only when asked for by id.
    expect(byId(await repo.strategyRepository.loadIdeaStates(scope, [idea("checklist").id])))
      .toEqual(byId([{ ideaId: saved.id, state: "saved", idea: saved }, { ideaId: idea("checklist").id, state: "dismissed", idea: null }]));
    expect(await repo.strategyRepository.loadIdeaStates(scope, [])).toEqual([{ ideaId: saved.id, state: "saved", idea: saved }]);
    expect(await repo.strategyRepository.setIdeaState(scope, saved.id, null)).toBeNull();
    expect(await repo.strategyRepository.loadIdeaStates(scope, [saved.id])).toEqual([]);
    expect(await repo.strategyRepository.loadIdeaStates(await makeScope({ tenantId: scope.tenantId }), [idea("checklist").id])).toEqual([]);

    // Drafting keeps the snapshot (also when a later request has none); dismissing drops it.
    const drafted = idea("lessons");
    await repo.strategyRepository.setIdeaState(scope, drafted.id, "saved", drafted);
    await repo.strategyRepository.setIdeaState(scope, drafted.id, "used");
    expect(await repo.strategyRepository.loadIdeaStates(scope, [])).toEqual([{ ideaId: drafted.id, state: "used", idea: drafted }]);
    await repo.strategyRepository.setIdeaState(scope, drafted.id, "dismissed", drafted);
    expect(await repo.strategyRepository.loadIdeaStates(scope, [drafted.id])).toEqual([{ ideaId: drafted.id, state: "dismissed", idea: null }]);
    const neverSaved = idea("prediction");
    await repo.strategyRepository.setIdeaState(scope, neverSaved.id, "used", neverSaved);
    expect(await repo.strategyRepository.loadIdeaStates(scope, [])).toEqual([{ ideaId: neverSaved.id, state: "used", idea: neverSaved }]);
    await repo.strategyRepository.setIdeaState(scope, neverSaved.id, null);

    for (let index = 0; index < 20; index++) await repo.strategyRepository.setIdeaState(scope, idea(`t${index}`).id, "saved", idea(`t${index}`));
    await expect(repo.strategyRepository.setIdeaState(scope, idea("one-more").id, "saved")).rejects.toBeInstanceOf(repo.SavedIdeaLimitError);
    await expect(repo.strategyRepository.setIdeaState(scope, idea("t0").id, "saved", idea("t0"))).resolves.toMatchObject({ state: "saved" });
  });

  it("reads confirmed LinkedIn posts and upcoming schedules without changing them", async () => {
    const now = Date.now();
    const draft = async (content: string, extra: Partial<typeof drafts.$inferInsert> = {}) =>
      (await owner.ownerDb.insert(drafts).values({ ...scope, platform: "linkedin", tone: "professional", content, ...extra }).returning())[0];
    const schedule = async (draftId: string, at: Date, status: string, target: Partial<typeof draftScheduleTargets.$inferInsert> = {}) => {
      const [row] = await owner.ownerDb.insert(draftSchedules).values({ tenantId: scope.tenantId, draftId, scheduledPublishAt: at, status }).returning();
      await owner.ownerDb.insert(draftScheduleTargets).values({ tenantId: scope.tenantId, draftScheduleId: row.id, platform: "linkedin", status, ...target });
      return row;
    };
    const live = await draft("Live post\nbody", { publishStatus: "published", publishedAt: new Date(now - 5 * 86_400_000) });
    await schedule(live.id, new Date(now - 5 * 86_400_000), "published", { executionMode: "live", receiptKind: "provider_id", providerPostId: "urn:li:share:1" });
    const demo = await draft("Demo post", { publishStatus: "published", publishedAt: new Date(now - 5 * 86_400_000) });
    await schedule(demo.id, new Date(now - 5 * 86_400_000), "published", { executionMode: "live", receiptKind: "provider_id", providerPostId: "sandbox_1" });
    const soon = await draft("Soon\nmore", { publishStatus: "scheduled" });
    const soonSchedule = await schedule(soon.id, new Date(now + 2 * 86_400_000), "scheduled");
    const later = await draft("Later", { publishStatus: "scheduled" });
    await schedule(later.id, new Date(now + 40 * 86_400_000), "scheduled");
    const other = await draft("Other platform", { platform: "twitter", publishStatus: "scheduled" });
    await schedule(other.id, new Date(now + 2 * 86_400_000), "scheduled");

    expect((await repo.strategyRepository.publishedPosts(scope, new Date(now - 60 * 86_400_000))).map(post => post.id)).toEqual([live.id]);
    const upcoming = await repo.strategyRepository.scheduledPosts(scope, new Date(now), new Date(now + 30 * 86_400_000));
    expect(upcoming).toEqual([{ draftId: soon.id, at: soonSchedule.scheduledPublishAt.toISOString(), status: "scheduled", excerpt: "Soon" }]);
    expect(await repo.strategyRepository.scheduledPosts(await makeScope({ tenantId: scope.tenantId }), new Date(now), new Date(now + 30 * 86_400_000))).toEqual([]);
  });
});
