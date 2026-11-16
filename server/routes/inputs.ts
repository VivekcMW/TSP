import type { Express, Request, RequestHandler, Response } from "express";
import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import { z } from "zod";
import { authedOf, requireDbUser } from "../middlewares/requireDbUser";
import { requirePermission } from "../middlewares/requirePermission";
import { RateLimitStoreUnavailableError, RecoverableRateLimitRedisStore } from "../middlewares/rateLimitRedisStore";
import { redis } from "../lib/redis";
import { storage, UserNoteLimitError, type TenantScope } from "../storage";
import * as repo from "../repositories/inputs";
import { can } from "../services/permissions";
import { resolveTenantContext } from "../services/tenancy";
import { resolvePublicHttpUrl, validateUrlSync } from "../services/urlValidator";
import { decryptStoredCredential, encryptWebhookUrl } from "../services/webhookSecrets";
import {
  CAPTURE_PATH, CAPTURE_SELECTION_LIMIT, CAPTURE_NOTE_LIMIT, captureCors, captureNoteText, generateCaptureToken,
  hashSecretToken, isCaptureTokenFormat, readBearerToken,
} from "../services/captureTokens";
import {
  INBOUND_EMAIL_PATH, anchorsFromHtml, confirmationCode, extractArticleLinks, forwardingAddress, forwardingConfirmation,
  generateAddressToken, inboundEmailConfig, inboundEmailGate, inboundEmailJson, newsletterSender, newsletterSourceLabel,
  parsePostmarkInbound, recipientToken, titleFromUrl, type InboundEmail,
} from "../services/inboundEmail";
import type { InboundAddress, InboundMessage } from "@shared/schema";

export const CAPTURE_HOURLY_LIMIT = 60;
const CAPTURE_IP_HOURLY_LIMIT = 600;
const HOUR_MS = 60 * 60 * 1000;
const TITLE_LIMIT = 300;
const INVALID_KEY = "This key is not valid. It may have been revoked. Create a new key in TheSocialPundit.";

const labelSchema = z.object({ label: z.string().trim().min(1).max(60).optional() });
const captureSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  title: z.string().max(2000).nullish(),
  selection: z.string().max(CAPTURE_SELECTION_LIMIT).nullish(),
  note: z.string().max(CAPTURE_NOTE_LIMIT).nullish(),
});

function limiter(name: string, options: Partial<Options>): RequestHandler {
  const client = redis;
  const limit = rateLimit({
    windowMs: HOUR_MS, standardHeaders: true, legacyHeaders: false, passOnStoreError: false,
    store: client ? new RecoverableRateLimitRedisStore(`rl:${name}:`, (...args) => client.call(args[0], ...args.slice(1))) : undefined,
    ...options,
  });
  return (req, res, next) => limit(req, res, error => {
    if (error instanceof RateLimitStoreUnavailableError) {
      res.setHeader("Retry-After", "5");
      res.status(503).json({ message: error.message });
      return;
    }
    next(error);
  });
}

const captureIpRateLimit = limiter("capture-ip", {
  limit: CAPTURE_IP_HOURLY_LIMIT,
  keyGenerator: req => ipKeyGenerator(req.ip || "anonymous"),
  message: { message: "Too many saves from this network. Try again later." },
});

// Keyed by the token's hash, never the token itself.
const captureTokenRateLimit = limiter("capture-token", {
  limit: CAPTURE_HOURLY_LIMIT,
  keyGenerator: req => hashSecretToken(readBearerToken(req.get("authorization")) ?? ""),
  message: { message: `You can save up to ${CAPTURE_HOURLY_LIMIT} pages an hour with one key. Try again later.` },
});

/** A token's owner may act only while still a member who can write to their own inbox. */
async function writableScope(owner: { tenantId: string; userId: string }): Promise<TenantScope | null> {
  const context = await resolveTenantContext(owner.userId, owner.tenantId);
  if (!context || context.viaPlatformRole) return null;
  if (!can({ role: context.role, platformRole: context.platformRole, viaPlatformRole: false }, "inbox:write:own")) return null;
  return { tenantId: context.tenantId, userId: context.userId };
}

