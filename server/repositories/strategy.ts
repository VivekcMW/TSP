import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { withTenantTransaction, type TenantScope, type TenantTx } from "../storage";
import { contentStrategies, draftSchedules, drafts, experienceCheckins, topicIdeaStates } from "@shared/schema";
import {
  checkinAnswersSchema, contentStrategySchema, IDEA_STATE_HISTORY, MAX_SAVED_IDEAS, topicIdeaSchema,
  type CheckinAnswers, type ContentStrategy, type ExperienceCheckin, type IdeaState, type PublishedInput, type ScheduledInput, type StoredIdeaState, type TopicIdea,
} from "@shared/topic-ideas";

/** `strategy` is null when a stored row no longer validates; its revision still guards the next save. */
export interface SavedStrategy { strategy: ContentStrategy | null; revision: number; updatedAt: Date }

export class StrategyConflictError extends Error {
  constructor(readonly current: SavedStrategy | null) { super("Your strategy was changed in another tab or device. Load the latest version, then save again."); }
}
/** The week already has answers (saved elsewhere) and the request did not ask to replace them. */
export class CheckinConflictError extends Error {
  constructor(readonly current: ExperienceCheckin | null) { super("You already checked in this week, maybe in another tab. Here are your answers."); }
}
export class SavedIdeaLimitError extends Error {
  constructor() { super(`You can keep up to ${MAX_SAVED_IDEAS} saved ideas. Unsave one first.`); }
}

const ownedStrategy = (scope: TenantScope) => and(eq(contentStrategies.tenantId, scope.tenantId), eq(contentStrategies.userId, scope.userId));
const ownedStates = (scope: TenantScope) => and(eq(topicIdeaStates.tenantId, scope.tenantId), eq(topicIdeaStates.userId, scope.userId));
const ownedCheckins = (scope: TenantScope) => and(eq(experienceCheckins.tenantId, scope.tenantId), eq(experienceCheckins.userId, scope.userId));

function toSaved(row: typeof contentStrategies.$inferSelect): SavedStrategy {
  const parsed = contentStrategySchema.safeParse(row.strategy);
  return { strategy: parsed.success ? parsed.data : null, revision: row.revision, updatedAt: row.updatedAt };
}
async function readStrategy(tx: TenantTx, scope: TenantScope) {
  const [row] = await tx.select().from(contentStrategies).where(ownedStrategy(scope));
  return row ? toSaved(row) : null;
}

function toCheckin(row: typeof experienceCheckins.$inferSelect): ExperienceCheckin {
  const parsed = checkinAnswersSchema.safeParse(row.answers);
  return { weekStart: row.weekStart, answers: parsed.success ? parsed.data : { win: "", lesson: "", question: "" }, updatedAt: row.updatedAt.toISOString() };
}

function toStored(row: Pick<typeof topicIdeaStates.$inferSelect, "ideaId" | "state" | "idea">): StoredIdeaState {
  const parsed = row.idea ? topicIdeaSchema.safeParse(row.idea) : null;
  return { ideaId: row.ideaId, state: row.state, idea: parsed?.success ? parsed.data : null };
}

// Explicitly qualified: Drizzle may render single-table column references unqualified, which would bind to `s`.
const draftIdColumn = sql`${drafts}.${sql.identifier(drafts.id.name)}`;
/** Confirmed live LinkedIn delivery only: the same evidence the Posted folder requires. */
const liveDelivery = (scope: TenantScope) => sql`exists (
    select 1 from draft_schedules s join draft_schedule_targets t on t.draft_schedule_id = s.id
    where s.draft_id = ${draftIdColumn} and s.tenant_id = ${scope.tenantId} and t.tenant_id = ${scope.tenantId}
  ) and not exists (
    select 1 from draft_schedules s join draft_schedule_targets t on t.draft_schedule_id = s.id
    where s.draft_id = ${draftIdColumn} and s.tenant_id = ${scope.tenantId} and t.tenant_id = ${scope.tenantId}
    and (t.status <> 'published' or t.execution_mode is distinct from 'live' or t.receipt_kind is distinct from 'provider_id'
      or nullif(trim(t.provider_post_id), '') is null or t.provider_post_id ~* '^(sandbox|mock|dryrun|dry-run)[_-]')
  )`;

