import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireLocalTestDatabase } from "../../test/database-safety";
import { pool } from "../db";
import { ownerDb, ownerPool } from "../../test/db-owner";
import { pooledArticles, publications } from "@shared/schema";
import { findPooledArticle, registerPublications } from "../services/articlePool";
import { registerWebSubRoutes } from "./websub";

// Real database through the tsp_app role; the hub is played by the test client.
const tag = `websub-${randomUUID().slice(0, 8)}`;
const host = `https://daily.${tag}.example.invalid`;
const feed = `${host}/feed`;
const secret = "s".repeat(64);
const app = express();
app.use(express.json());
registerWebSubRoutes(app);
let id = "";
let validated = false;

beforeAll(async () => {
  requireLocalTestDatabase();
  const role = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  validated = true;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await registerPublications([{ name: "Daily", feedUrl: feed, sourceType: "feed" }]);
  const [row] = await ownerDb.update(publications).set({ hubUrl: "https://hub.test/", websubSecret: secret, websubSubscribedAt: new Date() }).where(eq(publications.feedUrl, feed)).returning({ id: publications.id });
  id = row.id;
});
afterAll(async () => {
  if (validated) {
    await ownerDb.delete(pooledArticles).where(like(pooledArticles.canonicalUrl, `${host}/%`));
    await ownerDb.delete(publications).where(like(publications.feedUrl, `${host}/%`));
  }
  await pool.end(); await ownerPool.end();
  vi.restoreAllMocks();
});

describe("WebSub callback", () => {
  it("answers the hub's verification with its challenge and records the lease", async () => {
    const res = await request(app).get(`/api/websub/${id}`).query({ "hub.mode": "subscribe", "hub.topic": feed, "hub.challenge": "prove-it", "hub.lease_seconds": "864000" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("prove-it");
    const [row] = await ownerDb.select().from(publications).where(eq(publications.id, id));
    expect(row.websubLeaseExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 9 * 86_400_000);
  });

  it("refuses verification for another topic, an unknown publication or an unsubscribe", async () => {
    expect((await request(app).get(`/api/websub/${id}`).query({ "hub.mode": "subscribe", "hub.topic": `${host}/other`, "hub.challenge": "x" })).status).toBe(404);
    expect((await request(app).get(`/api/websub/${randomUUID()}`).query({ "hub.mode": "subscribe", "hub.topic": feed, "hub.challenge": "x" })).status).toBe(404);
    expect((await request(app).get(`/api/websub/${id}`).query({ "hub.mode": "unsubscribe", "hub.topic": feed, "hub.challenge": "x" })).status).toBe(404);
  });

  it("stores the entries of a correctly signed delivery", async () => {
    const body = `<rss version="2.0"><channel><title>Daily</title><item><title>Pushed story</title><link>${host}/pushed</link><description>Just in.</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
    const res = await request(app).post(`/api/websub/${id}`).set("Content-Type", "application/rss+xml")
      .set("X-Hub-Signature", `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`).send(body);
    expect(res.status).toBe(202);
    expect(await findPooledArticle(`${host}/pushed`)).toMatchObject({ title: "Pushed story", source: "Daily", readable: null });
  });

  it("acknowledges but ignores an unsigned or wrongly signed delivery", async () => {
    const body = `<rss version="2.0"><channel><title>Daily</title><item><title>Forged</title><link>${host}/forged</link></item></channel></rss>`;
    expect((await request(app).post(`/api/websub/${id}`).set("Content-Type", "application/rss+xml").send(body)).status).toBe(202);
    expect((await request(app).post(`/api/websub/${id}`).set("Content-Type", "application/rss+xml").set("X-Hub-Signature", "sha256=deadbeef").send(body)).status).toBe(202);
    expect(await findPooledArticle(`${host}/forged`)).toBeNull();
  });

  // WebSub §7: 410 lets the hub end a subscription we no longer hold; a 404 is only retried.
  it("answers 410 Gone for deliveries to a subscription it does not hold", async () => {
    const body = `<rss version="2.0"><channel><title>Daily</title></channel></rss>`;
    expect((await request(app).post(`/api/websub/${randomUUID()}`).set("Content-Type", "application/rss+xml").send(body)).status).toBe(410);
    expect((await request(app).post("/api/websub/pub-1").set("Content-Type", "application/rss+xml").send(body)).status).toBe(410);
    await registerPublications([{ name: "Quiet", feedUrl: `${host}/quiet`, sourceType: "feed" }]);
    const [unsubscribed] = await ownerDb.select({ id: publications.id }).from(publications).where(eq(publications.feedUrl, `${host}/quiet`));
    expect((await request(app).post(`/api/websub/${unsubscribed.id}`).set("Content-Type", "application/rss+xml").send(body)).status).toBe(410);
  });

  // The secret authenticates the hub; a later poll that no longer sees the feed's hub link must not drop pushed stories.
  it("still ingests signed deliveries after a poll cleared the feed's hub", async () => {
    await ownerDb.update(publications).set({ hubUrl: null }).where(eq(publications.id, id));
    const body = `<rss version="2.0"><channel><title>Daily</title><item><title>Hub moved</title><link>${host}/hub-moved</link></item></channel></rss>`;
    const res = await request(app).post(`/api/websub/${id}`).set("Content-Type", "application/rss+xml")
      .set("X-Hub-Signature", `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`).send(body);
    await ownerDb.update(publications).set({ hubUrl: "https://hub.test/" }).where(eq(publications.id, id));
    expect(res.status).toBe(202);
    expect(await findPooledArticle(`${host}/hub-moved`)).toMatchObject({ title: "Hub moved", source: "Daily" });
  });

  it("settles rootless signed XML and still ingests the next delivery", async () => {
    const send = (body: string) => request(app).post(`/api/websub/${id}`)
      .set("Content-Type", "application/rss+xml")
      .set("X-Hub-Signature", `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`)
      .send(body).timeout({ response: 1000, deadline: 2000 });
    const body = `<rss version="2.0"><channel><title>Daily</title><item><title>After invalid XML</title><link>${host}/after-invalid</link></item></channel></rss>`;
    expect((await send(body)).status).toBe(202);
    expect((await send("<!-- no feed root -->")).status).toBe(202);
    expect((await send(body)).status).toBe(202);
    expect(await findPooledArticle(`${host}/after-invalid`)).toMatchObject({ title: "After invalid XML", source: "Daily" });
  });
});