function encryptedOrNull(token: string): string | null {
  try { return encryptWebhookUrl(token); }
  catch { return null; }
}

function storedAddressEmail(address: InboundAddress, domain: string): string | null {
  if (!address.tokenEncrypted) return null;
  try { return forwardingAddress(decryptStoredCredential(address.tokenEncrypted), domain); }
  catch { return null; }
}

function addressView(address: InboundAddress, email: string | null) {
  return { email, hint: address.tokenHint, createdAt: address.createdAt, rotatedAt: address.rotatedAt, disabled: address.disabled };
}

function messageView(message: InboundMessage) {
  return {
    id: message.id, fromName: message.fromName, fromAddress: message.fromAddress, subject: message.subject, receivedAt: message.receivedAt,
    linksFound: message.linksFound, itemsCreated: message.itemsCreated, status: message.status,
    confirmationCode: message.status === "confirmation" ? confirmationCode(message.subject) : null,
  };
}

function tokenView(token: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null }) {
  return { id: token.id, label: token.label, hint: token.tokenHint, createdAt: token.createdAt, lastUsedAt: token.lastUsedAt };
}

function notConfigured(res: Response) {
  return res.status(503).json({ message: "Newsletter forwarding is not available in this environment.", code: "inbound_unavailable" });
}

function newAddressSecret() {
  const token = generateAddressToken();
  return { token, secret: { hash: hashSecretToken(token), hint: token.slice(-4), encrypted: encryptedOrNull(token) } };
}

export type InboundOutcome = "unknown_recipient" | "duplicate" | "rate_limited" | "confirmation" | "processed";

async function recipientOwner(email: InboundEmail, domain: string) {
  for (const recipient of email.recipients) {
    const token = recipientToken(recipient, domain);
    if (!token) continue;
    const owner = await repo.resolveInboundAddress(hashSecretToken(token));
    if (owner) return owner;
  }
  return undefined;
}

/** Records the message and saves its article links to the owner's Shortlist. Pages are never fetched here. */
export async function receiveInboundEmail(email: InboundEmail, domain: string): Promise<InboundOutcome> {
  const owner = await recipientOwner(email, domain);
  const scope = owner ? await writableScope(owner) : null;
  if (!scope) return "unknown_recipient";
  const plainText = email.text.trim() ? email.text : anchorsFromHtml(email.html).plainText;
  const sender = newsletterSender(email, plainText);
  const reservation = await repo.reserveInboundMessage(scope, {
    messageId: email.messageId, fromAddress: sender.address, fromName: sender.name, subject: email.subject,
  });
  if (reservation.outcome !== "reserved") return reservation.outcome;
  try {
    if (forwardingConfirmation(email)) {
      await repo.finishInboundMessage(scope, reservation.id, { status: "confirmation", linksFound: 0, itemsCreated: 0 });
      return "confirmation";
    }
    const { links, found } = extractArticleLinks({ html: email.html, text: email.text, senderDomains: sender.domains });
    const subject = email.subject?.replace(/^(?:(?:fwd?|fw):\s*)+/i, "").trim();
    let created = 0;
    for (const link of links) {
      const result = await storage.addInboxItem(scope, {
        headline: link.title,
        source: newsletterSourceLabel(sender),
        articleUrl: link.url,
        summary: subject ? `From the newsletter “${subject}”.` : null,
        matchedKeywords: [],
        relevanceScore: "0",
        relevanceReason: "Added from a forwarded newsletter. Relevance has not been scored.",
        status: "saved",
      });
      if (!result.alreadyExists) created++;
    }
    await repo.finishInboundMessage(scope, reservation.id, { status: "processed", linksFound: found, itemsCreated: created });
    return "processed";
  } catch (error) {
    await repo.releaseInboundMessage(scope, reservation.id).catch(() => undefined);
    throw error;
  }
}

