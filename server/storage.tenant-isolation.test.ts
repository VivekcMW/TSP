import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { users } from "@shared/models/auth";
import { tenantMembers, tenants } from "@shared/models/tenancy";
import { drafts, inboxItems, socialAccounts, socialAnalytics, userProfiles } from "@shared/schema";
import { storage, type TenantScope } from "./storage";

/**
 * Cross-tenant isolation contract.
 *
 * Repository scoping and Row-Level Security are both one missing predicate away
 * from a cross-tenant leak — the highest-severity bug class in a multi-tenant
 * system, and one that no amount of code review reliably catches. This suite is
 * the layer that keeps the other two honest, so it must gate CI.
 *
 * The shape of every test is the same: give tenant B some data, then act as
 * tenant A and assert that A can neither see it nor change it.
 */

async function makeTenant(label: string): Promise<TenantScope> {
  const [user] = await db
    .insert(users)
    .values({ id: `user_${label}`, email: `${label}@isolation.test` })
    .returning();
  const [tenant] = await db
    .insert(tenants)
    .values({ kind: "personal", name: `${label} workspace` })
    .returning();
  await db.insert(tenantMembers).values({
    tenantId: tenant.id,
    userId: user.id,
    role: "owner",
  });
  return { tenantId: tenant.id, userId: user.id };
}

/**
 * A second tenant for an EXISTING user — the case tenant scoping exists for.
 *
 * With two tenants owned by two different users, filtering by user_id alone
 * still isolates them, so such a test cannot distinguish tenant scoping from
 * user scoping. (Verified: dropping the tenant predicate from getInboxItems
 * left the two-user tests entirely green.) Only a shared user exposes it.
 */
async function joinCorporateTenant(userId: string, name: string): Promise<TenantScope> {
  const [tenant] = await db
    .insert(tenants)
    .values({ kind: "corporate", name })
    .returning();
  await db.insert(tenantMembers).values({ tenantId: tenant.id, userId, role: "member" });
  return { tenantId: tenant.id, userId };
}

let a: TenantScope;
let b: TenantScope;

beforeEach(async () => {
  // Order matters: children before parents.
  await db.delete(socialAnalytics);
  await db.delete(socialAccounts);
  await db.delete(drafts);
  await db.delete(inboxItems);
  await db.delete(userProfiles);
  await db.delete(tenantMembers);
  await db.delete(tenants);
  await db.delete(users);

  a = await makeTenant("alpha");
  b = await makeTenant("bravo");
});

afterAll(async () => {
  await pool.end();
});

describe("tenant isolation: profiles", () => {
  it("does not return another tenant's profile", async () => {
    await storage.createUserProfile(b, { onboardingStatus: "completed" });

    expect(await storage.getUserProfile(a)).toBeUndefined();
    expect(await storage.getUserProfile(b)).toBeDefined();
  });

  it("cannot update another tenant's profile", async () => {
    await storage.createUserProfile(b, { onboardingStatus: "pending" });

    const result = await storage.updateUserProfile(a, { onboardingStatus: "completed" });

    expect(result).toBeUndefined();
    const untouched = await storage.getUserProfile(b);
    expect(untouched?.onboardingStatus).toBe("pending");
  });

  it("lets the same user hold a separate profile per tenant", async () => {
    // The reason the unique key is (tenant_id, user_id) rather than user_id:
    // a user in a corporate tenant needs a different voice there.
    const corporate = await db
      .insert(tenants)
      .values({ kind: "corporate", name: "Acme" })
      .returning();
    await db.insert(tenantMembers).values({
      tenantId: corporate[0].id,
      userId: a.userId,
      role: "member",
    });
    const corporateScope: TenantScope = { tenantId: corporate[0].id, userId: a.userId };

    await storage.createUserProfile(a, { focusDescription: "personal voice" });
    await storage.createUserProfile(corporateScope, { focusDescription: "work voice" });

    expect((await storage.getUserProfile(a))?.focusDescription).toBe("personal voice");
    expect((await storage.getUserProfile(corporateScope))?.focusDescription).toBe("work voice");
  });
});

