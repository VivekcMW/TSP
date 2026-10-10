import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// No HTTP server or real network: even document/script responses are fulfilled
// in a private headless browser, never the user's shared browser/session.
const origin = "https://invitations.test";
const acceptedMessage = "Invitation requested. If the address is eligible, we will send it.";
const template = { subject: "Fixture subject {InviterName} / {FirstName}", body: "Fixture body\n{FirstName} — {InviterName}\n{link}\n{FirstName}" };
let browser: Browser;
let context: BrowserContext;
let page: Page;
let bundle: string;
let requests: Array<{ url: string; method: string; body: Record<string, unknown>; cookie?: string }>;
let errors: string[];
let sendStatus: number;
let templateStatus: number;
let invitationsEnabled: boolean;
let meStatus: number;
let unsubscribeStatus: number;
let sendBody: unknown;
let dbUser: Record<string, unknown>;
let hold: Promise<void> | undefined;
let release: (() => void) | undefined;

beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../../../..");
  const result = await build({
    absWorkingDir: root, entryPoints: [path.join(import.meta.dirname, "invitations.fixture.tsx")], bundle: true, write: false,
    format: "esm", platform: "browser", jsx: "automatic", loader: { ".css": "empty", ".webp": "empty" },
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "false", "import.meta.env.BASE_URL": '"/"' },
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });

beforeEach(async () => {
  requests = []; errors = []; sendStatus = 202; templateStatus = 200; meStatus = 200; unsubscribeStatus = 200;
  invitationsEnabled = true;
  sendBody = { status: "accepted", message: acceptedMessage };
  dbUser = { id: "db-user", name: "Database Person", firstName: "Database", lastName: "Person" };
  hold = undefined; release = undefined;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.origin !== origin) { errors.push(`External request: ${url.origin}`); return route.abort(); }
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<html><head><style>[role="tabpanel"][data-state="inactive"]{display:none}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>' });
    if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
    requests.push({ url: url.pathname, method: request.method(), body: request.postDataJSON() ?? {}, cookie: request.headers().cookie });
    if (url.pathname === "/api/me") return reply(meStatus === 200 ? dbUser : { message: "private failure" }, meStatus);
    if (url.pathname === "/api/invitations/template") return reply(templateStatus === 200 ? { ...template, enabled: invitationsEnabled } : { message: "private failure" }, templateStatus);
    if (url.pathname === "/api/invitations" && request.method() === "POST") { await hold; return reply(sendBody, sendStatus); }
    if (url.pathname === "/api/public/invitations/unsubscribe" && request.method() === "POST") { await hold; return reply({ message: "never display recipient@example.invalid" }, unsubscribeStatus); }
    if (url.pathname === "/api/email-preferences") return reply({ dailyDigest: true });
    if (url.pathname === "/api/auth/get-session") return reply({ user: { id: "session-user", name: "Session Name", email: "session@example.invalid" }, session: { id: "session", expiresAt: "2099-01-01" } });
    errors.push(`Unmocked request: ${request.method()} ${url.pathname}`);
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
});
afterEach(async () => { release?.(); await context?.close(); expect(errors).toEqual([]); });

