import { expect } from "vitest";
import { expect as browserExpect, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { PLATFORMS } from "../../client/src/lib/platforms";
import { DIRECT_PUBLISH_PLATFORMS } from "../../shared/publishing-capabilities";
import { saveCreationSessionSchema, type CreationSession } from "../../shared/creation-session";

// Test data only. No server imports, dotenv, credentials, provider or DB access.
export const LONG_TITLE = "Research across regions: a deliberately long editorial headline about responsible product decisions, accessible interfaces and careful human review";
export const LONG_TEXT = "A long source paragraph explains the decision and its limitations without claiming verification. ".repeat(12);
// Saved focus obeys the real 500-character limit; article/post text is longer.
export const LONG_FOCUS = LONG_TEXT.slice(0, 480);
const revision = "2026-10-01T08:00:00.000Z";
export function fixtureDraft(id = "loaded-ready", content = LONG_TEXT, platform = "linkedin") {
  return { id, tenantId: "tenant-a", userId: "a", inboxItemId: null as string | null, platform, tone: "professional", content,
    media: [], platformPublishRules: {}, status: "draft", publishStatus: "draft", createdAt: revision, updatedAt: revision,
    scheduledAt: null as string | null, publishedAt: null, publishApprovedAt: null as string | null,
    publishApprovedBy: null as string | null };
}
type DraftRow = ReturnType<typeof fixtureDraft>;
type ScheduleRow = { id: string; draftId: string; status: string; scheduledPublishAt: string; updatedAt: string; draft: DraftRow;
  targets: { id: string; platform: string; status: string; revision: number; updatedAt: string; providerPostId: null; receiptKind: null }[] };
export function fixtureReview(platform: string, content = `A ${platform} post from the isolated article. Review the source and limitations before sharing.`) {
  return { article: { title: LONG_TITLE, content: LONG_TEXT, source: "Fixture newsroom", domain: "news.invalid", url: "https://news.invalid/story", media: [] },
    format: "short-post", posts: { [platform]: { thoughtLeader: content } }, details: {} };
}
export function deferredResponse() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
type ApiCall = { method: string; pathname: string; search: string; body: Record<string, unknown>; tenant: string | undefined };
type PlannedWrite = { method: string; pathname: string; check: (call: ApiCall) => void;
  respond: () => { body: unknown; status?: number } | Promise<{ body: unknown; status?: number }> };
type Job = { platform: string; failed?: boolean; gate?: ReturnType<typeof deferredResponse>; resultGate?: ReturnType<typeof deferredResponse>; content?: string; scope: string };

/** Layered above the original harness guard: every API is intercepted, every
 * write must be armed in exact order immediately before its intentional action.
 * Unexpected requests fail teardown even if React handles their HTTP error. */
export async function installActualAppApi(page: Page, origin: string, errors: string[], sharedCalls: { method: string; pathname: string }[]) {
  const creations = new Map<string, { revision: number; state: CreationSession | null }>();
  const scheduledDraft = { ...fixtureDraft("loaded-scheduled"), publishStatus: "scheduled", scheduledAt: "2026-10-03T09:00:00.000Z" };
  const state = {
    userId: "a", tenantId: "tenant-a", enabledPlatforms: PLATFORMS.map(platform => platform.value),
    drafts: [fixtureDraft(), scheduledDraft], schedules: [{ id: "schedule-loaded", draftId: scheduledDraft.id,
      scheduledPublishAt: scheduledDraft.scheduledAt, status: "scheduled", updatedAt: revision, draft: scheduledDraft,
      targets: [{ id: "target-loaded", platform: "linkedin", status: "scheduled", revision: 0, updatedAt: revision, providerPostId: null, receiptKind: null }] }] as ScheduleRow[],
    stories: [{ id: "loaded-story", tenantId: "tenant-a", userId: "a", headline: LONG_TITLE, source: "Fixture newsroom",
      summary: LONG_TEXT, articleUrl: "https://news.invalid/story", matchedKeywords: ["Research", "Accessibility"], status: "active", createdAt: revision }],
    faults: new Map<string, string>(), writes: [] as PlannedWrite[], calls: [] as ApiCall[], settled: [] as ApiCall[], jobs: new Map<string, Job>(),
  };
  const plan = (method: string, pathname: string, body: Record<string, unknown>, respond: PlannedWrite["respond"]) => {
    state.writes.push({ method, pathname, check: call => expect(call.body).toEqual(body), respond });
  };
  const generation = (platform: string, options: Partial<Omit<Job, "platform" | "scope">> = {}) => {
    const id = `00000000-0000-4000-8000-${String(state.jobs.size + 1).padStart(12, "0")}`;
    const scope = state.tenantId;
    state.jobs.set(id, { platform, ...options, scope });
    state.writes.push({ method: "POST", pathname: "/api/instant-review/manual", check: call => {
      const { requestIntent, ...body } = call.body;
      expect(requestIntent).toMatch(/^[0-9a-f-]{36}$/);
      expect(state.calls.filter(item => item.method === "POST" && item.body.requestIntent === requestIntent)).toHaveLength(1);
      expect(call.tenant).toBe(scope);
      expect(body).toEqual({ stage: "platform", title: LONG_TITLE, content: LONG_TEXT, media: [],
        sourceUrl: "https://news.invalid/story", sourceLabel: "Fixture newsroom",
        selectedPlatforms: [platform], tones: ["thoughtLeader"], format: "short-post" });
    }, respond: () => ({ status: 202, body: { jobId: id, status: "queued" } }) });
    return id;
  };
  const reads = new Map<string, () => unknown>([
    ["/api/creation-session", () => creations.get(`${state.tenantId}:${state.userId}`) ?? { revision: 0, state: null }],
    ["/api/me", () => ({ id: state.userId, name: "A reader with a long display name for layout coverage", firstName: "Reader",
      email: `${state.userId}@example.invalid`, registrationCompleted: revision, platformRole: null, industry: "Product research" })],
    ["/api/profile", () => ({ id: `profile-${state.tenantId}`, userId: state.userId, tenantId: state.tenantId,
      onboardingStatus: "completed", focusDescription: LONG_FOCUS, keywords: ["Research", "Accessibility"], publications: [], companies: [], influencers: [],
      enabledPlatforms: state.enabledPlatforms, defaultPlatform: "linkedin", defaultTone: "professional", timezone: "Asia/Kolkata",
      preferredPublishTime: "18:45", requirePublishReview: true })],
    ["/api/drafts", () => state.drafts],
    ["/api/drafts/published", () => state.drafts.filter(draft => draft.publishStatus === "published")],
    ["/api/drafts/scheduled", () => ({ items: state.schedules, total: state.schedules.length, hasMore: false })],
    ["/api/integrations", () => PLATFORMS.map(platform => ({ key: platform.value, label: platform.label, enabled: true, capabilities: ["publish"] }))],
    ["/api/analytics/summary", () => ({ connected: { linkedin: true, twitter: true }, linkedin: null, twitter: null, lastSync: null })],
    ["/api/team/context", () => ({ tenantId: state.tenantId, tenantName: "Personal workspace", tenantKind: "personal", role: "owner", memberships: [] })],
    ["/api/billing", () => ({ configured: false, keyId: null, plans: [], currentPlan: null,
      subscription: { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: "2099-10-17T00:00:00.000Z" }, payments: [], paymentMethods: [] })],
    ["/api/email-preferences", () => ({ dailyDigest: true, reminders: true, contentAlerts: false, productUpdates: true, marketing: false,
      publishing: true, accountAlerts: true, digestTimezone: "Asia/Kolkata", digestTime: "09:00", remindersPausedUntil: null })],
    ["/api/editorial/voice", () => ({ enabled: false, revision: 0, samples: [] })],
    ["/api/invitations/template", () => ({ enabled: false, subject: "An invitation from {InviterName}", body: `Hi {FirstName}, ${LONG_TEXT}\n{link}` })],
  ]);
  for (const pathname of ["/api/publishing-rules", "/api/sources", "/api/sources/suggestions", "/api/sources/publications", "/api/profile/social-links"]) reads.set(pathname, () => []);
  async function readJob(call: ApiCall, match: RegExpExecArray) {
    const job = state.jobs.get(match[1]);
    expect(job, "Only explicitly admitted fixture jobs exist").toBeDefined();
    expect(call.tenant).toBe(job!.scope);
    if (match[2]) {
      expect(job!.failed, "Failed jobs have no result endpoint").not.toBe(true);
      await job!.resultGate?.promise;
      return { body: fixtureReview(job!.platform, job!.content) };
    }
    await job!.gate?.promise;
    return { body: { status: job!.failed ? "failed" : "completed", progress: { platformsCompleted: job!.failed ? 0 : 1, platformsTotal: 1 },
      ...(job!.failed ? { error: { status: 422, body: { message: "Fixture terminal generation failure. No usable post returned." } } } : {}) } };
  }
  async function readApi(call: ApiCall, url: URL): Promise<{ body: unknown; status?: number }> {
    if (state.faults.has(call.pathname)) return { body: { message: state.faults.get(call.pathname) }, status: 503 };
    const read = reads.get(call.pathname);
    if (read) return { body: read() };
    if (call.pathname === "/api/inbox") return { body: state.stories.filter(story => !url.searchParams.has("status") || story.status === url.searchParams.get("status")) };
    const snapshot = /^\/api\/drafts\/([^/]+)\/(?:editing-snapshot|details)$/.exec(call.pathname);
    if (snapshot) {
      const row = state.drafts.find(draft => draft.id === decodeURIComponent(snapshot[1]));
      expect(row, "Only owned canonical draft rows can be read").toBeDefined();
      return { body: row };
    }
    const job = /^\/api\/editorial\/jobs\/([^/]+)(\/result)?$/.exec(call.pathname);
    if (job) return readJob(call, job);
    const connection = /^\/api\/integrations\/([^/]+)\/status$/.exec(call.pathname);
    if (connection && (DIRECT_PUBLISH_PLATFORMS as readonly string[]).includes(connection[1])) return { body: { connected: true, assessment: { status: "connected", canPublish: true } } };
    throw new Error(`Unmocked API: ${call.method} ${call.pathname}${call.search}`);
  }
  await page.route(url => url.origin === origin && url.pathname.startsWith("/api/"), async route => {
    const request = route.request(), url = new URL(request.url());
    const call: ApiCall = { method: request.method(), pathname: url.pathname, search: url.search,
      body: {}, tenant: request.headers()["x-tenant-id"] };
    state.calls.push(call); sharedCalls.push({ method: call.method, pathname: call.pathname });
    const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    try {
      call.body = request.postDataJSON() ?? {};
      if (call.method === "GET") {
        const result = await readApi(call, url);
        return await reply(result.body, result.status);
      }
      if (call.method === "PUT" && call.pathname === "/api/creation-session") {
        expect(call.tenant ?? `tenant-${state.userId}`).toBe(state.tenantId);
        const change = saveCreationSessionSchema.parse(call.body);
        const key = `${state.tenantId}:${state.userId}`;
        const previous = creations.get(key) ?? { revision: 0, state: null };
        if (change.revision !== previous.revision) return await reply({ message: "Creation changed in another tab." }, 409);
        const saved = { revision: previous.revision + 1, state: change.state };
        creations.set(key, saved);
        return await reply(saved);
      }
      const next = state.writes.shift();
      expect(next, `Unplanned ${call.method} ${call.pathname}`).toBeDefined();
      expect([call.method, call.pathname]).toEqual([next!.method, next!.pathname]);
      next!.check(call);
      const result = await next!.respond();
      return await reply(result.body, result.status);
    } catch (error) {
      // Only a held job response may be disposed by a lifecycle boundary.
      const job = state.jobs.get(call.pathname.split("/")[4]);
      const held = job?.gate || job?.resultGate;
      if (held && error instanceof Error && /Target.*closed|Response has been disposed|Invalid InterceptionId|interception.*already handled/.test(error.message)) return;
      errors.push(String(error));
      await reply({ message: "Unexpected fixture request" }, 500).catch(() => {});
    } finally { state.settled.push(call); }
  });
  // Native external handoffs are never permitted by these journeys, even before
  // a popup emits a network request that the base guard would block.
  await page.addInitScript(() => {
    Object.assign(window, { __actualAppHandoffs: [] as string[] });
    window.open = (...args) => { (window as any).__actualAppHandoffs.push(`open:${String(args[0])}`); return null; };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text: string) => { (window as any).__actualAppHandoffs.push(`copy:${text}`); return Promise.resolve(); } } });
  });
  return { state, plan, generation,
    seedDocument: () => creations.set(`${state.tenantId}:${state.userId}`, { revision: 1, state: {
      version: 1, step: "review", source: { mode: "article", url: "https://news.invalid/story", inboxItemId: "loaded-story",
        manual: { title: "", content: "", media: [] } },
      tone: "thoughtLeader", format: "short-post", selectedPlatforms: [],
      main: { title: LONG_TITLE, content: LONG_TEXT, original: LONG_TEXT, revision: 1, reviewJson: JSON.stringify(fixtureReview("linkedin")) },
      chat: { input: "", referenceUrls: [], messages: [] }, versions: [],
    } }),
    count: (method: string, pathname: string) => state.calls.filter(call => call.method === method && call.pathname === pathname).length,
    assertWrites: (expected: [string, string][]) => {
      // Autosaves are separately validated for schema, tenant and revision above.
      expect(state.calls.filter(call => call.method !== "GET" && !(call.method === "PUT" && call.pathname === "/api/creation-session"))
        .map(call => [call.method, call.pathname])).toEqual(expected);
      expect(state.writes, "Every planned action must actually have occurred").toEqual([]);
    },
    assertNoDelivery: async () => {
      expect(state.calls.filter(call => /(?:publish-now|retry-publish|\/targets\/|media\/upload)|(?:\/invitations$)/.test(call.pathname))).toEqual([]);
      expect(await page.evaluate(() => (window as any).__actualAppHandoffs)).toEqual([]);
    },
  };
}
export type ActualAppApi = Awaited<ReturnType<typeof installActualAppApi>>;

