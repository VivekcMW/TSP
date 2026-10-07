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
    await ownerDb.delete(publications).where(eq(publications.feedUrl, feed));
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
    expect((await request(app).post(`/api/websub/${randomUUID()}`).set("Content-Type", "application/rss+xml").send(body)).status).toBe(404);
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
