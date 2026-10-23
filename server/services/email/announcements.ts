import { and, asc, count, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { emailCampaigns, emailCampaignRecipients, users } from "@shared/schema";
import { announcementSchema, type AnnouncementCampaign } from "@shared/email-announcements";
import { emailTemplates, wrapEmail, type AppEmail } from "./index";
import { dispatchDurableEmail } from "./durable-dispatch";

export async function listAnnouncementCampaigns(): Promise<AnnouncementCampaign[]> {
  const rows = await db.select({
    id: emailCampaigns.id, content: emailCampaigns.content, status: emailCampaigns.status, createdAt: emailCampaigns.createdAt,
    audienceCount: count(emailCampaignRecipients.userId),
    processedCount: sql<number>`count(${emailCampaignRecipients.outcome})::int`,
    sentCount: sql<number>`count(*) filter (where ${emailCampaignRecipients.outcome} = 'sent')::int`,
    suppressedCount: sql<number>`count(*) filter (where ${emailCampaignRecipients.outcome} = 'suppressed')::int`,
    unknownCount: sql<number>`count(*) filter (where ${emailCampaignRecipients.outcome} = 'unknown')::int`,
    failedCount: sql<number>`count(*) filter (where ${emailCampaignRecipients.outcome} = 'failed')::int`,
  }).from(emailCampaigns).leftJoin(emailCampaignRecipients, eq(emailCampaignRecipients.campaignId, emailCampaigns.id))
    .groupBy(emailCampaigns.id).orderBy(sql`${emailCampaigns.createdAt} desc`, emailCampaigns.id).limit(50);
  return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function prepareAnnouncement(actorId: string, input: unknown) {
  const content = announcementSchema.parse(input);
  const campaign = await db.transaction(async tx => {
    const [created] = await tx.insert(emailCampaigns).values({ createdBy: actorId, content }).returning();
    await tx.execute(sql`insert into email_campaign_recipients(campaign_id, user_id)
      select ${created.id}, u.id from users u
      left join email_preferences p on p.user_id = u.id
      where u.email_verified = true and coalesce(p.product_updates, true) = true and p.unsubscribed_at is null
        and exists (select 1 from tenant_members m inner join tenants t on t.id = m.tenant_id
          where m.user_id = u.id and t.status = 'active')`);
    const [audience] = await tx.select({ value: count() }).from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, created.id));
    if (!audience) throw new Error("Announcement audience unavailable");
    return { id: created.id, content, status: created.status, createdAt: created.createdAt.toISOString(),
      audienceCount: audience.value, processedCount: 0, sentCount: 0, suppressedCount: 0, unknownCount: 0, failedCount: 0 } satisfies AnnouncementCampaign;
  });
  const email: AppEmail = { type: content.type, recipient: "preview@example.invalid", recipientName: "Reader", ...emailTemplates.announcement(content) };
  return { campaign, html: wrapEmail(email) };
}

export async function confirmAnnouncement(id: string) {
  const [campaign] = await db.update(emailCampaigns).set({ status: "active", confirmedAt: new Date() })
    .where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "draft"))).returning({ id: emailCampaigns.id });
  if (campaign) return true;
  const [existing] = await db.select({ id: emailCampaigns.id }).from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
  return !!existing; // Confirmation retries never reset progress or create a second broadcast.
}

export async function setAnnouncementPaused(id: string, paused: boolean) {
  const from = paused ? "active" : "paused";
  const to = paused ? "paused" : "active";
  const [changed] = await db.update(emailCampaigns).set({ status: to })
    .where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, from))).returning({ id: emailCampaigns.id });
  if (changed) return true;
  const [existing] = await db.select({ status: emailCampaigns.status }).from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
  return existing?.status === to;
}

export async function sendAnnouncementTest(id: string, actor: { id: string; email: string; name: string }) {
  const [campaign] = await db.select({ content: emailCampaigns.content }).from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
  if (!campaign) return undefined;
  const content = announcementSchema.parse(campaign.content);
  const template = emailTemplates.announcement(content);
  return dispatchDurableEmail({
    ...template, subject: `[TEST] ${template.subject}`, type: content.type, userId: actor.id, recipient: actor.email, recipientName: actor.name,
    dedupeKey: JSON.stringify(["announcement-test-v1", id, actor.id]),
  });
}

export async function runAnnouncementBatch(assertConnected: () => Promise<void>, deadline: number) {
  const campaigns = await db.select().from(emailCampaigns).where(eq(emailCampaigns.status, "active")).orderBy(emailCampaigns.createdAt, emailCampaigns.id).limit(5);
  for (const campaign of campaigns) {
    if (Date.now() >= deadline) break;
    const recipients = await db.select({ userId: emailCampaignRecipients.userId, email: users.email, name: users.name, verified: users.emailVerified })
      .from(emailCampaignRecipients).innerJoin(users, eq(users.id, emailCampaignRecipients.userId))
      .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), isNull(emailCampaignRecipients.outcome), lte(emailCampaignRecipients.retryAt, new Date())))
      .orderBy(asc(emailCampaignRecipients.retryAt), emailCampaignRecipients.userId).limit(10);
    for (const recipient of recipients) {
      if (Date.now() >= deadline) break;
      await assertConnected();
      const [current] = await db.select({ status: emailCampaigns.status }).from(emailCampaigns).where(eq(emailCampaigns.id, campaign.id)).limit(1);
      if (current?.status !== "active") break;
      let outcome: Awaited<ReturnType<typeof dispatchDurableEmail>> = null;
      try {
        const content = announcementSchema.parse(campaign.content);
        outcome = recipient.verified ? await dispatchDurableEmail({
          type: content.type, userId: recipient.userId, recipient: recipient.email, recipientName: recipient.name,
          dedupeKey: JSON.stringify(["announcement-v1", campaign.id, recipient.userId]), ...emailTemplates.announcement(content),
        }) : "suppressed";
      } catch {
        console.error("[email:announcement] Delivery pending; inspect durable receipt");
      }
      await db.update(emailCampaignRecipients).set({ outcome, retryAt: new Date(Date.now() + 60_000) })
        .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.userId, recipient.userId), isNull(emailCampaignRecipients.outcome)));
    }
    await db.update(emailCampaigns).set({ status: "completed" }).where(and(eq(emailCampaigns.id, campaign.id), eq(emailCampaigns.status, "active"),
      sql`not exists (select 1 from ${emailCampaignRecipients} where ${emailCampaignRecipients.campaignId} = ${campaign.id} and ${emailCampaignRecipients.outcome} is null)`));
  }
}
