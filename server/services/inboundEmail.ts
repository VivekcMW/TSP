import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import express, { type Request, type RequestHandler } from "express";
import { Parser } from "htmlparser2";
import { z } from "zod";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { validateUrlSync } from "./urlValidator";

/** Provider webhook for forwarded newsletters (Postmark inbound JSON is the documented format). */
export const INBOUND_EMAIL_PATH = "/api/inbound/email";
/** Newsletter HTML regularly exceeds the app's default 100 kB JSON limit. */
export const INBOUND_EMAIL_BODY_LIMIT = "10mb";
export const MAX_ARTICLE_LINKS = 10;
export const ADDRESS_TOKEN_LENGTH = 26;
const ADDRESS_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ADDRESS_TOKEN_PATTERN = new RegExp(`^[a-z0-9]{${ADDRESS_TOKEN_LENGTH}}$`);
const MIN_SECRET_LENGTH = 32;
const MAX_HTML_CHARS = 2_000_000;
const MAX_TEXT_CHARS = 500_000;
const MAX_ANCHORS = 1000;
const TITLE_LIMIT = 300;

export interface InboundEmailConfig { domain: string; secret: string }

export function inboundEmailDomain(env: NodeJS.ProcessEnv = process.env): string | null {
  const domain = env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (!domain || domain.length > 253 || !domain.includes(".")) return null;
  return domain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? domain : null;
}