describe("tenant isolation: inbox", () => {
  const item = { headline: "H", source: "S", articleUrl: "https://example.test/x" };

  it("does not list another tenant's items", async () => {
    await storage.createInboxItem(b, item);

    expect(await storage.getInboxItems(a)).toHaveLength(0);
    expect(await storage.getInboxItems(b)).toHaveLength(1);
  });

  it("does not resolve another tenant's item by URL", async () => {
    await storage.createInboxItem(b, item);

    // Dedupe on ingest must be per tenant, or one tenant's inbox would
    // suppress articles for another.
    expect(await storage.getInboxItemByUrl(a, item.articleUrl)).toBeUndefined();
    expect(await storage.getInboxItemByUrl(b, item.articleUrl)).toBeDefined();
  });

  it("cannot update another tenant's item, even with its id", async () => {
    const created = await storage.createInboxItem(b, item);

    const result = await storage.updateInboxItem(a, created.id, { status: "dismissed" });

    expect(result).toBeUndefined();
    const [reloaded] = await db.select().from(inboxItems).where(eq(inboxItems.id, created.id));
    expect(reloaded.status).toBe("active");
  });

  it("clearing does not touch another tenant's items", async () => {
    await storage.createInboxItem(b, item);

    await storage.clearUserInboxItems(a);

    expect(await storage.getInboxItems(b)).toHaveLength(1);
  });
});

describe("tenant isolation: drafts", () => {
  const draft = { platform: "linkedin", tone: "professional", content: "hello" };

  it("does not list another tenant's drafts", async () => {
    await storage.createDraft(b, draft);

    expect(await storage.getDrafts(a)).toHaveLength(0);
    expect(await storage.getDrafts(b)).toHaveLength(1);
  });

  it("cannot update another tenant's draft, even with its id", async () => {
    const created = await storage.createDraft(b, draft);

    const result = await storage.updateDraft(a, created.id, { content: "overwritten" });

    expect(result).toBeUndefined();
    const [reloaded] = await db.select().from(drafts).where(eq(drafts.id, created.id));
    expect(reloaded.content).toBe("hello");
  });

  it("cannot delete another tenant's draft, even with its id", async () => {
    const created = await storage.createDraft(b, draft);

    await storage.deleteDraft(a, created.id);

    expect(await storage.getDrafts(b)).toHaveLength(1);
  });
});

describe("tenant isolation: social accounts", () => {
  const account = { provider: "linkedin", providerAccountId: "li_1", accountName: "B" };

  it("does not list or resolve another tenant's accounts", async () => {
    await storage.createSocialAccount(b, account);

    expect(await storage.getSocialAccounts(a)).toHaveLength(0);
    expect(await storage.getSocialAccountByProvider(a, "linkedin")).toBeUndefined();
    expect(await storage.getSocialAccountByProvider(b, "linkedin")).toBeDefined();
  });

  it("cannot update another tenant's account, even with its id", async () => {
    // This method previously filtered on id alone, with no tenant or user
    // predicate, so any caller passing a client-supplied id had a
    // cross-tenant write. This test is what keeps that fixed.
    const created = await storage.createSocialAccount(b, account);

    const result = await storage.updateSocialAccount(a, created.id, { accountName: "hijacked" });

    expect(result).toBeUndefined();
    const [reloaded] = await db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, created.id));
    expect(reloaded.accountName).toBe("B");
  });

  it("cannot delete another tenant's account, even with its id", async () => {
    const created = await storage.createSocialAccount(b, account);

    await storage.deleteSocialAccount(a, created.id);

    expect(await storage.getSocialAccounts(b)).toHaveLength(1);
  });
});