function hostLabel(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

function captureTitle(raw: string | null | undefined, url: string): string {
  const title = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!title) return titleFromUrl(url);
  return title.length <= TITLE_LIMIT ? title : `${title.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

async function capture(req: Request, res: Response) {
  const token = readBearerToken(req.get("authorization"));
  if (!token || !isCaptureTokenFormat(token)) return res.status(401).json({ message: "Add your TheSocialPundit key to save pages." });
  const owner = await repo.resolveCaptureToken(hashSecretToken(token));
  const scope = owner ? await writableScope(owner) : null;
  if (!owner || !scope) return res.status(401).json({ message: INVALID_KEY });

  const parsed = captureSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: `Send the page address. Selected text can be up to ${CAPTURE_SELECTION_LIMIT} characters and a note up to ${CAPTURE_NOTE_LIMIT}.` });
  }
  const { url, selection, note } = parsed.data;
  if (!validateUrlSync(url)) return res.status(400).json({ message: "Only public http or https pages can be saved." });
  const publicUrl = await resolvePublicHttpUrl(url);
  if (!publicUrl.ok) return res.status(400).json({ message: publicUrl.reason });

  const title = captureTitle(parsed.data.title, url);
  const quote = selection?.replace(/\s+/g, " ").trim();
  const { item, alreadyExists } = await storage.addInboxItem(scope, {
    headline: title,
    source: hostLabel(url),
    articleUrl: url,
    summary: quote ? (quote.length <= 500 ? quote : `${quote.slice(0, 499).trimEnd()}…`) : null,
    matchedKeywords: [],
    relevanceScore: "0",
    relevanceReason: "Saved from the web. Relevance has not been scored.",
    status: "saved",
  });
  // An explicit save moves a story you already have into Shortlist.
  const saved = alreadyExists && item.status !== "saved" ? (await storage.updateInboxItem(scope, item.id, { status: "saved" })) ?? item : item;

  let noteCreated = false;
  let noteMessage: string | null = null;
  const noteText = captureNoteText({ title, selection, note });
  if (noteText) {
    try { await storage.createUserNote(scope, noteText); noteCreated = true; }
    catch (error) {
      if (!(error instanceof UserNoteLimitError)) throw error;
      noteMessage = error.message;
    }
  }
  await repo.touchCaptureToken(scope, owner.id).catch(() => console.warn("[capture] Could not record key use"));
  res.status(alreadyExists ? 200 : 201).json({
    item: { id: saved.id, headline: saved.headline, articleUrl: saved.articleUrl, status: saved.status },
    created: !alreadyExists,
    noteCreated,
    message: alreadyExists ? "Already saved. It is in your Shortlist." : "Saved to your Shortlist.",
    ...(noteMessage ? { noteMessage } : {}),
  });
}

/** Phase 6: newsletter forwarding (inbound email) and save-from-any-page capture. */
export function registerInputsRoutes(app: Express) {
  app.get("/api/inputs", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    try {
      const { tenant } = authedOf(req);
      const scope = { tenantId: tenant.tenantId, userId: tenant.userId };
      const config = inboundEmailConfig();
      const [address, recent, tokens] = await Promise.all([
        config ? repo.getInboundAddress(scope) : undefined,
        config ? repo.listInboundMessages(scope) : [],
        repo.listCaptureTokens(scope),
      ]);
      // Staff reading a member's workspace must not see the address: it grants write access.
      const email = address && config && !tenant.viaPlatformRole ? storedAddressEmail(address, config.domain) : null;
      res.setHeader("Cache-Control", "no-store");
      res.json({
        forwarding: {
          available: Boolean(config),
          domain: config?.domain ?? null,
          dailyLimit: repo.INBOUND_DAILY_MESSAGE_LIMIT,
          address: address ? addressView(address, email) : null,
          recent: recent.map(messageView),
        },
        capture: { tokens: tokens.map(tokenView), limit: repo.CAPTURE_TOKEN_LIMIT, hourlyLimit: CAPTURE_HOURLY_LIMIT },
      });
    } catch (error) {
      console.error("Error loading inputs:", error);
      res.status(500).json({ message: "Failed to load inputs" });
    }
  });

  app.post("/api/inputs/address", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    const config = inboundEmailConfig();
    if (!config) return notConfigured(res);
    try {
      const scope = authedOf(req).tenant;
      const fresh = newAddressSecret();
      const { address, created } = await repo.createInboundAddress(scope, fresh.secret);
      res.setHeader("Cache-Control", "no-store");
      if (created) return res.status(201).json(addressView(address, forwardingAddress(fresh.token, config.domain)));
      if (!address.disabled) return res.json(addressView(address, storedAddressEmail(address, config.domain)));
      const enabled = await repo.replaceInboundAddressToken(scope, fresh.secret);
      if (!enabled) return res.status(404).json({ message: "Forwarding address not found" });
      res.json(addressView(enabled, forwardingAddress(fresh.token, config.domain)));
    } catch (error) {
      console.error("Error creating forwarding address:", error);
      res.status(500).json({ message: "Failed to create the forwarding address" });
    }
  });

  app.post("/api/inputs/address/rotate", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    const config = inboundEmailConfig();
    if (!config) return notConfigured(res);
    try {
      const fresh = newAddressSecret();
      const address = await repo.replaceInboundAddressToken(authedOf(req).tenant, fresh.secret);
      if (!address) return res.status(404).json({ message: "Create a forwarding address first." });
      res.setHeader("Cache-Control", "no-store");
      res.json(addressView(address, forwardingAddress(fresh.token, config.domain)));
    } catch (error) {
      console.error("Error rotating forwarding address:", error);
      res.status(500).json({ message: "Failed to change the forwarding address" });
    }
  });

  app.delete("/api/inputs/address", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      if (!await repo.disableInboundAddress(authedOf(req).tenant)) return res.status(404).json({ message: "Forwarding address not found" });
      res.json({ disabled: true });
    } catch (error) {
      console.error("Error turning off forwarding address:", error);
      res.status(500).json({ message: "Failed to turn off the forwarding address" });
    }
  });

  app.get("/api/inputs/capture-tokens", requireDbUser, requirePermission("inbox:read:own"), async (req, res) => {
    try { res.json((await repo.listCaptureTokens(authedOf(req).tenant)).map(tokenView)); }
    catch (error) { console.error("Error listing capture keys:", error); res.status(500).json({ message: "Failed to load keys" }); }
  });

  app.post("/api/inputs/capture-tokens", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    const parsed = labelSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Name the key in 60 characters or fewer." });
    try {
      const generated = generateCaptureToken();
      const row = await repo.createCaptureToken(authedOf(req).tenant, { hash: generated.hash, hint: generated.hint }, parsed.data.label ?? "Browser");
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json({ ...tokenView(row), token: generated.token });
    } catch (error) {
      if (error instanceof repo.CaptureTokenLimitError) return res.status(409).json({ message: error.message });
      console.error("Error creating capture key:", error);
      res.status(500).json({ message: "Failed to create the key" });
    }
  });

  app.delete("/api/inputs/capture-tokens/:id", requireDbUser, requirePermission("inbox:write:own"), async (req, res) => {
    try {
      if (!await repo.revokeCaptureToken(authedOf(req).tenant, req.params.id)) return res.status(404).json({ message: "Key not found" });
      res.json({ revoked: true });
    } catch (error) {
      console.error("Error revoking capture key:", error);
      res.status(500).json({ message: "Failed to revoke the key" });
    }
  });

  app.post(INBOUND_EMAIL_PATH, inboundEmailGate, inboundEmailJson, async (req, res) => {
    const config = inboundEmailConfig();
    if (!config) return notConfigured(res);
    const email = parsePostmarkInbound(req.body);
    if (!email) return res.status(400).json({ message: "Unrecognised inbound email payload" });
    try {
      console.info(`[inbound-email] ${await receiveInboundEmail(email, config.domain)}`);
      // The same answer for every well-formed message: the provider learns nothing about which addresses exist.
      res.json({ received: true });
    } catch {
      console.error("[inbound-email] Processing failed");
      res.status(500).json({ message: "Processing failed" });
    }
  });

  app.options(CAPTURE_PATH, captureCors);
  app.post(CAPTURE_PATH, captureCors, captureIpRateLimit, captureTokenRateLimit, async (req, res) => {
    try { await capture(req, res); }
    catch (error) {
      console.error("[capture] Save failed", error instanceof Error ? error.name : "");
      if (!res.headersSent) res.status(500).json({ message: "Could not save this page. Try again." });
    }
  });
}
