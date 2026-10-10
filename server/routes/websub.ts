import express, { type Express } from "express";
import { confirmWebSubLease, publicationById, storePooledArticles } from "../services/articlePool";
import { verifyHubSignature } from "../services/websub";
import { parseFeedContent } from "../services/universalFeedParser.js";

const MAX_PUSHED_ENTRIES = 30;

/** WebSub hub callbacks: verification by GET, signed content by POST. Public, no session. */
export function registerWebSubRoutes(app: Express) {
  app.get("/api/websub/:id", async (req, res) => {
    const { "hub.mode": mode, "hub.topic": topic, "hub.challenge": challenge, "hub.lease_seconds": lease } = req.query;
    if (mode !== "subscribe" || typeof topic !== "string" || typeof challenge !== "string" || challenge.length > 512) return res.status(404).end();
    const confirmed = await confirmWebSubLease(req.params.id, topic, Number(lease) || 0).catch(() => false);
    if (!confirmed) return res.status(404).end();
    res.type("text/plain").send(challenge);
  });

  app.post("/api/websub/:id", express.raw({ type: () => true, limit: "2mb" }), async (req, res) => {
    const publication = await publicationById(req.params.id).catch(() => null);
    if (!publication?.websubSecret || !publication.hubUrl) return res.status(404).end();
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    // An unsigned or wrongly signed delivery is ignored but acknowledged, so the hub doesn't retry it.
    if (!verifyHubSignature(req.header("x-hub-signature"), publication.websubSecret, body)) {
      console.warn(`[websub] rejected an unsigned delivery for publication ${publication.id}`);
      return res.status(202).end();
    }
    const items = await parseFeedContent(body.toString("utf8")).catch(() => null);
    if (items?.length) {
      await storePooledArticles(items.slice(0, MAX_PUSHED_ENTRIES).map(item => ({
        link: item.link, title: item.title, source: publication.name, content: item.content,
        publishedAt: item.publishedAt ?? item.pubDate, publicationId: publication.id,
      }))).catch(() => undefined);
    }
    res.status(202).end();
  });
}