/** Both the domain and a long webhook secret are required; otherwise forwarding is unavailable. */
export function inboundEmailConfig(env: NodeJS.ProcessEnv = process.env): InboundEmailConfig | null {
  const domain = inboundEmailDomain(env);
  const secret = env.INBOUND_EMAIL_SECRET?.trim();
  if (!domain || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  return { domain, secret };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Accepts HTTP Basic (any user name, the secret as password) or an X-Inbound-Secret header. */
export function inboundSecretFrom(req: Pick<Request, "get">): string | null {
  const basic = req.get("authorization")?.match(/^Basic\s+([A-Za-z0-9+/=]+)\s*$/i);
  if (basic) {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator >= 0 ? decoded.slice(separator + 1) : null;
  }
  return req.get("x-inbound-secret")?.trim() || null;
}

export function inboundSecretMatches(received: string | null, expected: string): boolean {
  // Fixed-length digests: neither content nor length leaks through timing.
  return received !== null && timingSafeEqual(digest(received), digest(expected));
}

/** Runs before body parsing so unauthenticated callers never get a large body parsed. */
export const inboundEmailGate: RequestHandler = (req, res, next) => {
  const config = inboundEmailConfig();
  if (!config) {
    res.status(503).json({ message: "Inbound email is not configured." });
    return;
  }
  if (!inboundSecretMatches(inboundSecretFrom(req), config.secret)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="inbound-email"');
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
};

export const inboundEmailJson = express.json({ limit: INBOUND_EMAIL_BODY_LIMIT });

export function generateAddressToken(): string {
  // Lowercase letters and digits only (about 134 bits): mail systems may lowercase local parts.
  return Array.from({ length: ADDRESS_TOKEN_LENGTH }, () => ADDRESS_ALPHABET[randomInt(ADDRESS_ALPHABET.length)]).join("");
}

export function forwardingAddress(token: string, domain: string): string {
  return `${token}@${domain}`;
}

/** The token in `<token>@domain` or `<token>+anything@domain`, or null for any other address. */
export function recipientToken(address: string, domain: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 1 || address.slice(at + 1).toLowerCase().replace(/\.$/, "") !== domain) return null;
  const token = address.slice(0, at).split("+")[0].trim().toLowerCase();
  return ADDRESS_TOKEN_PATTERN.test(token) ? token : null;
}

export interface InboundEmail {
  recipients: string[];
  from: { address: string | null; name: string | null };
  subject: string | null;
  html: string;
  text: string;
  messageId: string;
  date: string | null;
}

const optionalText = (max: number) => z.string().max(max).nullish();
const addressEntry = z.object({ Email: optionalText(1000), Name: optionalText(1000) }).passthrough();
const postmarkInboundSchema = z.object({
  From: optionalText(2000),
  FromName: optionalText(2000),
  FromFull: addressEntry.nullish(),
  To: optionalText(20_000),
  ToFull: z.array(addressEntry).max(200).nullish(),
  Cc: optionalText(20_000),
  CcFull: z.array(addressEntry).max(200).nullish(),
  BccFull: z.array(addressEntry).max(200).nullish(),
  OriginalRecipient: optionalText(2000),
  Subject: optionalText(20_000),
  MessageID: optionalText(2000),
  Date: optionalText(500),
  HtmlBody: z.string().nullish(),
  TextBody: z.string().nullish(),
  Headers: z.array(z.object({ Name: z.string().max(1000), Value: z.string().max(100_000) }).passthrough()).max(2000).nullish(),
}).passthrough();

const EMAIL_IN_TEXT = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/g;

function emailsIn(value: string | null | undefined): string[] {
  return (value?.match(EMAIL_IN_TEXT) ?? []).map(email => email.toLowerCase());
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\u200b-\u200d\u2060\ufeff]/g;

function cleanLine(value: string | null | undefined, max: number): string | null {
  const cleaned = (value ?? "").replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  return cleaned ? clip(cleaned, max) : null;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function normalizeMessageId(value: string): string {
  const trimmed = value.trim().replace(/^<|>$/g, "").trim();
  return trimmed.length <= 500 ? trimmed : `sha256:${createHash("sha256").update(trimmed).digest("hex")}`;
}

/** Provider adapter: Postmark inbound JSON to a provider-neutral message. Null when the payload is not usable. */
export function parsePostmarkInbound(body: unknown): InboundEmail | null {
  const parsed = postmarkInboundSchema.safeParse(body);
  if (!parsed.success) return null;
  const mail = parsed.data;
  const recipients = [...new Set([
    ...emailsIn(mail.OriginalRecipient),
    ...[...(mail.ToFull ?? []), ...(mail.CcFull ?? []), ...(mail.BccFull ?? [])].flatMap(entry => emailsIn(entry.Email)),
    ...emailsIn(mail.To), ...emailsIn(mail.Cc),
  ])].slice(0, 50);
  const html = (mail.HtmlBody ?? "").slice(0, MAX_HTML_CHARS);
  const text = (mail.TextBody ?? "").slice(0, MAX_TEXT_CHARS);
  if (!recipients.length) return null;
  const header = mail.Headers?.find(entry => entry.Name.toLowerCase() === "message-id")?.Value;
  const fromAddress = emailsIn(mail.FromFull?.Email || mail.From)[0] ?? null;
  const subject = cleanLine(mail.Subject, 500);
  const rawId = header?.trim() || mail.MessageID?.trim()
    || `sha256:${createHash("sha256").update(JSON.stringify([fromAddress, subject, mail.Date, text.slice(0, 5000), html.slice(0, 5000)])).digest("hex")}`;
  return {
    recipients,
    from: { address: fromAddress ? clip(fromAddress, 320) : null, name: cleanLine(mail.FromFull?.Name || mail.FromName, 200) },
    subject,
    html,
    text,
    messageId: normalizeMessageId(rawId),
    date: cleanLine(mail.Date, 200),
  };
}

/** Gmail sends a confirmation (with its code in the subject) before it forwards automatically. */
export function forwardingConfirmation(email: Pick<InboundEmail, "from" | "subject">): { code: string | null } | null {
  const fromGoogle = email.from.address?.endsWith("@google.com") ?? false;
  if (!fromGoogle || !/forwarding confirmation/i.test(email.subject ?? "")) return null;
  return { code: confirmationCode(email.subject) };
}

export function confirmationCode(subject: string | null): string | null {
  return subject?.match(/\(#(\d{6,12})\)/)?.[1] ?? null;
}

const FORWARD_MARKER = /(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:|-{2,}\s*Original Message\s*-{2,})([\s\S]{0,3000})/i;

/** The newsletter's own sender when the message was forwarded by hand (Gmail, Apple Mail, Outlook). */
export function originalSender(text: string): { address: string | null; name: string | null } | null {
  const block = text.match(FORWARD_MARKER)?.[1];
  const line = block?.match(/^[\s>*]*From:\**\s*(.+)$/im)?.[1];
  if (!line) return null;
  const address = emailsIn(line)[0] ?? null;
  const withoutAddress = line.replace(/<[^>]*>|\[[^\]]*\]|mailto:\S+/g, "").split(address ?? "<none>").join("");
  const name = cleanLine(withoutAddress.replace(/["*]/g, ""), 200);
  return address || name ? { address, name } : null;
}

export interface NewsletterSender { address: string | null; name: string | null; label: string; domains: string[] }

function registrableDomain(address: string | null): string | null {
  const host = address?.split("@")[1]?.toLowerCase();
  if (!host) return null;
  const labels = host.split(".");
  // "news.example.co.uk" -> "example.co.uk": keep a common second-level label under a country code.
  const keep = labels.length > 2 && labels.at(-1)!.length === 2 && /^(?:co|com|org|net|ac|gov|edu)$/.test(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export function newsletterSender(email: InboundEmail, plainText = email.text): NewsletterSender {
  const original = originalSender(plainText);
  const address = original?.address ?? email.from.address;
  const name = original ? original.name : email.from.name;
  const domain = registrableDomain(address);
  const label = clip(name || domain || "Unknown sender", 80);
  return {
    address, name, label,
    domains: [...new Set([domain, registrableDomain(email.from.address)].filter((value): value is string => Boolean(value)))],
  };
}

export function newsletterSourceLabel(sender: Pick<NewsletterSender, "label">): string {
  return `Newsletter: ${sender.label}`;
}

export interface ArticleLink { url: string; title: string }
interface Candidate { href: string; text: string }

const FOOTER_TEXT = new RegExp(String.raw`^(?:unsubscribe.*|.*\bunsubscribe\b.*|manage (?:your )?(?:subscriptions?|preferences|email preferences)|(?:update|change|edit) (?:your )?(?:email )?(?:preferences|profile|subscription)|email preferences|preferences|`
  + String.raw`view (?:this |it |the )?(?:email |newsletter )?(?:in|on) (?:your |a |the )?(?:browser|web)|view (?:it )?online|view (?:the )?web version|web version|read (?:it |this )?online|open in (?:your )?browser|`
  + String.raw`forward(?: this)?(?: email| newsletter)?(?: to a friend)?|share(?: this)?(?: email| newsletter| post)?|refer(?: a friend)?|subscribe(?: now| here| for free)?|sign ?up(?: now| here| for free)?|get the app|download (?:the|our) app|`
  + String.raw`privacy(?: policy)?|terms(?: of (?:service|use))?|advertise(?: with us)?|sponsor(?: us| this newsletter)?|contact(?: us)?|follow us.*|like us.*|log ?in|sign ?in|why did i get this|add us to your address book|report spam|powered by .+)$`, "i");
const GENERIC_TEXT = /^(?:read more|read|more|click here|here|link|this link|continue reading|read the full (?:story|article|post)|full (?:story|article)|read (?:the )?(?:story|article|post)|read now|learn more|find out more|see more|watch|watch now|listen|listen now|details|view|open|source|via|article|story|go)$/i;

const SOCIAL_HOSTS = ["twitter.com", "x.com", "facebook.com", "fb.com", "instagram.com", "linkedin.com", "youtube.com", "tiktok.com", "threads.net", "pinterest.com", "bsky.app", "mastodon.social", "t.me", "wa.me", "whatsapp.com", "discord.gg", "discord.com"];
const SOCIAL_PROFILE_SEGMENTS = new Set(["in", "company", "school", "groups", "channel", "c", "user", "hashtag", "home", "explore", "share", "sharer", "sharer.php", "intent", "sharearticle", "sharing", "dialog", "pin"]);
const SKIPPED_HOSTS = ["campaign-archive.com", "mailchi.mp", "apps.apple.com", "itunes.apple.com", "play.google.com", "list-manage.com/unsubscribe", "list-manage.com/profile", "list-manage.com/vcard"];
const SKIPPED_SEGMENTS = new Set([
  "unsubscribe", "unsub", "optout", "opt-out", "subscribe", "subscription", "subscriptions", "manage-subscription", "preferences", "email-preferences",
  "account", "login", "signin", "sign-in", "signup", "sign-up", "register", "advertise", "sponsor", "sponsorship", "refer", "referral", "referrals",
  "privacy", "privacy-policy", "terms", "terms-of-service", "tos", "legal", "about", "contact", "feedback", "app-link", "disable_email",
  "webversion", "web-version", "view-in-browser", "view_in_browser", "viewonline", "view-online", "online-version",
]);
const REDIRECT_PARAMS = ["url", "u", "q", "target", "dest", "destination", "redirect", "redirect_url", "redirect_to", "redirecturl", "to", "link", "goto", "z", "href", "out"];
const REDIRECT_PATH = /(?:^|\/)(?:url|l\.php|redirect|redir|out|link|click|track|goto|away|r|l)(?:\/|$)/i;
const REDIRECT_HOSTS = /(?:^|\.)(?:safelinks\.protection\.outlook\.com|l\.facebook\.com|lm\.facebook\.com|l\.instagram\.com|out\.reddit\.com|t\.umblr\.com|href\.li|slack-redir\.net)$/i;
const TRACKING_PARAMETERS = new Set(["_hsenc", "_hsmi", "mkt_tok", "ck_subscriber_id", "vero_id", "vero_conv", "oly_enc_id", "oly_anon_id", "__s", "triedredirect", "mc_cid", "mc_eid"]);
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".invalid"];

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function onHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment).toLowerCase(); } catch { return segment.toLowerCase(); }
  });
}

/** Publicly routable-looking http(s) URL. Syntax only: nothing is fetched or resolved here. */
export function isPublicLookingUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password || url.href.length > 2048) return false;
  const host = hostOf(url);
  if (isIP(host) || !host.includes(".") || host === "localhost" || LOCAL_SUFFIXES.some(suffix => host.endsWith(suffix))) return false;
  return validateUrlSync(url.href);
}

function isShareOrProfileLink(url: URL): boolean {
  const host = hostOf(url);
  if (!SOCIAL_HOSTS.some(domain => onHost(host, domain))) return false;
  const segments = segmentsOf(url);
  if (onHost(host, "youtube.com") && segments[0] === "watch" && url.searchParams.has("v")) return false;
  return segments.length <= 1 || SOCIAL_PROFILE_SEGMENTS.has(segments[0]) || segments[0].startsWith("@");
}

/** The destination of a redirect wrapper when it is a plain absolute URL in a query parameter. */
export function unwrapRedirect(url: URL): URL | null {
  if (!REDIRECT_HOSTS.test(hostOf(url)) && !REDIRECT_PATH.test(url.pathname)) return null;
  for (const name of REDIRECT_PARAMS) {
    const value = [...url.searchParams.entries()].find(([key]) => key.toLowerCase() === name)?.[1]?.trim();
    if (!value || !/^https?:\/\//i.test(value)) continue;
    try { return new URL(value); } catch { /* not a plain URL */ }
  }
  return null;
}

function stripTracking(url: URL): string | null {
  const kept = url.search.slice(1).split("&").filter(part => {
    if (!part) return false;
    let key = part.split("=", 1)[0];
    try { key = decodeURIComponent(key.replace(/\+/g, " ")); } catch { return true; }
    const lower = key.toLowerCase();
    return !lower.startsWith("utm_") && !TRACKING_PARAMETERS.has(lower);
  });
  url.search = kept.length ? `?${kept.join("&")}` : "";
  return canonicalHttpUrl(url.href);
}

function isSkippedDestination(url: URL, senderDomains: string[]): boolean {
  const host = hostOf(url);
  const hostAndPath = `${host}${url.pathname.toLowerCase()}`;
  if (SKIPPED_HOSTS.some(entry => entry.includes("/") ? hostAndPath.includes(entry) : onHost(host, entry))) return true;
  if (url.pathname === "/" || url.pathname === "") return true; // homepages, including the sender's own
  if (/unsubscribe|optout|opt-out/i.test(url.href)) return true;
  if (IMAGE_PATH.test(url.pathname)) return true;
  const segments = segmentsOf(url);
  if (segments.some(segment => SKIPPED_SEGMENTS.has(segment))) return true;
  // The sender's own site: only its homepage-like single-segment pages are skipped (posts stay).
  if (senderDomains.some(domain => onHost(host, domain)) && segments.length === 1 && !/[-_]/.test(segments[0])) return true;
  return isShareOrProfileLink(url);
}

function normalizedText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, " ").replace(/\u00ad|\u034f/g, "").replace(/\s+/g, " ").trim();
}