describe("tenant isolation: analytics", () => {
  it("does not return another tenant's snapshots", async () => {
    const created = await storage.createSocialAccount(b, {
      provider: "linkedin",
      providerAccountId: "li_2",
    });
    await storage.createSocialAnalytics(b, {
      socialAccountId: created.id,
      provider: "linkedin",
      snapshotDate: new Date(),
      metrics: {
        followers: 100, following: 10, posts: 5, impressions: 1000,
        engagements: 50, engagementRate: 5, likes: 40, comments: 8,
        shares: 2, clicks: 12,
      },
    });

    expect(await storage.getSocialAnalytics(a)).toHaveLength(0);
    expect(await storage.getSocialAnalytics(b)).toHaveLength(1);
    expect(await storage.getLatestSocialAnalytics(a, "linkedin")).toBeUndefined();
    expect(await storage.getLatestSocialAnalytics(b, "linkedin")).toBeDefined();
  });
});

describe("tenant isolation for one user across two tenants", () => {
  // These are the tests that actually pin tenant scoping. Everything above
  // would still pass if the repository filtered only by user_id.
  let personal: TenantScope;
  let corporate: TenantScope;

  beforeEach(async () => {
    personal = a;
    corporate = await joinCorporateTenant(a.userId, "Acme Corp");
  });

  it("keeps inbox items in the tenant they were created in", async () => {
    await storage.createInboxItem(personal, {
      headline: "personal", source: "S", articleUrl: "https://example.test/p",
    });
    await storage.createInboxItem(corporate, {
      headline: "corporate", source: "S", articleUrl: "https://example.test/c",
    });

    const inPersonal = await storage.getInboxItems(personal);
    const inCorporate = await storage.getInboxItems(corporate);

    expect(inPersonal).toHaveLength(1);
    expect(inPersonal[0].headline).toBe("personal");
    expect(inCorporate).toHaveLength(1);
    expect(inCorporate[0].headline).toBe("corporate");
  });

  it("dedupes article URLs per tenant, not per user", async () => {
    const url = "https://example.test/shared";
    await storage.createInboxItem(corporate, { headline: "H", source: "S", articleUrl: url });

    // The same article must still be able to reach the personal inbox.
    expect(await storage.getInboxItemByUrl(personal, url)).toBeUndefined();
  });

  it("keeps drafts in the tenant they were created in", async () => {
    await storage.createDraft(personal, {
      platform: "linkedin", tone: "professional", content: "personal draft",
    });
    await storage.createDraft(corporate, {
      platform: "linkedin", tone: "professional", content: "corporate draft",
    });

    expect((await storage.getDrafts(personal)).map((d) => d.content)).toEqual(["personal draft"]);
    expect((await storage.getDrafts(corporate)).map((d) => d.content)).toEqual(["corporate draft"]);
  });

  it("cannot reach the other tenant's draft by id", async () => {
    const corpDraft = await storage.createDraft(corporate, {
      platform: "linkedin", tone: "professional", content: "corporate draft",
    });

    expect(await storage.updateDraft(personal, corpDraft.id, { content: "x" })).toBeUndefined();
    await storage.deleteDraft(personal, corpDraft.id);
    expect(await storage.getDrafts(corporate)).toHaveLength(1);
  });

  it("keeps social accounts in the tenant they were connected in", async () => {
    await storage.createSocialAccount(corporate, {
      provider: "linkedin", providerAccountId: "li_corp", accountName: "Corp",
    });

    expect(await storage.getSocialAccounts(personal)).toHaveLength(0);
    expect(await storage.getSocialAccountByProvider(personal, "linkedin")).toBeUndefined();
    expect(await storage.getSocialAccounts(corporate)).toHaveLength(1);
  });

  it("clearing one tenant's inbox leaves the other intact", async () => {
    await storage.createInboxItem(personal, {
      headline: "p", source: "S", articleUrl: "https://example.test/p2",
    });
    await storage.createInboxItem(corporate, {
      headline: "c", source: "S", articleUrl: "https://example.test/c2",
    });

    await storage.clearUserInboxItems(personal);

    expect(await storage.getInboxItems(personal)).toHaveLength(0);
    expect(await storage.getInboxItems(corporate)).toHaveLength(1);
  });
});
