import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { emptyEditorialVoice, voiceMutationSchema, type EditorialVoice } from "@shared/editorial-voice";

let browser: Browser, context: BrowserContext, page: Page, server: Server, origin: string;
let voice: EditorialVoice, calls: Array<{ method: string; body: unknown }>, errors: string[], fail: boolean;
beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../../../..");
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, sourcefile: "voice-claims-fixture.tsx", loader: "tsx", contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {EditorialVoiceSettings} from '@/components/settings/editorial-voice-settings';
    import {SettingsNavigationGuard} from '@/components/settings/settings-navigation-guard';
    import {ApproveVoiceEdit} from '@/components/dashboard/approve-voice-edit';
    import {ClaimSupportReview} from '@/components/dashboard/claim-support-review';
    import {checkClaimSupport} from '@shared/editorial-claims';
    const original = 'Acme revenue is 12 million.';
    const report = checkClaimSupport(original, [{text:original,excerptIds:['p1']}], [{id:'p1',text:original,start:0,end:original.length}]);
    function App() {const [text,setText]=useState(original); const [scope,setScope]=useState('a');
      window.setDraftText=setText; window.changeAccount=setScope;
      return <SettingsNavigationGuard key={scope}><main><EditorialVoiceSettings/><ApproveVoiceEdit content={text}/>
        <ClaimSupportReview report={report} text={original} currentContent={text} edited={text!==original}/></main></SettingsNavigationGuard>;
    } createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "false" },
  });
  server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
    else { res.setHeader("Content-Type", "text/html"); res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });
beforeEach(async () => {
  voice = emptyEditorialVoice(); calls = []; errors = []; fail = false;
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { errors.push("Blocked external request"); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname !== "/api/editorial/voice") { errors.push("Unexpected API"); await route.abort(); return; }
    const method = route.request().method(), body = route.request().postDataJSON();
    calls.push({ method, body });
    const reply = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (fail) return reply({ message: "Fixture failure" }, 503);
    if (method === "GET") return reply(voice);
    const change = voiceMutationSchema.parse(body);
    if (change.revision !== voice.revision) return reply({ message: "Stale" }, 409);
    if (change.action === "enable") voice.enabled = change.enabled;
    else if (change.action === "add") voice.samples.push({ id: randomUUID(), text: change.text, origin: change.origin, approvedAt: new Date().toISOString(), deletedAt: null });
    else {
      const sample = voice.samples.find(sample => sample.id === change.id)!;
      if (change.action === "edit") sample.text = change.text;
      if (change.action === "delete") sample.deletedAt = new Date().toISOString();
      if (change.action === "restore") sample.deletedAt = null;
      if (change.action === "forget") voice.samples = voice.samples.filter(sample => sample.id !== change.id);
    }
    voice.revision++;
    return reply(voice);
  });
  page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
});
afterEach(async () => { await context.close(); expect(errors).toEqual([]); });