/** Phase 3 persistence. Every query is tenant-scoped by RLS and filtered by user. */
export const strategyRepository = {
  getStrategy(scope: TenantScope): Promise<SavedStrategy | null> {
    return withTenantTransaction(scope, tx => readStrategy(tx, scope));
  },

  /** `expectedRevision` 0 creates the first version. Throws StrategyConflictError when someone saved in between. */
  saveStrategy(scope: TenantScope, strategy: ContentStrategy, expectedRevision: number): Promise<SavedStrategy> {
    const value = contentStrategySchema.parse(strategy);
    return withTenantTransaction(scope, async tx => {
      const [row] = expectedRevision === 0
        ? await tx.insert(contentStrategies).values({ ...scope, strategy: value, revision: 1 }).onConflictDoNothing().returning()
        : await tx.update(contentStrategies).set({ strategy: value, revision: sql`${contentStrategies.revision} + 1`, updatedAt: sql`now()` })
          .where(and(ownedStrategy(scope), eq(contentStrategies.revision, expectedRevision))).returning();
      if (row) return toSaved(row);
      throw new StrategyConflictError(await readStrategy(tx, scope));
    });
  },

  getCheckin(scope: TenantScope, weekStart: string): Promise<ExperienceCheckin | null> {
    return withTenantTransaction(scope, async tx => {
      const [row] = await tx.select().from(experienceCheckins).where(and(ownedCheckins(scope), eq(experienceCheckins.weekStart, weekStart)));
      return row ? toCheckin(row) : null;
    });
  },

  recentCheckins(scope: TenantScope, limit = 8): Promise<ExperienceCheckin[]> {
    return withTenantTransaction(scope, async tx => (await tx.select().from(experienceCheckins).where(ownedCheckins(scope))
      .orderBy(desc(experienceCheckins.weekStart)).limit(Math.max(1, Math.min(52, limit)))).map(toCheckin));
  },

  /** Without `replace`, only a missing or skipped (all blank) check-in is written; otherwise CheckinConflictError. */
  saveCheckin(scope: TenantScope, weekStart: string, answers: CheckinAnswers, replace = false): Promise<ExperienceCheckin> {
    const value = checkinAnswersSchema.parse(answers);
    const blank = (field: string) => sql`coalesce(btrim(${experienceCheckins.answers} ->> ${field}), '') = ''`;
    return withTenantTransaction(scope, async tx => {
      const [row] = await tx.insert(experienceCheckins).values({ ...scope, weekStart, answers: value })
        .onConflictDoUpdate({
          target: [experienceCheckins.tenantId, experienceCheckins.userId, experienceCheckins.weekStart], set: { answers: value, updatedAt: sql`now()` },
          ...(replace ? {} : { setWhere: and(blank("win"), blank("lesson"), blank("question")) }),
        })
        .returning();
      if (row) return toCheckin(row);
      const [current] = await tx.select().from(experienceCheckins).where(and(ownedCheckins(scope), eq(experienceCheckins.weekStart, weekStart)));
      throw new CheckinConflictError(current ? toCheckin(current) : null);
    });
  },

  /** States for the given idea ids, every saved idea and the most recent drafted ideas (with their snapshots). */
  loadIdeaStates(scope: TenantScope, ideaIds: readonly string[]): Promise<StoredIdeaState[]> {
    return withTenantTransaction(scope, async tx => {
      const columns = { ideaId: topicIdeaStates.ideaId, state: topicIdeaStates.state, idea: topicIdeaStates.idea };
      const matching = ideaIds.length ? await tx.select(columns).from(topicIdeaStates).where(and(ownedStates(scope), inArray(topicIdeaStates.ideaId, [...new Set(ideaIds)]))) : [];
      const kept = (state: IdeaState) => tx.select(columns).from(topicIdeaStates)
        .where(and(ownedStates(scope), eq(topicIdeaStates.state, state), sql`${topicIdeaStates.idea} is not null`))
        .orderBy(desc(topicIdeaStates.updatedAt)).limit(MAX_SAVED_IDEAS);
      const saved = await kept("saved");
      const drafted = await kept("used");
      return [...new Map([...matching, ...saved, ...drafted].map(row => [row.ideaId, toStored(row)])).values()];
    });
  },

  /**
   * null clears the state. Saved and drafted ideas keep a snapshot (an earlier one survives a request without one);
   * dismissed ideas drop it. Older dismissed/drafted history is pruned.
   */
  setIdeaState(scope: TenantScope, ideaId: string, state: IdeaState | null, idea?: TopicIdea): Promise<StoredIdeaState | null> {
    return withTenantTransaction(scope, async tx => {
      if (state === null) {
        await tx.delete(topicIdeaStates).where(and(ownedStates(scope), eq(topicIdeaStates.ideaId, ideaId)));
        return null;
      }
      if (state === "saved") {
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(topicIdeaStates)
          .where(and(ownedStates(scope), eq(topicIdeaStates.state, "saved"), sql`${topicIdeaStates.ideaId} <> ${ideaId}`));
        if (count >= MAX_SAVED_IDEAS) throw new SavedIdeaLimitError();
      }
      const snapshot = state !== "dismissed" && idea?.id === ideaId ? topicIdeaSchema.parse(idea) : null;
      const [row] = await tx.insert(topicIdeaStates).values({ ...scope, ideaId, state, idea: snapshot })
        .onConflictDoUpdate({ target: [topicIdeaStates.tenantId, topicIdeaStates.userId, topicIdeaStates.ideaId],
          set: { state, idea: state === "dismissed" ? null : sql`coalesce(excluded.idea, ${topicIdeaStates.idea})`, updatedAt: sql`now()` } })
        .returning();
      await tx.delete(topicIdeaStates).where(and(ownedStates(scope), sql`${topicIdeaStates.state} <> 'saved'`, sql`${topicIdeaStates.ideaId} not in (
        select k.idea_id from topic_idea_states k where k.tenant_id = ${scope.tenantId} and k.user_id = ${scope.userId} and k.state <> 'saved'
        order by k.updated_at desc limit ${IDEA_STATE_HISTORY})`));
      return toStored(row);
    });
  },

  /** LinkedIn posts with confirmed live delivery since `since`, newest first. */
  publishedPosts(scope: TenantScope, since: Date, limit = 20): Promise<PublishedInput[]> {
    return withTenantTransaction(scope, async tx => {
      const rows = await tx.select({ id: drafts.id, content: drafts.content, publishedAt: drafts.publishedAt }).from(drafts)
        .where(and(eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId), eq(drafts.platform, "linkedin"), eq(drafts.publishStatus, "published"),
          gte(drafts.publishedAt, since), liveDelivery(scope)))
        .orderBy(desc(drafts.publishedAt)).limit(Math.max(1, Math.min(50, limit)));
      return rows.flatMap(row => row.publishedAt ? [{ id: row.id, content: row.content.slice(0, 2000), publishedAt: row.publishedAt.toISOString() }] : []);
    });
  },

  /** Read-only view of LinkedIn posts waiting to send in [from, to). Never changes the schedule. */
  scheduledPosts(scope: TenantScope, from: Date, to: Date): Promise<ScheduledInput[]> {
    return withTenantTransaction(scope, async tx => {
      const rows = await tx.select({ draftId: draftSchedules.draftId, at: draftSchedules.scheduledPublishAt, status: draftSchedules.status, content: drafts.content })
        .from(draftSchedules).innerJoin(drafts, eq(drafts.id, draftSchedules.draftId))
        .where(and(eq(draftSchedules.tenantId, scope.tenantId), eq(drafts.tenantId, scope.tenantId), eq(drafts.userId, scope.userId), eq(drafts.platform, "linkedin"),
          inArray(draftSchedules.status, ["scheduled", "queued", "publishing"]), gte(draftSchedules.scheduledPublishAt, from), lt(draftSchedules.scheduledPublishAt, to)))
        .orderBy(draftSchedules.scheduledPublishAt).limit(200);
      return rows.map(row => ({ draftId: row.draftId, at: row.at.toISOString(), status: row.status, excerpt: row.content.trim().split(/\n+/)[0]?.slice(0, 200) ?? "" }));
    });
  },
};
