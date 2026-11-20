import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, expect as check, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminMonitoring, TenantOverview } from "@shared/admin";
import config from "../../../../tailwind.config";

let browser: Browser; let script: string; let css: string;
const id = "90cc5331-e6e7-4e29-bddb-8c906ed4310e";
const date = "2026-10-23T09:00:00Z";
const tenant = { id, name: "Acme Media", kind: "corporate", status: "active", createdAt: date };
const counts = { waiting: 2, active: 1, completed: 3, failed: 0, delayed: 0, paused: 0 };
const monitoring: AdminMonitoring = {
  generatedAt: date, environment: "development", tenantCount: 260,
  queue: { configured: true, reachable: true, queuesReady: true },
  scheduler: { enabled: true, designated: true, production: false }, jobs: { inbox: counts, publishing: counts },
  scheduled: 3, publishing: 1, failed: 1, overdue: 2,
  recentFailures: [{ id: "attempt", tenantId: id, tenantName: tenant.name, startedAt: date, platform: "linkedin" }], engineFailures: [],
  tenantSignals: [{ tenantId: id, tenantName: tenant.name, failed: 1, overdue: 2 }],
};
const detail: TenantOverview = {
  tenant, generatedAt: date, counts: { members: 1, inboxItems: 12, drafts: 4, failedSchedules: 1, overdueSchedules: 2 },
  members: [{ userId: "u", name: "Reader", email: "reader@example.invalid", role: "owner", onboardingStatus: "completed" }],
  membersTruncated: false, latestSubscription: null,
  memberPage: 1, sources: [], sourcesTruncated: false, connections: [], connectionsTruncated: false, recentPayments: [],
  recentRuns: [{ id: "run", status: "failed", startedAt: date, articlesMatched: 0, articlesProcessed: 3 }],
  recentSchedules: [{ id: "schedule", status: "failed", scheduledPublishAt: date }],
};
beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const bundle = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { QueryClientProvider } from "@tanstack/react-query";
      import { Switch, Route } from "wouter";
      import { queryClient } from "@/lib/queryClient";
      import Overview from "@/pages/admin/overview";
      import Tenants from "@/pages/admin/tenants";
      import Detail from "@/pages/admin/tenant-detail";
      import Monitoring from "@/pages/admin/monitoring";
      import Users from "@/pages/admin/users";
      import UserDetail from "@/pages/admin/user-detail";
      import Audit from "@/pages/admin/audit-log";
      import Operations from "@/pages/admin/operations";
      import Deliveries from "@/pages/admin/email-deliveries";
      import Flags from "@/pages/admin/feature-flags";
      import Search from "@/pages/admin/search";
      createRoot(document.getElementById("root")).render(<QueryClientProvider client={queryClient}><Switch>
        <Route path="/admin/tenants/:id" component={Detail} />
        <Route path="/admin/tenants" component={Tenants} />
        <Route path="/admin/monitoring" component={Monitoring} />
        <Route path="/admin/users/:id" component={UserDetail} />
        <Route path="/admin/users" component={Users} />
        <Route path="/admin/audit-log" component={Audit} />
        <Route path="/admin/operations" component={Operations} />
        <Route path="/admin/email-deliveries" component={Deliveries} />
        <Route path="/admin/feature-flags" component={Flags} />
        <Route path="/admin/search" component={Search} />
        <Route path="/admin" component={Overview} />
      </Switch></QueryClientProvider>);
    `, loader: "tsx", resolveDir: root },
    absWorkingDir: root, alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "offline-auth", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/dev-auth$/ }, args => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: "export const useIsSignedIn = () => true; export const devAuthEnabled = false;" }));
    } }],
  });
  script = bundle.outputFiles[0].text;
  const source = readFileSync(path.join(root, "client/src/index.css"), "utf8")
    .replace('@import "./design/tokens.generated.css";', readFileSync(path.join(root, "client/src/design/tokens.generated.css"), "utf8"));
  css = (await postcss([tailwindcss(config)]).process(source, { from: path.join(root, "client/src/index.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 90_000);
afterAll(async () => { await browser?.close(); });
async function open(pathname = "/admin", options: { width?: number; directoryFails?: boolean; monitoringFails?: boolean; detailFails?: boolean; queueMissing?: boolean; manyMembers?: boolean; recordsFail?: boolean } = {}) {
  const calls: { path: string; method: string; reason?: string; tenantId?: string; body?: Record<string, unknown> }[] = [];
  let flag = { id, key: "team_workspaces", description: "Team rollout", enabled: false, owner: "hello@thesocialpundit.com", expiresAt: date,
    tenantIds: [] as string[], revision: 1, createdAt: date };
  const errors: string[] = [];
  const page = await browser.newPage({ viewport: { width: options.width ?? 390, height: 844 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "https://admin.test") { errors.push(`Blocked external request: ${url.origin}`); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<div id="root" style="height:100vh"></div>' });
    const body = ["POST", "PATCH"].includes(request.method()) ? request.postDataJSON() : undefined;
    calls.push({ path: `${url.pathname}${url.search}`, method: request.method(), reason: request.headers()["x-access-reason"], tenantId: request.headers()["x-tenant-id"], body });
    if (url.pathname.endsWith("/recover")) return route.fulfill({ json: { outcome: "waiting" } });
    if (url.pathname === `/api/admin/feature-flags/${id}` && request.method() === "PATCH") {
      flag = { ...flag, enabled: body.enabled, revision: flag.revision + 1 }; return route.fulfill({ json: flag });
    }
    if (url.pathname === `/api/admin/feature-flags/${id}/policy` && request.method() === "PATCH") {
      flag = { ...flag, ...body, revision: flag.revision + 1 }; return route.fulfill({ json: flag });
    }
    if (request.method() !== "GET") return route.fulfill({ status: 405, json: { message: "Read-only fixture" } });
    if (url.pathname === "/api/me") return route.fulfill({ json: { id: "actor" } });
    if (url.pathname === "/api/admin/feature-flags") return route.fulfill({ json: [flag] });
    if (url.pathname === "/api/admin/feature-flag-history") return route.fulfill({ json: [{ id: "history", operation: "policy", actorId: "actor", reason: "Review rollout", createdAt: date }] });
    if (url.pathname === "/api/admin/operations/health") return route.fulfill({ json: { generatedAt: date,
      expected: false, queue: { configured: true, reachable: true, queuesReady: true }, workers: { available: true, inbox: 1, publishing: 1 },
      ages: { inbox: { available: true, complete: true, oldestMs: 60000, scanned: 1 }, publishing: { available: true, complete: true, oldestMs: null, scanned: 0 } } } });
    if (url.pathname === "/api/admin/operations/incidents") return route.fulfill({ json: { items: [], hasMore: false } });
    if (url.pathname === "/api/admin/operations/rollups") return route.fulfill({ json: { items: [{ tenantId: id, name: "Acme snapshot", inboxItems: null, drafts: null, engineRuns: null, failedSchedules: null, observedAt: null }], total: 1, hasMore: false } });
    if (url.pathname === "/api/admin/operations/jobs") {
      const publishing = url.searchParams.get("queue") === "publishing";
      return route.fulfill({ json: { items: [{ id: publishing ? "retained-publishing" : "retained-discovery", queue: publishing ? "publishing" : "inbox", state: "failed", tenantId: id, userId: "u",
        attemptsMade: 3, createdAt: date, finishedAt: date, recoveryEligible: !publishing, operationId: publishing ? null : "original-intent" }], page: 1, hasMore: false } });
    }
    if (url.pathname === "/api/admin/email-directory") {
      if (options.recordsFail) return route.fulfill({ status: 503, json: { message: "Unavailable" } });
      return route.fulfill({ json: { items: [{ id: "delivery", recipient: "reader@example.invalid", userId: "u", type: "daily_digest", status: "unknown", attempts: 1, createdAt: date, sentAt: null, retryAt: null }],
        total: 26, page: Number(url.searchParams.get("page") || "1"), pageSize: 25 } });
    }
    if (url.pathname === "/api/admin/monitoring") return route.fulfill(options.monitoringFails ? { status: 503, json: { message: "Unavailable" } } : {
      json: options.queueMissing ? { ...monitoring, queue: { configured: false, reachable: false, queuesReady: false }, jobs: { inbox: null, publishing: null } } : monitoring,
    });
    if (url.pathname === "/api/admin/users/u/overview") return route.fulfill({ json: {
      user: { id: "u", name: "Reader", email: "reader@example.invalid", emailVerified: true, platformRole: null, registrationCompleted: date, createdAt: date },
      memberships: [{ tenantId: id, name: tenant.name, status: "active", role: "owner" }], membershipsTruncated: false, emailHistory: [], preferences: null,
    } });
    if (url.pathname.endsWith("/overview")) return route.fulfill(options.detailFails ? { status: 403, json: { message: "Access revoked" } } : { json: options.manyMembers ? {
      ...detail, counts: { ...detail.counts, members: 51 }, memberPage: Number(url.searchParams.get("memberPage") || "1"),
      membersTruncated: !url.searchParams.has("memberPage"), members: url.searchParams.has("memberPage")
        ? [{ userId: "last-member", name: "Last member", email: "last@example.invalid", role: "member", onboardingStatus: null }] : detail.members,
    } : detail });
    if (options.recordsFail && ["/api/admin/users-directory", "/api/admin/audit-directory"].includes(url.pathname)) return route.fulfill({ status: 503, json: { message: "Unavailable" } });
    if (url.pathname === "/api/admin/users-directory") return route.fulfill({ json: { items: [
      { id: "u", name: "Reader", email: "reader@example.invalid", emailVerified: true, platformRole: null, registrationCompleted: date, createdAt: date },
    ], total: 26, page: Number(url.searchParams.get("page") || "1"), pageSize: 25 } });
    if (url.pathname === "/api/admin/audit-directory") return route.fulfill({ json: { items: [
      { id: "event", actorUserId: "u", tenantId: id, action: "tenant:read:all", resourceType: "GET", resourceId: "/api/admin/tenant-directory", justification: "Review platform directory", correlationId: "correlation", createdAt: date },
    ], total: 1, page: 1, pageSize: 25 } });
    if (url.pathname === "/api/admin/tenant-directory") {
      if (options.directoryFails) return route.fulfill({ status: 503, json: { message: "Unavailable" } });
      const q = url.searchParams.get("q") ?? "";
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      const total = q === "missing" ? 0 : q ? 1 : 260;
      const items = q ? total ? [{ ...tenant, memberCount: 1 }] : [] : Array.from({ length: 25 }, (_, index) => ({ ...tenant, id: index === 0 ? id : `workspace-${(pageNumber - 1) * 25 + index}`, name: index === 0 && pageNumber === 1 ? tenant.name : `Workspace ${(pageNumber - 1) * 25 + index + 1}`, memberCount: 1 }));
      return route.fulfill({ json: { items, total, page: pageNumber, pageSize: 25 } });
    }
    errors.push(`Unexpected API request ${url.pathname}`); return route.fulfill({ status: 500, json: { message: "Unmocked" } });
  });
  await page.goto(`https://admin.test${pathname}`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  return { page, calls, errors, options };
}
describe("admin command center and tenant investigation", () => {
  it.each([390, 1280])("links operational signals to an audited read-only investigation at %ipx", async width => {
    const { page, calls, errors } = await open("/admin", { width });
    try {
      await check(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
      await check(page.getByText("Automatic scheduling disabled", { exact: true })).toBeVisible();
      await check(page.getByRole("heading", { name: "Affected workspaces" })).toBeVisible();
      await page.getByRole("link", { name: "Investigate workspace" }).first().click();
      await check(page.getByRole("heading", { name: "Tenant 360" })).toBeVisible();
      expect(calls.filter(call => call.path.endsWith("/overview"))).toHaveLength(0);
      await page.getByRole("textbox", { name: "Reason for accessing this workspace" }).fill("Investigate customer publishing ticket");
      await page.getByRole("button", { name: "Open investigation" }).click();
      await check(page.getByRole("heading", { name: tenant.name, exact: true })).toBeVisible();
      expect(calls.find(call => call.path.endsWith("/overview"))).toMatchObject({ tenantId: id, reason: "Investigate customer publishing ticket", method: "GET" });
      await check(page.getByText("reader@example.invalid", { exact: true })).toBeVisible();
      await check(page.getByText("No subscription record.", { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(calls.every(call => call.method === "GET")).toBe(true); expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it("searches server-side, preserves filters through detail navigation and supports pagination/history", async () => {
    const { page, calls, errors } = await open("/admin/tenants");
    try {
      await check(page.getByText("260 matching workspaces", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await check(page.getByText("Page 2 of 11", { exact: true })).toBeVisible();
      expect(calls.some(call => call.path.includes("page=2"))).toBe(true);
      await page.goBack();
      await check(page.getByText("Page 1 of 11", { exact: true })).toBeVisible();
      await page.getByLabel("Workspace name or exact ID").fill("Acme");
      await page.getByLabel("Workspace type").selectOption("corporate");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await check(page.getByText("1 matching workspaces", { exact: true })).toBeVisible();
      expect(new URL(page.url()).searchParams.get("kind")).toBe("corporate");
      await page.getByRole("link", { name: tenant.name, exact: true }).click();
      await page.getByRole("link", { name: "Back to tenants" }).click();
      await check(page.getByLabel("Workspace name or exact ID")).toHaveValue("Acme");
      await check(page.getByLabel("Workspace type")).toHaveValue("corporate");
      await page.getByLabel("Workspace name or exact ID").fill("missing");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await check(page.getByText("No workspaces on this page.", { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it("shows query errors rather than fake empty tenants and permits an explicit retry", async () => {
    const fixture = await open("/admin/tenants", { directoryFails: true });
    try {
      await check(fixture.page.getByText("Tenant directory could not be loaded.", { exact: false })).toBeVisible();
      expect(await fixture.page.getByText("0 matching workspaces", { exact: true }).count()).toBe(0);
      fixture.options.directoryFails = false;
      await fixture.page.getByRole("button", { name: /Retry/ }).click();
      await check(fixture.page.getByText("260 matching workspaces", { exact: true })).toBeVisible();
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.page.close(); }
  });
  it("rejects invalid URL filters visibly without fetching unfiltered data", async () => {
    const { page, calls } = await open("/admin/tenants?page=0");
    try {
      await check(page.getByRole("alert")).toContainText("filters are invalid");
      expect(calls).toHaveLength(0);
    } finally { await page.close(); }
  });
  it("represents missing queue data as unavailable and health read failures as unknown", async () => {
    const missing = await open("/admin", { queueMissing: true });
    try {
      await check(missing.page.getByText("Backlog is unavailable.", { exact: false })).toBeVisible();
      await check(missing.page.getByText("Queue readiness is unavailable", { exact: true })).toBeVisible();
    } finally { await missing.page.close(); }
    const failed = await open("/admin", { monitoringFails: true });
    try {
      await check(failed.page.getByText("Platform health is unknown, not healthy.", { exact: false })).toBeVisible();
      expect(await failed.page.getByText("Connected and ready", { exact: true }).count()).toBe(0);
    } finally { await failed.page.close(); }
  });
  it("does not render customer data after a denied investigation", async () => {
    const { page, calls, errors } = await open(`/admin/tenants/${id}`, { detailFails: true });
    try {
      await page.getByRole("textbox", { name: "Reason for accessing this workspace" }).fill("Investigate a support report");
      await page.getByRole("button", { name: "Open investigation" }).click();
      await check(page.getByText("Tenant investigation could not be loaded.", { exact: false })).toBeVisible();
      expect(await page.getByText("reader@example.invalid", { exact: true }).count()).toBe(0);
      expect(calls).toHaveLength(1); expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it("searches user records, opens a reason-gated account and links filtered actor history", async () => {
    const { page, calls, errors } = await open("/admin/users");
    try {
      await check(page.getByText("26 matching records", { exact: true })).toBeVisible();
      await page.getByLabel("Name, email or exact user ID").fill("reader@example.invalid");
      await page.getByRole("button", { name: "Search records", exact: true }).click();
      await check(page.getByLabel("Name, email or exact user ID")).toHaveValue("reader@example.invalid");
      await page.getByRole("link", { name: "Reader", exact: true }).click();
      expect(calls.filter(call => call.path === "/api/admin/users/u/overview")).toHaveLength(0);
      await page.getByLabel("Investigation reason", { exact: true }).fill("Review account support ticket");
      await page.getByRole("button", { name: "Open account investigation", exact: true }).click();
      await check(page.getByRole("heading", { name: "Account email activity", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Review actor audit history" }).click();
      await check(page.getByLabel("Actor user ID", { exact: true })).toHaveValue("u");
      await check(page.getByText("tenant:read:all", { exact: true })).toBeVisible();
      expect(calls.some(call => call.path.startsWith("/api/admin/audit-directory") && call.path.includes("actor=u"))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it("reads the next member page under the same audited investigation reason", async () => {
    const { page, calls, errors } = await open(`/admin/tenants/${id}`, { manyMembers: true });
    try {
      await page.getByRole("textbox", { name: "Reason for accessing this workspace" }).fill("Review complete membership");
      await page.getByRole("button", { name: "Open investigation" }).click();
      await check(page.getByText("reader@example.invalid", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Next members", exact: true }).click();
      await check(page.getByText("last@example.invalid", { exact: true })).toBeVisible();
      expect(calls.find(call => call.path.includes("memberPage=2"))).toMatchObject({ reason: "Review complete membership", tenantId: id });
      expect(await page.getByRole("button", { name: "Next members", exact: true }).isDisabled()).toBe(true);
      await page.getByRole("button", { name: "Previous members", exact: true }).click();
      await check(page.getByText("reader@example.invalid", { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it.each(["users", "audit-log"])("does not show a fake empty %s directory during an outage", async kind => {
    const { page, errors } = await open(`/admin/${kind}`, { recordsFail: true });
    try {
      await check(page.getByText("Records could not be loaded. No empty result has been assumed.", { exact: false })).toBeVisible();
      expect(await page.getByText("0 matching records", { exact: true }).count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it("searches global delivery history with exact status/account filters and paginated URLs", async () => {
    const { page, calls, errors } = await open("/admin/email-deliveries");
    try {
      await check(page.getByText("26 matching deliveries", { exact: true })).toBeVisible();
      await page.getByLabel("Delivery status", { exact: true }).selectOption("unknown");
      await page.getByLabel("Account ID", { exact: true }).fill("u");
      await page.getByRole("button", { name: "Search deliveries", exact: true }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await check(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
      expect(calls.some(call => call.path.includes("status=unknown") && call.path.includes("user=u") && call.path.includes("page=2"))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it("requires explicit original-identity recovery confirmation and keeps publication controls read-only", async () => {
    const { page, calls, errors } = await open("/admin/operations");
    try {
      await check(page.getByRole("heading", { name: "Retained jobs", exact: true })).toBeVisible();
      await page.getByLabel("Reason for control changes").fill("Recover failed customer discovery");
      await page.getByRole("button", { name: "Review discovery recovery" }).click();
      expect(calls.every(call => call.method === "GET")).toBe(true);
      await page.getByRole("button", { name: "Confirm discovery recovery", exact: true }).click();
      await check(page.getByText("Observed recovery state: waiting.", { exact: false })).toBeVisible();
      expect(calls.find(call => call.path.endsWith("/recover"))).toMatchObject({ tenantId: id, reason: "Recover failed customer discovery",
        body: { tenantId: id, operationId: "original-intent", confirm: true } });
      await check(page.getByText("Never observed", { exact: true })).toBeVisible();
      await page.getByLabel("Queue", { exact: true }).selectOption("publishing");
      await check(page.getByText("retained-publishing", { exact: false })).toBeVisible();
      await check(page.getByRole("button", { name: "Review discovery recovery" })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it("requires a reason and revision for feature toggles, exposes history and warns before deleting a fallback control", async () => {
    const { page, calls, errors } = await open("/admin/feature-flags");
    try {
      await check(page.getByRole("switch", { name: "Enable team_workspaces", exact: true })).toBeDisabled();
      await page.getByLabel("Flag change reason").fill("Enable reviewed team rollout");
      await page.getByRole("switch", { name: "Enable team_workspaces", exact: true }).click();
      await check(page.getByRole("switch", { name: "Enable team_workspaces", exact: true })).toBeChecked();
      expect(calls.find(call => call.method === "PATCH")).toMatchObject({ body: { enabled: true, revision: 1 }, reason: "Enable reviewed team rollout" });
      await page.getByRole("button", { name: "Ownership, rollout and history", exact: true }).click();
      await check(page.getByRole("heading", { name: "Flag ownership and rollout", exact: true })).toBeVisible();
      await check(page.getByText("actor / Review rollout", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Delete team_workspaces", exact: true }).click();
      await check(page.getByRole("heading", { name: "Delete this runtime control?", exact: true })).toBeVisible();
      expect(calls.some(call => call.method === "DELETE")).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it("searches all investigation sources and persists a safe account-scoped browser view", async () => {
    const { page, calls, errors } = await open("/admin/search");
    try {
      await page.getByLabel("Name, email, record ID or resource path", { exact: true }).fill("reader");
      await page.getByRole("button", { name: "Search platform", exact: true }).click();
      await check(page.getByRole("heading", { name: "Deliveries (26)", exact: true })).toBeVisible();
      await page.getByLabel("View name", { exact: true }).fill("Reader investigation");
      await page.getByRole("button", { name: "Save current search", exact: true }).click();
      await check(page.getByRole("link", { name: "Reader investigation", exact: true })).toBeVisible();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("tsp:admin:saved-views:actor") ?? "[]"));
      expect(saved).toEqual([{ name: "Reader investigation", href: "/admin/search?q=reader" }]);
      expect(calls.filter(call => call.path.includes("q=reader"))).toHaveLength(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});