describe("optional voice and honest human review UI", () => {
  it("does not fetch or retain history just by mounting or editing text", async () => {
    await browserExpect(page.getByRole("button", { name: "Manage optional voice" })).toBeVisible();
    await page.evaluate(() => (window as any).setDraftText("A locally edited text that is not approved."));
    expect(calls).toEqual([]);
    await page.getByRole("button", { name: "Approve an edit as a voice sample…" }).click();
    await browserExpect(page.getByRole("button", { name: "Retain approved edit" })).toBeDisabled();
    await page.getByRole("button", { name: "Cancel approval" }).click();
    expect(calls).toEqual([]);
  });
  it("adds, enables, reapproves an edit, removes, restores and permanently forgets", async () => {
    await page.getByRole("button", { name: "Manage optional voice" }).click();
    const text = "I prefer direct sentences and measured conclusions.";
    await page.getByLabel("Voice sample text").fill(text);
    await browserExpect(page.getByRole("button", { name: "Approve and add sample" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /I approve retaining/ }).check();
    await page.getByRole("button", { name: "Approve and add sample" }).click();
    await browserExpect(page.getByRole("button", { name: "Edit sample", exact: true })).toBeVisible();
    expect(voice.enabled).toBe(false);
    await page.getByRole("button", { name: "Enable approved samples as tone guidance" }).click();
    await browserExpect(page.getByRole("button", { name: "Disable voice guidance" })).toBeVisible();
    await page.getByRole("button", { name: "Edit sample", exact: true }).click();
    await page.getByLabel("Voice sample text").fill(text + " Revised.");
    await browserExpect(page.getByRole("button", { name: "Approve sample changes" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /I approve retaining/ }).check();
    await page.getByRole("button", { name: "Approve sample changes" }).click();
    await browserExpect(page.getByText(text + " Revised.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove sample", exact: true }).click();
    await browserExpect(page.getByText(/Removed — not used/)).toBeVisible();
    await page.getByRole("button", { name: "Approve and restore sample" }).click();
    await browserExpect(page.getByRole("button", { name: "Remove sample", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove sample", exact: true }).click();
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Permanently forget sample" }).click();
    await browserExpect(page.getByRole("button", { name: "Approve and restore sample" })).toHaveCount(0);
    expect(voice.samples).toEqual([]);
  });
  it("retains an approved edit only after a separate explicit consent and submit", async () => {
    await page.getByRole("button", { name: "Approve an edit as a voice sample…" }).click();
    const text = "A revised conclusion that I explicitly approve.";
    await page.getByLabel("Approved edit sample").fill(text);
    await page.getByRole("checkbox", { name: /I explicitly approve/ }).check();
    expect(calls).toEqual([]);
    await page.getByRole("button", { name: "Retain approved edit" }).click();
    await browserExpect(page.getByText(/Approved edit retained/)).toBeVisible();
    expect(voice.samples[0]).toMatchObject({ text, origin: "approved-edit" });
    expect(voice.enabled).toBe(false);
    expect(calls.filter(call => call.method === "PATCH")).toHaveLength(1);
  });
  it("preserves input and shows honest failure instead of claiming approval", async () => {
    await page.getByRole("button", { name: "Manage optional voice" }).click();
    const text = "This exact text must survive an API failure.";
    await page.getByLabel("Voice sample text").fill(text);
    await page.getByRole("checkbox", { name: /I approve retaining/ }).check();
    fail = true;
    await page.getByRole("button", { name: "Approve and add sample" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Change could not be confirmed");
    await browserExpect(page.getByLabel("Voice sample text")).toHaveValue(text);
    expect(voice.samples).toHaveLength(0);
  });
  it("shows textual support, never fact verified, and resets human acknowledgement on every edit", async () => {
    await page.getByText("Claim checks (1)", { exact: true }).click();
    await browserExpect(page.getByText("supported", { exact: true })).toBeVisible();
    await browserExpect(page.getByText(/source offsets 0–/)).toBeVisible();
    const checkbox = page.getByRole("checkbox", { name: /I have reviewed/ });
    await checkbox.check();
    await browserExpect(page.getByText(/Human review acknowledged/)).toBeVisible();
    await page.evaluate(() => (window as any).setDraftText("An edited but not independently verified claim."));
    await browserExpect(checkbox).not.toBeChecked();
    await browserExpect(page.getByText(/original claim report is stale/)).toBeVisible();
    await browserExpect(page.getByText("supported", { exact: true })).toHaveCount(0);
    await checkbox.check();
    await page.evaluate(() => (window as any).setDraftText("A second edit needs its own fresh human review."));
    await browserExpect(checkbox).not.toBeChecked();
    expect(calls).toEqual([]);
  });
  it("does not leave previous account samples or approvals after an account remount", async () => {
    await page.getByRole("button", { name: "Manage optional voice" }).click();
    await page.getByLabel("Voice sample text").fill("Private unsaved writing on account A.");
    await page.getByRole("checkbox", { name: /I have reviewed/ }).check();
    await page.evaluate(() => (window as any).changeAccount("account-b"));
    await browserExpect(page.getByLabel("Voice sample text")).toHaveCount(0);
    await browserExpect(page.getByRole("checkbox", { name: /I have reviewed/ })).not.toBeChecked();
    expect(calls.filter(call => call.method === "PATCH")).toEqual([]);
  });
  it("requires fresh consent after changing sample text or type", async () => {
    await page.getByRole("button", { name: "Manage optional voice" }).click();
    await page.getByLabel("Voice sample text").fill("My first explicitly selected writing sample.");
    const consent = page.getByRole("checkbox", { name: /I approve retaining/ });
    await consent.check();
    await page.getByLabel("Voice sample text").fill("Different writing requires a different approval.");
    await browserExpect(consent).not.toBeChecked();
    await consent.check();
    await page.getByLabel("Sample type").selectOption("approved-edit");
    await browserExpect(consent).not.toBeChecked();
    await browserExpect(page.getByRole("button", { name: "Approve and add sample" })).toBeDisabled();
    expect(calls.filter(call => call.method === "PATCH")).toEqual([]);
  });
  it("retains an unsaved sample when toggling voice and guards navigation", async () => {
    await page.getByRole("button", { name: "Manage optional voice" }).click();
    const text = "Keep my unapproved sample until I decide to save it.";
    await page.getByLabel("Voice sample text").fill(text);
    await page.getByRole("button", { name: "Enable approved samples as tone guidance" }).click();
    await browserExpect(page.getByRole("button", { name: "Disable voice guidance" })).toBeVisible();
    await browserExpect(page.getByLabel("Voice sample text")).toHaveValue(text);
    let prompted = false;
    page.once("dialog", async dialog => { prompted = true; await dialog.dismiss(); });
    await page.evaluate(() => history.pushState({}, "", "/elsewhere"));
    expect(prompted).toBe(true);
    expect(new URL(page.url()).pathname).toBe("/");
    await browserExpect(page.getByLabel("Voice sample text")).toHaveValue(text);
    expect(voice.samples).toEqual([]);
  });
  it("does not silently retry a stale revision; reload preserves the sample", async () => {
    await page.getByRole("button", { name: "Manage optional voice" }).click();
    const text = "Another tab changed my settings while I was editing.";
    await page.getByLabel("Voice sample text").fill(text);
    await page.getByRole("checkbox", { name: /I approve retaining/ }).check();
    voice.revision++;
    await page.getByRole("button", { name: "Approve and add sample" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("Reload voice settings");
    expect(calls.filter(call => call.method === "PATCH")).toHaveLength(1);
    expect(voice.samples).toEqual([]);
    await page.getByRole("button", { name: "Reload voice settings" }).click();
    await browserExpect(page.getByRole("button", { name: "Reload voice settings" })).toBeEnabled();
    await browserExpect(page.getByLabel("Voice sample text")).toHaveValue(text);
    await page.getByRole("button", { name: "Approve and add sample" }).click();
    await browserExpect(page.getByRole("button", { name: "Edit sample", exact: true })).toBeVisible();
    expect(voice.samples[0].text).toBe(text);
  });
});