function meaningfulTitle(text: string): string | null {
  const cleaned = normalizedText(text).replace(/^[\s→»›>|·•\-–—:]+|[\s→»›>|·•\-–—:]+$/g, "");
  if (cleaned.length < 2 || GENERIC_TEXT.test(cleaned.replace(/[.!…]+$/, ""))) return null;
  return clip(cleaned, TITLE_LIMIT);
}

/** A readable title from an article slug such as /2026/05/why-retail-media-grew, else the host name. */
export function titleFromUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return clip(raw, TITLE_LIMIT); }
  const host = hostOf(url).replace(/^www\./, "");
  const slug = [...segmentsOf(url)].reverse().find(segment => /[a-z]/i.test(segment) && /[-_+ ]/.test(segment));
  if (!slug) return host;
  const words = slug.replace(/\.(?:html?|php|aspx?)$/i, "").replace(/[-_+]+/g, " ").replace(/\b[0-9a-f]{8,}\b|\b\d{5,}\b/gi, "").replace(/\s+/g, " ").trim();
  if (words.split(" ").length < 2 || words.length < 8) return host;
  return clip(words.charAt(0).toUpperCase() + words.slice(1), TITLE_LIMIT);
}

/** Visible anchors in document order, with entities decoded. Scripts, styles and titles are ignored. */
export function anchorsFromHtml(html: string): { anchors: Candidate[]; plainText: string } {
  const anchors: Candidate[] = [];
  const plain: string[] = [];
  let current: (Candidate & { alt: string }) | null = null;
  let hidden = 0;
  const finish = () => {
    if (current && anchors.length < MAX_ANCHORS) anchors.push({ href: current.href, text: normalizedText(current.text) || normalizedText(current.alt) });
    current = null;
  };
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "script" || name === "style" || name === "title") hidden++;
      if (name === "a") { finish(); if (attributes.href) current = { href: attributes.href, text: "", alt: "" }; }
      if (name === "img" && current && attributes.alt) current.alt += ` ${attributes.alt}`;
      if (["br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "table"].includes(name)) plain.push("\n");
    },
    ontext(text) {
      if (hidden) return;
      if (current) current.text += text;
      if (plain.length < 50_000) plain.push(text);
    },
    onclosetag(name) {
      if (name === "script" || name === "style" || name === "title") hidden = Math.max(0, hidden - 1);
      if (name === "a") finish();
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(html);
  parser.end();
  finish();
  return { anchors, plainText: plain.join("").replace(/[ \t]+\n/g, "\n") };
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;

function textContext(value: string): string {
  return normalizedText(value).replace(/[\s\-–—:(<[|]+$/, "").replace(/^[\s>*•·|-]*(?:\[?\d{1,2}[.)\]](?:\s+|$))?/, "");
}

/** Plain-text bodies: the words before a URL on its line, or the line above, are its title. */
export function anchorsFromText(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    let previousEnd = 0;
    for (const match of line.matchAll(URL_IN_TEXT)) {
      if (candidates.length >= MAX_ANCHORS) return;
      const start = match.index ?? 0;
      const href = match[0].replace(/[.,;:!?)\]}>]+$/, "");
      let context = line.slice(previousEnd, start);
      previousEnd = start + match[0].length;
      if (!line.slice(0, start).trim()) {
        const previous = lines.slice(0, index).reverse().find(entry => entry.trim());
        context = previous && previous.length <= 200 && !/https?:\/\//i.test(previous) ? previous : "";
      }
      candidates.push({ href, text: textContext(context) });
    }
  });
  return candidates;
}

