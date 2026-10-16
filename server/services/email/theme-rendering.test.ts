import path from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lightColors, platformBrand, type ColorToken } from "../../../client/src/design/tokens";
import type { AppEmail } from "./index";
import type { EmailContent, emailTemplates } from "./templates";

// Rendering only: actual owned modules, bundled in memory. No dotenv, ambient
// process, SDK, queue, DB connection or delivery function enters the sandbox.
// APP_URL is a compiler literal, not an environment read or mutation.
const origin = "https://email-theme.test";
type Templates = typeof emailTemplates;
type Rendering = {
  wrapEmail: (email: AppEmail) => string;
  emailColor: (token: ColorToken) => string;
  emailTemplates: Templates;
  sendWelcomeEmail: (email: string, name: string, industry?: string) => Promise<unknown>;
};
let rendering: Rendering;
const outbox: AppEmail[] = [];
const forbiddenCalls: string[] = [];
const lookups: string[] = [];

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const blocked = (name: string) => `(...args) => globalThis.__forbidden(${JSON.stringify(name)})`;
  const stubs: Record<string, string> = {
    resend: 'export class Resend { constructor() { globalThis.__forbidden("Resend constructor"); } }',
    bull: 'export default class Bull { constructor() { globalThis.__forbidden("Bull constructor"); } }',
    "node:crypto": `export const randomUUID = ${blocked("delivery identity")};`,
    "./preferences": `export const getEmailPreferences = ${blocked("preferences")};`,
    "./policy": `export const isEssentialEmail = ${blocked("policy")}, preferenceEnabled = ${blocked("policy")};`,
    "./delivery-store": ["beginDelivery", "claimDelivery", "deliveryKey", "finishDelivery", "recoverEmailDeliveries"]
      .map(name => `export const ${name} = ${blocked(name)};`).join("\n"),
    "../../lib/redis-options": `export const queuePrefix = ${blocked("Redis configuration")};`,
    "../invitations-store": `export const invitationDeliveryAllowed = ${blocked("invitation store")};`,
    "../db": `export const db = { select() {
      globalThis.__lookups.push("mock recipient lookup");
      return { from() { return this; }, where() { return this; }, async limit() { return [{ id: "fixture-user" }]; } };
    } };`,
    "@shared/schema": 'export const users = { id: "id", email: "email" };',
    "drizzle-orm": 'export const eq = (column, value) => ({ column, value });',
    "./email": `export const sendAppEmail = async email => {
      globalThis.__outbox.push(email); return { messageId: "captured-not-sent" };
    };
    export const sendVerificationEmail = ${blocked("verification delivery")};
    export const sendPasswordResetEmail = ${blocked("reset delivery")};`,
  };
  const bundle = await build({
    stdin: { contents: `
      export { wrapEmail } from "./server/services/email/index";
      export { emailColor, emailTemplates } from "./server/services/email/templates";
      export { sendWelcomeEmail } from "./server/services/emailService";
    `, resolveDir: root, loader: "ts" },
    absWorkingDir: root, bundle: true, write: false, platform: "node", format: "cjs",
    define: { "process.env.APP_URL": JSON.stringify(origin), "process.env": "{}" },
    plugins: [{ name: "email-rendering-only", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (Object.hasOwn(stubs, args.path)) return { path: args.path, namespace: "email-style-mock" };
        if (args.path === "@shared/newsletter" || args.path === "@shared/platform-labels") {
          return { path: path.join(root, "shared", `${args.path.slice("@shared/".length)}.ts`) };
        }
      });
      builder.onLoad({ filter: /.*/, namespace: "email-style-mock" }, args => ({ contents: stubs[args.path], loader: "js" }));
    } }],
  });
  const module = { exports: {} };
  const forbidden = (name: string): never => {
    forbiddenCalls.push(name);
    throw new Error(`Rendering crossed a forbidden boundary: ${name}`);
  };
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, URL,
    __outbox: outbox, __lookups: lookups, __forbidden: forbidden,
    require: (name: string) => forbidden(`unmocked import ${name}`),
    fetch: () => forbidden("network"),
    setTimeout: () => forbidden("timer"), setInterval: () => forbidden("worker"),
  }, { timeout: 5_000 });
  rendering = module.exports as Rendering;
}, 30_000);