const sends = () => requests.filter((request) => request.url === "/api/invitations");
const optouts = () => requests.filter((request) => request.url === "/api/public/invitations/unsubscribe");
const send = () => page.getByTestId("button-send-invitation");
async function open() {
  await page.goto(`${origin}/dashboard/settings?tab=invitations`);
  await browserExpect(page.getByRole("tab", { name: "Invite friends", exact: true })).toHaveAttribute("aria-selected", "true");
}
async function fill(firstName = "Ada") {
  await page.getByLabel("Friend’s email").fill("friend@example.invalid");
  await page.getByLabel("First name (optional)").fill(firstName);
  await page.getByRole("checkbox", { name: /permission/ }).check();
}
async function dirty() {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

describe("Invite friends settings", () => {
  it("requires email and explicit permission, caps name at 80, and never submits on Enter", async () => {
    await open();
    expect(await dirty()).toBe(false);
    await browserExpect(send()).toBeDisabled();
    await page.getByLabel("Friend’s email").fill("invalid");
    await browserExpect(send()).toBeDisabled();
    await page.getByLabel("Friend’s email").fill("friend@example.invalid");
    await browserExpect(send()).toBeDisabled();
    expect(sends()).toHaveLength(0);
    await page.getByLabel("First name (optional)").fill("A".repeat(90));
    await browserExpect(page.getByLabel("First name (optional)")).toHaveValue("A".repeat(80));
    await page.getByRole("checkbox", { name: /permission/ }).check();
    await browserExpect(send()).toBeEnabled();
    await page.getByLabel("First name (optional)").press("Enter");
    expect(sends()).toHaveLength(0);
    await send().click();
    await browserExpect(page.getByRole("status")).toHaveText(acceptedMessage);
    expect(sends()).toHaveLength(1);
  });

  it("previews backend text with database identity and safe placeholders without consent or email", async () => {
    await open();
    expect(sends()).toHaveLength(0);
    await page.getByRole("button", { name: "Preview invitation" }).click();
    const preview = page.getByRole("region", { name: "Invitation preview" });
    await browserExpect(preview).toContainText("Fixture subject Database Person / there");
    await browserExpect(preview).toContainText("Your signup link");
    await browserExpect(preview).not.toContainText("Session Name");
    await page.getByLabel("First name (optional)").fill("<img src=x> $& {InviterName}");
    await browserExpect(preview).toContainText("<img src=x> $& {InviterName}");
    await browserExpect(preview.locator("img, a")).toHaveCount(0);
    expect(sends()).toHaveLength(0);
  });

  it.each(["template", "identity"])("shows a recoverable %s preview failure without copying backend errors", async (failure) => {
    if (failure === "template") templateStatus = 503; else meStatus = 503;
    await open();
    await fill();
    await page.getByRole("button", { name: "Preview invitation" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("preview is unavailable");
    templateStatus = 200; meStatus = 200;
    await page.getByRole("button", { name: "Retry preview" }).click();
    await browserExpect(page.getByRole("region", { name: "Invitation preview" })).toContainText("Database Person / Ada");
    await browserExpect(page.getByLabel("Friend’s email")).toHaveValue("friend@example.invalid");
    expect(sends()).toHaveLength(0);
  });

  it("shows the disabled environment state while allowing preview", async () => {
    invitationsEnabled = false;
    await open();
    await browserExpect(page.getByRole("status")).toContainText("not enabled");
    await browserExpect(send()).toBeDisabled();
    await browserExpect(send()).toHaveText("Sending unavailable");
    await fill();
    await browserExpect(send()).toBeDisabled();
    await page.getByRole("button", { name: "Preview invitation" }).click();
    await browserExpect(page.getByRole("region", { name: "Invitation preview" })).toContainText("Fixture subject");
    expect(sends()).toHaveLength(0);
  });

  it("retains visited forms and guard semantics, clearing only the accepted invitation draft", async () => {
    await open();
    await fill();
    await page.getByRole("tab", { name: "notifications", exact: true }).click();
    expect(await dirty()).toBe(true);
    const dialog = page.waitForEvent("dialog");
    const leave = page.getByRole("link", { name: "Leave Settings" }).click();
    await (await dialog).dismiss();
    await leave;
    await browserExpect(page).toHaveURL(/tab=notifications$/);
    await page.getByRole("tab", { name: "Invite friends", exact: true }).click();
    await browserExpect(page.getByLabel("First name (optional)")).toHaveValue("Ada");
    await send().click();
    await browserExpect(page.getByRole("status")).toHaveText(acceptedMessage);
    await browserExpect(page.getByLabel("Friend’s email")).toHaveValue("");
    await browserExpect(page.getByLabel("First name (optional)")).toHaveValue("");
    await browserExpect(page.getByRole("checkbox", { name: /permission/ })).not.toBeChecked();
    expect(await dirty()).toBe(false);
  });

  it.each([400, 429, 503])("retains details on %s, retries the same UUID and shows only generic acceptance", async (status) => {
    sendStatus = status; sendBody = { message: "private recipient eligibility detail" };
    await open(); await fill(); await send().click();
    await browserExpect(page.getByRole("alert")).toContainText(status === 400 ? "Check the email" : status === 429 ? "daily invitation limit" : "temporarily unavailable");
    await browserExpect(page.getByLabel("First name (optional)")).toHaveValue("Ada");
    expect(sends()).toHaveLength(1);
    expect(sends()[0].body).toEqual({ email: "friend@example.invalid", firstName: "Ada", consent: true, requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) });
    sendStatus = 202; sendBody = { status: "accepted", message: "delivered to private recipient" };
    await send().click();
    await browserExpect(page.getByRole("status")).toHaveText(acceptedMessage);
    expect(sends()).toHaveLength(2);
    expect(sends()[1].body).toEqual(sends()[0].body);
    await browserExpect(page.locator("body")).not.toContainText("delivered");
    await browserExpect(page.getByRole("alert")).toHaveCount(0);
  });

  it("keeps IDs per submitted pair through edits, including returning to an earlier retry", async () => {
    sendStatus = 503;
    await open(); await fill(); await send().click();
    await browserExpect(page.getByRole("alert")).toBeVisible();
    await page.getByLabel("First name (optional)").fill("Grace"); await send().click();
    await browserExpect.poll(() => sends().length).toBe(2);
    await browserExpect(send()).toBeEnabled();
    await page.getByLabel("First name (optional)").fill("Ada"); await send().click();
    await browserExpect.poll(() => sends().length).toBe(3);
    expect(sends()[0].body.requestId).not.toBe(sends()[1].body.requestId);
    expect(sends()[2].body).toEqual(sends()[0].body);
  });

  it("works standalone, omits blank name, and disables every action while pending", async () => {
    hold = new Promise<void>((resolve) => { release = resolve; });
    await page.goto(`${origin}/standalone`); await fill(""); await send().click();
    await browserExpect(page.getByRole("button", { name: "Requesting…" })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Preview invitation" })).toBeDisabled();
    await browserExpect(page.getByLabel("Friend’s email")).toBeDisabled();
    await browserExpect(page.getByRole("checkbox")).toBeDisabled();
    expect(sends()).toHaveLength(1);
    expect(sends()[0].body).not.toHaveProperty("firstName");
    release!();
    await browserExpect(page.getByRole("status")).toHaveText(acceptedMessage);
  });
});

describe("Public invitation preferences", () => {
  it("captures then strips the hash, does nothing until click, omits cookies and handles repeated opt-outs", async () => {
    await context.addCookies([{ name: "session", value: "fixture", url: origin }]);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto(`${origin}/invitation-preferences#token=fixture%2Btoken`);
      await browserExpect(page.getByRole("heading", { level: 1, name: "Invitation preferences" })).toBeVisible();
      await browserExpect(page).toHaveURL(`${origin}/invitation-preferences`);
      expect(optouts()).toHaveLength(attempt);
      await browserExpect(page.locator("body")).not.toContainText("fixture+token");
      await page.getByRole("button", { name: "Stop friend invitations" }).click();
      await browserExpect(page.getByRole("status")).toContainText("Your preference has been saved");
      expect(optouts()[attempt].body).toEqual({ token: "fixture+token" });
      expect(optouts()[attempt].cookie).toBeUndefined();
      await browserExpect(page.locator("body")).not.toContainText("recipient@example.invalid");
    }
    expect(requests.every((request) => request.url === "/api/public/invitations/unsubscribe")).toBe(true);
    await page.reload();
    await browserExpect(page.getByRole("alert")).toContainText("invalid or expired");
    expect(optouts()).toHaveLength(2);
  });

  it.each(["", "#token=", "?token=query-only"])("shows generic invalid state for missing hash token (%s)", async (suffix) => {
    await page.goto(`${origin}/invitation-preferences${suffix}`);
    await browserExpect(page.getByRole("alert")).toContainText("invalid or expired");
    await browserExpect(page.getByRole("button")).toHaveCount(0);
    expect(requests).toHaveLength(0);
  });

  it.each([400, 410])("shows generic invalid/expired state on %s without recipient details", async (status) => {
    unsubscribeStatus = status;
    await page.goto(`${origin}/invitation-preferences#token=invalid-fixture`);
    await page.getByRole("button", { name: "Stop friend invitations" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("invalid or expired");
    await browserExpect(page.locator("body")).not.toContainText("recipient@example.invalid");
    await browserExpect(page.getByRole("button")).toHaveCount(0);
  });

  it("retains token for explicit retry after 503 and disables pending clicks", async () => {
    unsubscribeStatus = 503;
    await page.goto(`${origin}/invitation-preferences#token=retry-fixture`);
    await page.getByRole("button", { name: "Stop friend invitations" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("could not save");
    expect(optouts()).toHaveLength(1);
    unsubscribeStatus = 200;
    hold = new Promise<void>((resolve) => { release = resolve; });
    await page.getByRole("button", { name: "Stop friend invitations" }).click();
    await browserExpect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(optouts()).toHaveLength(2);
    expect(optouts()[1].body).toEqual(optouts()[0].body);
    release!();
    await browserExpect(page.getByRole("status")).toContainText("Your preference has been saved");
  });
});