function collectLinks(candidates: Candidate[], senderDomains: string[]): Map<string, ArticleLink> {
  const links = new Map<string, ArticleLink>();
  for (const candidate of candidates) {
    const text = normalizedText(candidate.text);
    if (text && FOOTER_TEXT.test(text)) continue;
    const raw = candidate.href.replace(/\s+/g, "").replace(CONTROL_CHARACTERS, "");
    if (!/^https?:\/\//i.test(raw)) continue; // mailto:, tel:, relative and fragment links
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (isShareOrProfileLink(url)) continue;
    for (let depth = 0; depth < 3; depth++) {
      const inner = unwrapRedirect(url);
      if (!inner) break;
      url = inner;
    }
    if (!isPublicLookingUrl(url) || isSkippedDestination(url, senderDomains)) continue;
    const key = stripTracking(url);
    if (!key) continue;
    const title = meaningfulTitle(text);
    const existing = links.get(key);
    if (!existing) links.set(key, { url: key, title: title ?? "" });
    else if (!existing.title && title) existing.title = title;
  }
  return links;
}

/**
 * Article links from a newsletter, in document order: footer, social, tracking and homepage links are
 * skipped, plain redirect wrappers are unwrapped, URLs are normalized and deduplicated, and at most
 * MAX_ARTICLE_LINKS are returned. `found` counts every article link before the cap.
 */
export function extractArticleLinks(input: { html?: string; text?: string; senderDomains?: string[] }): { links: ArticleLink[]; found: number } {
  const senderDomains = input.senderDomains ?? [];
  let links = input.html?.trim() ? collectLinks(anchorsFromHtml(input.html).anchors, senderDomains) : new Map<string, ArticleLink>();
  if (!links.size && input.text?.trim()) links = collectLinks(anchorsFromText(input.text), senderDomains);
  const all = [...links.values()].map(link => ({ url: link.url, title: link.title || titleFromUrl(link.url) }));
  return { links: all.slice(0, MAX_ARTICLE_LINKS), found: Math.min(all.length, 1000) };
}