export async function expectActualAppGeometry(page: Page) {
  if (await page.evaluate(() => Boolean(window.__actualAppTextZoom))) await expectDoubledText(page);
  const geometry = await page.getByRole("main").evaluate(main => {
    // The document canvas aligns its paper with the sticky chat, not the full-width editor controls.
    const header = main.querySelector<HTMLElement>("[data-page-header] > [data-page-container], [data-testid='sticky-chat'] > div")!;
    const body = main.querySelector<HTMLElement>("[data-page-body] > [data-page-container]")
      ?? main.querySelector<HTMLElement>("article[aria-label='Editable document']")!.parentElement!;
    const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible";
    const label = (element: Element) => `${element.tagName}#${element.id}[${element.getAttribute("aria-label") ?? (element as HTMLElement).dataset.testid ?? ""}] ${element.getAttributeNames().filter(name => name.startsWith("data-page-")).join(" ")} .${element.getAttribute("class") ?? ""}`;
    const localScroll = (element: Element) => element.closest('fieldset[aria-label="Article formatting toolbar"], fieldset[aria-label="Platforms to generate"], [role="toolbar"][aria-label="Document formatting"], [aria-label="Attached articles"]');
    const containers = [...main.querySelectorAll<HTMLElement>('section, article, fieldset, [data-page-body], [data-page-container], [data-page-filters], [data-discover-panes], [role="tabpanel"]')].filter(visible);
    const overflow = containers.filter(element => element.scrollWidth > element.clientWidth + 1 && !localScroll(element))
      .map(element => ({ element: label(element), client: element.clientWidth, scroll: element.scrollWidth, overflow: getComputedStyle(element).overflowX }));
    const clipped: unknown[] = [];
    // Text ranges detect clipping that overflow:hidden on an outer frame conceals.
    // Explicit line-clamped excerpts are intentional, unlike clipped actions/help.
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, element = node.parentElement!;
      if (!node.textContent?.trim() || !visible(element) || element.closest('option, script, style, .sr-only, .truncate, .line-clamp-2, .line-clamp-3') || localScroll(element)) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
          const css = getComputedStyle(ancestor), outer = ancestor.getBoundingClientRect();
          if (/hidden|clip|auto|scroll/.test(css.overflowX) && (box.left < outer.left + ancestor.clientLeft - 1 || box.right > outer.left + ancestor.clientLeft + ancestor.clientWidth + 1)) {
            clipped.push({ text: node.textContent.slice(0, 100), ancestor: label(ancestor), left: box.left, right: box.right, outer: outer.toJSON() }); break;
          }
        }
      }
    }
    const a = header.getBoundingClientRect(), b = body.getBoundingClientRect();
    return { header: a.toJSON(), body: b.toJSON(), viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, overflow, clipped };
  });
  expect(Math.abs(geometry.header.left - geometry.body.left), JSON.stringify(geometry)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.header.right - geometry.body.right), JSON.stringify(geometry)).toBeLessThanOrEqual(1);
  expect(geometry.header.left).toBeGreaterThanOrEqual(0);
  expect(geometry.header.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.overflow, "Unexpected local horizontal overflow (outer clipping cannot hide it)").toEqual([]);
  expect(geometry.clipped, "Visible text must fit every horizontal clipping ancestor").toEqual([]);
}

