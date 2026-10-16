import type { Express, Request, RequestHandler } from "express";
import { createHash, createHmac } from "node:crypto";
import { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { requireDbUser } from "../middlewares/requireDbUser";
import { invitationRequestRateLimit, invitationOptOutRateLimit } from "../middlewares/rateLimit";
import { getInvitationDeliveryConfiguration, sendAppEmail } from "../services/email";
import { invitationContent, invitationPreview } from "../services/invitation-content";
import { reserveInvitation, suppressInvitation } from "../services/invitations-store";

const input = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  firstName: z.string().trim().max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).optional(),
  consent: z.literal(true),
  requestId: z.string().uuid().transform(value => value.toLowerCase()),
}).strict();
const tokenBody = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const ACCEPTED = { status: "accepted", message: "Invitation requested. If the address is eligible, we will send it." };
const UNAVAILABLE = { message: "Invitations are temporarily unavailable. Please try again later." };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const noStore: RequestHandler = (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); };

function canSend() {
  return process.env.INVITATIONS_ENABLED !== "false" && !!process.env.RESEND_API_KEY?.trim()
    && (process.env.BETTER_AUTH_SECRET?.length ?? 0) >= 32 && !!getInvitationDeliveryConfiguration();
}

function localDevelopmentBypass(req: Request) {
  if (process.env.NODE_ENV !== "development" || process.env.DEV_AUTH_BYPASS !== "true") return false;
  // Use the TCP peer, never a caller-supplied forwarded address. This exception
  // is for direct local development, not a reverse-proxied deployment.
  const peer = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (!["127.0.0.1", "::1"].includes(peer)) return false;
  if (req.get("forwarded") !== undefined || req.get("x-forwarded-for") !== undefined) return false;
  const config = getInvitationDeliveryConfiguration();
  if (!config) return false;
  const hostname = new URL(config.origin).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

// POSTs must originate from this app, not an arbitrary website using session cookies.
function sameOrigin(req: Request) {
  return req.get("origin") === getInvitationDeliveryConfiguration()?.origin;
}

export function registerInvitationRoutes(app: Express) {
  app.get("/api/invitations/template", noStore, requireDbUser, (_req, res) => {
    res.json({ ...invitationPreview, enabled: canSend() });
  });

  app.post("/api/invitations", noStore, requireDbUser, invitationRequestRateLimit, async (req, res) => {
    const parsed = input.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter a valid email and first name, and confirm permission." });
    if (!canSend()) return res.status(503).json(UNAVAILABLE);
    if (!sameOrigin(req)) return res.status(403).json({ message: "Open Settings in this app to send an invitation." });
    // Production always requires a verified real account. Local bypass is allowed only
    // for an explicitly configured loopback development origin.
    const user = req.dbUser!;
    if ((!user.emailVerified || process.env.DEV_AUTH_BYPASS === "true") && !localDevelopmentBypass(req)) {
      return res.status(403).json({ message: "Sign in with a verified email before inviting friends." });
    }
    try {
      const { email, firstName, requestId } = parsed.data;
      const secret = process.env.BETTER_AUTH_SECRET!;
      const sign = (purpose: string, value: string) => createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");
      // Deterministic for a retry; raw token is never persisted in the database.
      const token = sign("friend-invitation-optout-v1", JSON.stringify([user.id, requestId]));
      const inviterName = (user.name?.trim() || user.firstName?.trim() || "Your friend").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);
      const result = await reserveInvitation({ userId: user.id, email, firstName, inviterName, requestId,
        ipHash: sign("friend-invitation-ip-v1", ipKeyGenerator(req.ip || "unknown")), tokenHash: digest(token) });
      if (result.kind === "limited") {
        res.setHeader("Retry-After", "86400");
        return res.status(429).json({ message: "Invitation limit reached. Please try again tomorrow." });
      }
      if (result.kind === "conflict") return res.status(409).json({ message: "This request was already used with different details. Refresh Settings and try again." });
      if (result.kind === "suppressed") return res.status(202).json(ACCEPTED);
      const config = getInvitationDeliveryConfiguration()!;
      await sendAppEmail({ type: "friend_invitation", invitationId: result.id, recipient: email,
        recipientName: firstName || undefined, dedupeKey: `friend-invitation:${result.id}`,
        invitationUnsubscribeUrl: `${config.invitationPreferencesUrl}#token=${token}`,
        ...invitationContent(inviterName, `${config.origin}/sign-up`),
      });
      // Deliberately identical for queued, sent and suppressed; never disclose membership.
      return res.status(202).json(ACCEPTED);
    } catch {
      return res.status(503).json(UNAVAILABLE);
    }
  });

  // Remains available even if new invitations are switched off. Never mutate on GET:
  // email scanners may visit links before the intended recipient does.
  app.post("/api/public/invitations/unsubscribe", noStore, invitationOptOutRateLimit, async (req, res) => {
    const parsed = tokenBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "This link is invalid or has expired." });
    try {
      if (!await suppressInvitation(digest(parsed.data.token))) return res.status(400).json({ message: "This link is invalid or has expired." });
      return res.json({ status: "unsubscribed" });
    } catch {
      return res.status(503).json({ message: "We could not save your preference. Please try again." });
    }
  });
}