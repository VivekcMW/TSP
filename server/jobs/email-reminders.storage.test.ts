import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { drafts, emailDeliveries, inboxItems, tenantMembers, tenants, userProfiles, users } from "@shared/schema";
import { loadReminderContext } from "./email-reminders";

// Loads through the tsp_app role, so row-level security applies to every tenant query.
const DAY = 86_400_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);
const scope = { tenantId: randomUUID(), userId: randomUUID() };
const otherTenant = randomUUID();
const newcomer = { tenantId: randomUUID(), userId: randomUUID() };
const tenantIds = [scope.tenantId, otherTenant, newcomer.tenantId];
const userIds = [scope.userId, newcomer.userId];
let validated = false;

beforeAll(async () => {
  requireLocalTestDatabase();
  const role = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); }));
  validated = true;
  await ownerDb.insert(users).values([
    { id: scope.userId, email: `${scope.userId}@example.invalid`, firstName: "Priya", name: "Priya Shah", createdAt: ago(60) },
    { id: newcomer.userId, email: `${newcomer.userId}@example.invalid`, name: `${newcomer.userId}@example.invalid`, createdAt: ago(9) },
  ]);
  await ownerDb.insert(tenants).values(tenantIds.map(id => ({ id, name: "Reminder fixture", kind: "personal" })));
  await ownerDb.insert(tenantMembers).values([{ ...scope, role: "owner" }, { tenantId: otherTenant, userId: scope.userId, role: "owner" }, { ...newcomer, role: "owner" }]);
  await ownerDb.insert(userProfiles).values([
    { ...scope, onboardingStatus: "completed", defaultPlatform: "twitter",
      keywords: [{ keyword: "CTV Measurement", weight: 0.6 }, { keyword: "Retail Media", weight: 0.9 }, { keyword: "Podcasts", weight: 0.2 }] },
    { ...newcomer, onboardingStatus: "pending", defaultPlatform: "threads" },
  ]);
  await ownerDb.insert(drafts).values([
    { ...scope, platform: "linkedin", tone: "professional", content: "One", createdAt: ago(30) },
    { ...scope, platform: "linkedin", tone: "professional", content: "Two", createdAt: ago(25), publishedAt: ago(20) },
    { ...scope, platform: "twitter", tone: "professional", content: "Three", createdAt: ago(28) },
  ]);
  const story = (tenantId: string, headline: string, articleUrl: string, rankingScore: string, status = "active", publishedAt = ago(2)) =>
    ({ tenantId, userId: scope.userId, headline, source: "Fixture News", articleUrl, rankingScore, status, publishedAt });
  await ownerDb.insert(inboxItems).values([
    story(scope.tenantId, "Unsafe link", "javascript:alert(1)", "0.99"),
    story(scope.tenantId, "Retail media wants brand budgets", "https://news.test/rmn", "0.9"),
    story(scope.tenantId, "Dismissed story", "https://news.test/dismissed", "0.95", "dismissed"),
    story(scope.tenantId, "Last month's story", "https://news.test/old", "0.93", "active", ago(20)),
    story(scope.tenantId, "IAB Europe releases a CTV framework", "https://news.test/iab", "0.8"),
    story(scope.tenantId, "CFOs review media plans", "https://news.test/cfo", "0.7"),
    story(scope.tenantId, "Fourth-best story", "https://news.test/fourth", "0.6"),
    story(otherTenant, "Another workspace's story", "https://news.test/other", "0.97"),
  ]);
  await ownerDb.execute(sql`insert into sessions (id, user_id, token, expires_at, created_at, updated_at) values
    (${randomUUID()}, ${scope.userId}, ${randomUUID()}, ${ago(-7).toISOString()}, ${ago(40).toISOString()}, ${ago(12).toISOString()})`);
  await ownerDb.insert(emailDeliveries).values([
    { userId: scope.userId, recipient: "x@example.invalid", type: "re_engagement", status: "sent", sentAt: ago(3), dedupeKey: randomUUID() },
    { userId: scope.userId, recipient: "x@example.invalid", type: "re_engagement", status: "failed", dedupeKey: randomUUID() },
    { userId: scope.userId, recipient: "x@example.invalid", type: "daily_digest", status: "sent", sentAt: ago(1), dedupeKey: randomUUID() },
  ]);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (validated) {
    await ownerDb.delete(emailDeliveries).where(inArray(emailDeliveries.userId, userIds));
    await ownerDb.delete(inboxItems).where(inArray(inboxItems.tenantId, tenantIds));
    await ownerDb.delete(drafts).where(inArray(drafts.tenantId, tenantIds));
    await ownerDb.delete(userProfiles).where(inArray(userProfiles.tenantId, tenantIds));
    await ownerDb.delete(tenantMembers).where(inArray(tenantMembers.tenantId, tenantIds));
    await ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
    await ownerDb.delete(users).where(inArray(users.id, userIds));   // cascades sessions
  }
  await pool.end();
  await ownerPool.end();
});

const near = (actual: Date, expected: Date) => expect(Math.abs(actual.getTime() - expected.getTime())).toBeLessThan(1000);

describe("loading a person's reminder context", () => {
  it("reads activity, earlier reminders, this week's stories, topics and platform from their workspace only", async () => {
    const context = await loadReminderContext(scope);
    expect(context).toMatchObject({ email: `${scope.userId}@example.invalid`, firstName: "Priya", onboarded: true, platform: "linkedin",
      topics: ["Retail Media", "CTV Measurement"] });
    near(context!.lastActivity, ago(12));                       // the session refresh beats the older drafts
    expect(context!.sent).toHaveLength(1);
    near(context!.sent[0], ago(3));
    expect(context!.stories.map(story => story.url)).toEqual(["https://news.test/rmn", "https://news.test/iab", "https://news.test/cfo"]);
  });

  it("falls back sensibly for a new account", async () => {
    const context = await loadReminderContext(newcomer);
    expect(context).toMatchObject({ firstName: null, onboarded: false, platform: "threads", topics: [], stories: [], sent: [] });
    near(context!.lastActivity, ago(9));
  });

  it("returns nothing for an unknown person", async () => {
    expect(await loadReminderContext({ tenantId: scope.tenantId, userId: randomUUID() })).toBeNull();
  });
});