export async function expectReachableAction(control: Locator) {
  await browserExpect(control).toBeVisible();
  // Native scrolling only; do not alter overflow, heights, sticky headers or force clicks.
  // scrollIntoView can scroll overflow:hidden programmatically. Reject that
  // otherwise-inaccessible movement instead of making a clipped action pass.
  await control.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await browserExpect.poll(() => control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const clips: string[] = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const css = getComputedStyle(ancestor), outer = ancestor.getBoundingClientRect();
      if (/hidden|clip/.test(css.overflowY) && ancestor.scrollTop > 1) clips.push(`Non-user-scrollable ancestor moved: ${ancestor.outerHTML.slice(0, 200)}`);
      if (/auto|scroll|hidden|clip/.test(css.overflowY) && (box.top < outer.top + ancestor.clientTop - 1 || box.bottom > outer.top + ancestor.clientTop + ancestor.clientHeight + 1)) clips.push(ancestor.outerHTML.slice(0, 200));
    }
    const hits = [2, box.height / 2, box.height - 2].map(y => document.elementFromPoint(box.left + box.width / 2, box.top + y));
    return { fits: box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
      clips, hit: hits.every(hit => hit === element || element.contains(hit)) };
  })).toEqual({ fits: true, clips: [], hit: true });
}

export async function expectReadableControls(scope: Locator) {
  await browserExpect.poll(() => scope.evaluate(root => {
    const rgba = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return [...root.querySelectorAll<HTMLElement>('button, input:not([type="checkbox"]):not([type="hidden"]), select, textarea, a[href], [role="textbox"]')]
      .filter(element => element.getClientRects().length && !element.closest('.sr-only') && !element.matches(':disabled,[aria-disabled="true"]') && (element.innerText.trim() || element.getAttribute("aria-label") || element instanceof HTMLInputElement))
      .flatMap(element => {
        // Native color inputs paint a swatch, not CSS-colored text, and Chromium
        // intentionally preserves that chosen color under forced colors. Test
        // their labelled boundary and icon, never a fictional text/swatch pair.
        const swatch = element instanceof HTMLInputElement && element.type === "color";
        const surface = swatch ? element.closest("label") : element;
        const indicator = swatch ? surface?.querySelector("svg") : element;
        if (!surface || !indicator || (swatch && !element.getAttribute("aria-label"))) return [{ text: "Unlabelled color control" }];
        let background = [255, 255, 255];
        const ancestors: HTMLElement[] = [];
        for (let node: HTMLElement | null = surface; node; node = node.parentElement) ancestors.unshift(node);
        for (const node of ancestors) {
          const color = rgba(getComputedStyle(node).backgroundColor), alpha = color[3] ?? 1;
          background = background.map((value, index) => alpha * color[index] + (1 - alpha) * value);
        }
        const css = getComputedStyle(indicator), foreground = rgba(css.color), alpha = foreground[3] ?? 1;
        const fg = luminance(background.map((value, index) => foreground[index] * alpha + value * (1 - alpha))), bg = luminance(background);
        const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        if (swatch) {
          const boundary = getComputedStyle(surface), border = rgba(boundary.borderTopColor), opacity = border[3] ?? 1;
          const edge = luminance(background.map((value, index) => border[index] * opacity + value * (1 - opacity)));
          const boundaryContrast = (Math.max(edge, bg) + 0.05) / (Math.min(edge, bg) + 0.05);
          if (Number.parseFloat(boundary.borderTopWidth) < 1 || !Number.isFinite(boundaryContrast) || boundaryContrast < 3) return [{ text: "Color control boundary", boundaryContrast }];
        }
        const visible = ancestors.every(node => Number(getComputedStyle(node).opacity) >= 0.99 && getComputedStyle(node).visibility === "visible");
        const large = Number.parseFloat(css.fontSize) >= 24 || Number.parseFloat(css.fontSize) >= 18.66 && Number.parseInt(css.fontWeight) >= 700;
        const minimumContrast = swatch || large ? 3 : 4.5;
        return !visible || !Number.isFinite(ratio) || ratio < minimumContrast ? [{ text: element.innerText.slice(0, 80), label: element.getAttribute("aria-label"), color: css.color, background, ratio, visible }] : [];
      });
  })).toEqual([]);
}

