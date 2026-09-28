import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { newsletterSubscribers } from "@shared/schema";
import { confirmSubscription, markConfirmationSent, newsletterSecret, newsletterToken, requestSubscription, unsubscribe } from "./newsletter";

// Runs through the tsp_app role, as production does.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const tag = `nl-${randomUUID().slice(0, 8)}`;
const address = (name: string) => `${name}.${tag}@example.invalid`;
const secret = () => newsletterSecret();
const row = async (email: string) => (await ownerDb.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, email)))[0];
let validated = false;

beforeAll(async () => {
  requireLocalTestDatabase();
  vi.stubEnv("BETTER_AUTH_SECRET", "newsletter-storage-test-secret-long-enough");
  const role = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  validated = true;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (validated) await ownerDb.delete(newsletterSubscribers).where(like(newsletterSubscribers.email, `%.${tag}@example.invalid`));
  await pool.end(); await ownerPool.end();
});

describe("newsletter subscriptions", () => {
  it("keeps one pending row per address (any capitals) and sends at most one confirmation an hour", async () => {
    const now = new Date("2026-09-28T10:00:00Z");
    const first = await requestSubscription(address("Ana"), "landing", now);
    expect(first.send).toBe(true);
    const stored = await row(address("ana"));
    expect(stored).toMatchObject({ status: "pending", source: "landing" });
    expect(stored.consentText).toContain("One email a month");
    await markConfirmationSent(first.id, now);
    const again = await requestSubscription(address("ana"), "landing", new Date(now.getTime() + 10 * 60_000));
    expect(again).toMatchObject({ id: first.id, send: false });
    const later = await requestSubscription(address("ana"), "landing", new Date(now.getTime() + 2 * HOUR));
    expect(later.send).toBe(true);
    expect(later.nonce).not.toBe(first.nonce);
    // The earlier link stops working once a new one is issued.
    expect(await confirmSubscription(newsletterToken("confirm", first.id, first.nonce, secret()), new Date(now.getTime() + 3 * HOUR))).toBe("invalid");
  });

  it("confirms with the emailed link, then ignores repeat sign-ups", async () => {
    const now = new Date("2026-09-28T10:00:00Z");
    const request = await requestSubscription(address("bo"), "landing", now);
    const token = newsletterToken("confirm", request.id, request.nonce, secret());
    expect(await confirmSubscription(token, new Date(now.getTime() + HOUR))).toBe("confirmed");
    expect(await confirmSubscription(token, new Date(now.getTime() + 2 * HOUR))).toBe("confirmed");
    expect(await row(address("bo"))).toMatchObject({ status: "confirmed" });
    expect((await row(address("bo"))).confirmedAt).toBeInstanceOf(Date);
    expect((await requestSubscription(address("bo"), "landing", new Date(now.getTime() + 5 * HOUR))).send).toBe(false);
  });

  it("unsubscribes only with the unsubscribe link, and needs a fresh sign-up to come back", async () => {
    const now = new Date("2026-09-28T10:00:00Z");
    const request = await requestSubscription(address("cy"), "landing", now);
    const confirm = newsletterToken("confirm", request.id, request.nonce, secret());
    await confirmSubscription(confirm, now);
    expect(await unsubscribe(confirm, now)).toBe("invalid");
    const leave = newsletterToken("unsubscribe", request.id, request.nonce, secret());
    expect(await unsubscribe(leave, now)).toBe("unsubscribed");
    expect(await unsubscribe(leave, now)).toBe("unsubscribed");
    expect(await row(address("cy"))).toMatchObject({ status: "unsubscribed" });
    expect(await confirmSubscription(confirm, now)).toBe("invalid");
    const back = await requestSubscription(address("cy"), "landing", new Date(now.getTime() + 2 * HOUR));
    expect(back.send).toBe(true);
    expect(await row(address("cy"))).toMatchObject({ status: "pending" });
  });

  it("lets confirmation links expire after seven days", async () => {
    const now = new Date("2026-09-28T10:00:00Z");
    const request = await requestSubscription(address("di"), "landing", now);
    const token = newsletterToken("confirm", request.id, request.nonce, secret());
    expect(await confirmSubscription(token, new Date(now.getTime() + 8 * DAY))).toBe("invalid");
    expect(await row(address("di"))).toMatchObject({ status: "pending" });
  });

  it("rejects malformed and unknown links", async () => {
    expect(await confirmSubscription("not-a-token", new Date())).toBe("invalid");
    expect(await confirmSubscription(newsletterToken("confirm", randomUUID(), "nonce", secret()), new Date())).toBe("invalid");
  });
});