beforeEach(() => { outbox.length = 0; lookups.length = 0; });
afterEach(() => { expect(forbiddenCalls).toEqual([]); });

function render(content: EmailContent) {
  return rendering.wrapEmail({ type: "verification", recipient: "reader@example.test", recipientName: "Ada <Reader>", ...content });
}

function expectEmailSafeStyles(html: string) {
  expect(html).not.toMatch(/var\(|hsl\(|oklch\(|linear-gradient\(/i);
  expect(html).not.toMatch(/#(?:1b2a4a|12203d|17233d|c99a3e|d7b56d|f4f6f1|e8edf5|f2f5fa)\b|124,\s*59,\s*237/i);
  expect(html).not.toContain("undefined");
}

const story = { source: "Research & Co", headline: "An industry development", url: "https://news.test/story?a=1&b=2" };
const cases: { name: string; content: (templates: Templates) => EmailContent }[] = [
  { name: "welcome", content: t => t.welcome("Technology & SaaS") },
  { name: "newsletter confirmation", content: t => t.newsletterConfirmation(`${origin}/confirm?token=fixture`) },
  { name: "password changed", content: t => t.passwordChanged() },
  { name: "payment receipt", content: t => t.paymentSucceeded({ planName: "Pro", amountMinor: 1000, currency: "USD", paymentId: "pay_fixture", paidAt: new Date("2026-10-01T00:00:00Z") }) },
  { name: "failed payment", content: t => t.paymentFailed("Try another payment method.") },
  { name: "cancelled subscription", content: t => t.subscriptionCancelled(null) },
  { name: "published post", content: t => t.postPublished("linkedin") },
  { name: "failed post", content: t => t.postFailed("twitter", "Connection unavailable.") },
  { name: "digest", content: t => t.dailyDigest([{ ...story, summary: "The saved summary." }]) },
  { name: "weekly reminder", content: t => t.reminderWeekly({ firstName: "Ada", topics: ["Research"], stories: [story], variant: 0 }) },
  { name: "empty weekly reminder", content: t => t.reminderWeekly({ firstName: null, topics: [], stories: [], variant: 1 }) },
  { name: "single reminder", content: t => t.reminderSingle({ story, platform: "linkedin" }) },
  { name: "empty single reminder", content: t => t.reminderSingle({ story: null, platform: "twitter" }) },
  { name: "check-in", content: t => t.reminderCheckIn({ firstName: "Ada" }) },
  { name: "product update", content: t => t.productUpdate("An update", "A product improvement.", `${origin}/update`) },
];

describe("Ink/Cobalt email rendering (transport and DB imports fully mocked)", () => {
  it("converts every authored token to legacy-compatible RGB without browser variables", () => {
    for (const token of Object.keys(lightColors) as ColorToken[]) {
      const rgb = rendering.emailColor(token);
      expect(rgb).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      expect(rgb.match(/\d+/g)!.every(value => Number(value) >= 0 && Number(value) <= 255)).toBe(true);
    }
    expect(rendering.emailColor("foreground")).toBe("rgb(15, 23, 42)");
    expect(rendering.emailColor("background")).toBe("rgb(248, 250, 252)");
    expect(rendering.emailColor("primary")).toBe("rgb(29, 78, 216)");
    expect(rendering.emailColor("accent")).toBe("rgb(239, 246, 255)");
  });

  it.each(cases)("renders $name with readable whole-surface pairs and unchanged content/links", ({ content }) => {
    const email = content(rendering.emailTemplates);
    const html = render(email);
    const color = rendering.emailColor;
    expectEmailSafeStyles(html);
    expect(html).toContain(`<header style="background:${color("card")};color:${color("card-foreground")};`);
    expect(html).toContain(`border-bottom:3px solid ${color("primary")}`);
    expect(html).toContain(`background:${color("primary")};color:${color("primary-foreground")};`);
    expect(html).toContain(email.html);
    if (email.afterCta) expect(html).toContain(email.afterCta);
    expect(html).toContain(`>${email.primaryCta!.label}</a>`);
    expect(html).toContain(email.primaryCta!.url.replaceAll("&", "&amp;"));
    expect(html).toContain("Hi Ada &lt;Reader&gt;,");
    expect(html).toContain(`${origin}/dashboard/settings?tab=notifications`);
    expect(html).toContain(`${origin}/privacy`);
    expect(outbox).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it("uses a neutral secondary CTA without losing its label, target or outline", () => {
    const html = render(rendering.emailTemplates.reminderCheckIn({ firstName: null }));
    const color = rendering.emailColor;
    expect(html).toContain(`border:1px solid ${color("input")};background:${color("card")};color:${color("card-foreground")};`);
    expect(html).toContain("Pause for a month</a>");
    expect(html).toContain("?tab=notifications&amp;pause=reminders");
  });

  it("preserves invitation copy, escaped links and opt-out destinations while restyling only the wrapper", () => {
    const unsubscribe = `${origin}/invitation-preferences#token=${"a".repeat(64)}`;
    const content = '<p>Invitation fixture &amp; existing copy.</p>';
    const html = rendering.wrapEmail({ type: "friend_invitation", recipient: "invitee@example.test",
      subject: "An invitation", html: content, invitationUnsubscribeUrl: unsubscribe,
      primaryCta: { label: "View invitation", url: `${origin}/invitation?from=friend&token=fixture` } });
    expectEmailSafeStyles(html);
    expect(html).toContain("Hi there,");
    expect(html).toContain(content);
    expect(html).toContain(`href="${unsubscribe}"`);
    expect(html).toContain("Stop invitation emails</a>");
    expect(html).not.toContain("Manage email preferences");
    expect(html).toContain(`${origin}/invitation?from=friend&amp;token=fixture`);
    expect(outbox).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it("does not recolor embedded provider brands or semantic success/warning content", () => {
    const color = rendering.emailColor;
    const html = `<p style="color:${platformBrand.linkedin}">LinkedIn</p><p style="background:${color("success-subtle")};color:${color("success")}">Success</p><p style="background:${color("warning-subtle")};color:${color("warning")}">Warning</p>`;
    expect(render({ subject: "Semantic colors", eyebrow: "Status", html })).toContain(html);
  });

  it("renders the legacy welcome body through mocked lookup/capture only, retaining its content and links", async () => {
    const result = await rendering.sendWelcomeEmail("reader@example.test", "Ada <Reader>", "technology_saas");
    expect(result).toEqual({ success: true, messageId: "captured-not-sent" });
    expect(lookups).toEqual(["mock recipient lookup"]);
    expect(outbox).toHaveLength(1);
    const email = outbox[0];
    expect(email).toMatchObject({ type: "welcome", userId: "fixture-user", recipient: "reader@example.test", dedupeKey: "welcome:fixture-user", subject: "Welcome to TheSocialPundit - Your Voice, Amplified" });
    expectEmailSafeStyles(email.html);
    const color = rendering.emailColor;
    expect(email.html).toContain(`background: ${color("card")}; color: ${color("card-foreground")};`);
    expect(email.html).toContain(`background: ${color("primary")}; color: ${color("primary-foreground")};`);
    expect(email.html).toContain(`background: ${color("accent")};`);
    expect(email.html).toContain(`fill="${color("accent-foreground")}"`);
    expect(email.html).toContain("Welcome aboard, Ada &lt;Reader&gt;!");
    expect(email.html).toContain("Your Voice in Tech & SaaS");
    expect(email.html).toContain("Start Building Your Authority");
    expect(email.html).toContain(`href="${origin}/dashboard"`);
    expect(email.html).toContain(`href="${origin}/dashboard/settings?tab=notifications"`);
    expectEmailSafeStyles(rendering.wrapEmail(email));
  });
});