declare global {
  interface Window {
    __actualAppTextZoom?: {
      refresh: () => number;
      mismatches: () => { element: string; expected: string; actual: string }[];
    };
  }
}

/** Text-only 200% inflation, including inherited labels and later React mounts.
 * Restore ALL unzoomed typography before taking a new snapshot; measuring a new
 * span under an already doubled parent would otherwise turn 200% into 400%.
 * Only font-size/line-height are changed, never rem sizing, layout or overflow. */
export async function doubleTextSize(page: Page) {
  const expectedHeading = await page.evaluate(() => {
    if (window.__actualAppTextZoom) return window.__actualAppTextZoom.refresh();
    type StyledElement = HTMLElement | SVGElement;
    // Stylesheets do not mutate contenteditable DOM or trigger ProseMirror's edit observer.
    const typography = new CSSStyleSheet();
    const transitions = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, typography, transitions];
    let importantOverrides: { element: StyledElement; property: string; original: string; applied: string }[] = [];
    let sizes = new Map<StyledElement, { size: number; line: string }>();
    const elements = () => [...document.querySelectorAll("body, body *")]
      .filter((element): element is StyledElement => (element instanceof HTMLElement || element instanceof SVGElement) && !element.matches("script, style, link, meta"));
    const observer = new MutationObserver(() => refresh());
    function refresh() {
      observer.disconnect();
      const nodes = elements();
      transitions.replaceSync("body, body * { transition-property: none !important; }");
      typography.replaceSync("");
      for (const { element, property, original, applied } of importantOverrides) {
        if (element.style.getPropertyValue(property) === applied && element.style.getPropertyPriority(property) === "important") {
          element.style.setProperty(property, original, "important");
        }
      }
      importantOverrides = [];
      // Snapshot values, not live CSSStyleDeclaration objects, before any write.
      sizes = new Map(nodes.map(element => {
        const css = getComputedStyle(element);
        return [element, { size: Number.parseFloat(css.fontSize), line: css.lineHeight }] as const;
      }));
      const selectors = new Map<Element, string>();
      const rules: string[] = [];
      for (const [element, { size, line }] of sizes) {
        const selector = element === document.body ? "body"
          : `${selectors.get(element.parentElement!)} > :nth-child(${Array.from(element.parentElement!.children).indexOf(element) + 1})`;
        selectors.set(element, selector);
        const values = { "font-size": `${size * 2}px`, "line-height": line === "normal" ? "normal" : `${Number.parseFloat(line) * 2}px` };
        rules.push(`${selector} { font-size: ${values["font-size"]} !important; line-height: ${values["line-height"]} !important; }`);
        // Inline !important outranks any author stylesheet.
        for (const [property, applied] of Object.entries(values)) {
          if (element.style.getPropertyPriority(property) !== "important") continue;
          importantOverrides.push({ element, property, original: element.style.getPropertyValue(property), applied });
          element.style.setProperty(property, applied, "important");
        }
      }
      typography.replaceSync(rules.join("\n"));
      nodes.forEach(element => getComputedStyle(element).fontSize);
      transitions.replaceSync("");
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
      const heading = document.querySelector("h1");
      return heading ? (sizes.get(heading)?.size ?? Number.NaN) * 2 : Number.NaN;
    }
    const mismatches = () => elements().flatMap(element => {
      if (!element.getClientRects().length || getComputedStyle(element).visibility !== "visible") return [];
      const baseline = sizes.get(element);
      const css = getComputedStyle(element);
      const expectedLine = baseline?.line === "normal" ? "normal" : String(Number.parseFloat(baseline?.line ?? "") * 2);
      const fontMatches = baseline && Math.abs(Number.parseFloat(css.fontSize) - baseline.size * 2) < 0.05;
      const lineMatches = expectedLine === "normal" ? css.lineHeight === "normal" : Math.abs(Number.parseFloat(css.lineHeight) - Number(expectedLine)) < 0.05;
      return fontMatches && lineMatches ? [] : [{ element: `${element.tagName}#${element.id} ${element.textContent?.slice(0, 80)}`,
        expected: baseline ? `${baseline.size * 2}px / ${expectedLine}` : "200% baseline missing for newly rendered element", actual: `${css.fontSize} / ${css.lineHeight}` }];
    });
    window.__actualAppTextZoom = { refresh, mismatches };
    window.addEventListener("resize", refresh);
    return refresh();
  });
  await browserExpect.poll(() => page.locator("h1").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(expectedHeading, 1);
  await expectDoubledText(page);
}

export async function expectDoubledText(page: Page) {
  await browserExpect.poll(() => page.evaluate(() => {
    if (!window.__actualAppTextZoom) throw new Error("Text zoom was not installed");
    return window.__actualAppTextZoom.mismatches();
  }), { message: "Every rendered element, including H1 and newly inherited spans, must retain genuine 200% typography" }).toEqual([]);
}

export async function captureActualApp(page: Page, name: string) {
  const output = process.env.UX_PRIORITY_TEST_OUTPUT;
  if (!output) return;
  const root = path.resolve(output);
  expect(path.isAbsolute(output) && ["/tmp", "/private/tmp", tmpdir()].some(base => root.startsWith(`${base.replace(/\/$/, "")}/`)), "Screenshot output must be an explicitly owned temporary directory").toBe(true);
  expect(name).toMatch(/^[a-z0-9-]+$/);
  const directory = path.join(root, "screenshots", `actual-app-${process.pid}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}