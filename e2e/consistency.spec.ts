import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAILS } from "../shared/admin-access";
import { ADMIN_TENANT_PAGE_SIZE, type AdminMonitoring, type TenantDirectory } from "../shared/admin";

const publicRoutes = [
  "/", "/pricing", "/how-it-works", "/blog",
  "/blog/one-voice-ten-platforms", "/about", "/contact",
  "/privacy", "/terms", "/refund-policy", "/subscription-cancellation",
  "/data-retention", "/ai-data-processing", "/cookies", "/email-preferences",
  "/invitation-preferences", "/newsletter", "/case-studies", "/careers", "/tools/linkedin-post-generator",
  "/tools", "/tools/linkedin-hook-generator", "/tools/linkedin-hashtag-generator", "/tools/linkedin-post-formatter",
  "/sign-in", "/sign-up", "/verify-email", "/reset-password",
];

const workspaceRoutes = [
  { path: "/dashboard", heading: "Home" },
  { path: "/dashboard/discover", heading: "Discover" },
  { path: "/dashboard/content", heading: "Content" },
  { path: "/dashboard/calendar", heading: "Calendar" },
  { path: "/dashboard/settings", heading: "Settings" },
  { path: "/dashboard/create", heading: "Create post" },
];

const adminRoutes = [
  { path: "/admin", heading: "Command Center", readyText: "Customer investigation" },
  { path: "/admin/tenants", heading: "Tenants", readyText: "No workspaces on this page." },
  { path: "/admin/users", heading: "Users", readyText: "No records on this page." },
  { path: "/admin/integrations", heading: "Integration Management", readyText: "No integrations configured yet." },
  { path: "/admin/audit-log", heading: "Audit Log", readyText: "No records on this page." },
  { path: "/admin/engine-runs", heading: "Pipeline", readyText: "No engine runs recorded yet" },
  { path: "/admin/feature-flags", heading: "Feature Flags", readyText: "No feature flags yet." },
  { path: "/admin/monitoring", heading: "Platform Monitoring", readyText: "No failures in the returned sample." },
];

const publicViewports = [
  { width: 320, height: 760 },
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
];

const workspaceViewports = [
  { width: 320, height: 760 },
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
];

async function expectConsistentSurface(page: Page, path: string, workspace: boolean, expected?: { heading: string; readyText?: string }) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  if (workspace) await expect(page).toHaveURL(url => url.pathname === path);
  await expect(page.locator("h1:visible"), `${path} must expose one visible page heading`).toHaveCount(1);
  await expect(page.locator("main:visible"), `${path} must expose one visible main landmark`).toHaveCount(1);
  if (expected) {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(expected.heading);
    if (expected.readyText) await expect(page.locator("main").getByText(expected.readyText)).toBeVisible();
    await expect(page).toHaveURL(url => url.pathname === path);
  }
  await expect.poll(() => page.evaluate(() => ({
    bodyFont: getComputedStyle(document.body).fontFamily.toLowerCase(),
    touchTarget: getComputedStyle(document.documentElement).getPropertyValue("--touch-target").trim(),
  })), { message: `${path} design tokens and typography must be applied` }).toEqual({
    bodyFont: expect.stringContaining("inter"),
    touchTarget: "2.75rem",
  });
  await page.evaluate(() => document.fonts.ready);

  const result = await page.evaluate(({ workspace }) => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const label = (element: Element) => ({
      tag: element.tagName,
      text: element.textContent?.trim().slice(0, 80) ?? "",
      className: typeof element.className === "string" ? element.className : "",
    });
    const viewportWidth = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth > viewportWidth + 1
      ? [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(visible)
        .filter(element => {
          const box = element.getBoundingClientRect();
          return box.left < -1 || box.right > viewportWidth + 1;
        })
        .filter(element => !element.closest('[data-radix-popper-content-wrapper], [role="dialog"]'))
        .slice(0, 10)
        .map(label)
      : [];
    const brokenImages = [...document.images]
      .filter(image => visible(image) && image.complete && image.naturalWidth === 0)
      .map(label);
    const heading = [...document.querySelectorAll<HTMLElement>("h1")].find(visible);
    const bodyFont = getComputedStyle(document.body).fontFamily.toLowerCase();
    const headingFont = heading ? getComputedStyle(heading).fontFamily.toLowerCase() : "";
    const controls = [...document.querySelectorAll<HTMLElement>("button, [role='button'], a[href]")]
      .filter(visible)
      .filter(element => element.matches("button, [role='button']") || Boolean(element.querySelector("[data-button-label]")))
      .filter(element => element.getAttribute("role") !== "switch")
      .filter(element => !element.closest("[aria-hidden='true']"));
    const undersizedControls = innerWidth < 768
      ? controls.filter(element => {
          const box = element.getBoundingClientRect();
          const iconOnly = !element.textContent?.trim();
          return box.height < 43 || (iconOnly && box.width < 43);
        }).slice(0, 10).map(element => ({ ...label(element), box: element.getBoundingClientRect().toJSON() }))
      : [];
    const primary = controls.filter(element =>
      element.classList.contains("bg-primary") &&
      !element.matches(":disabled, [aria-disabled='true']"),
    );
    const primaryStyles = primary.map(element => {
      const style = getComputedStyle(element);
      return { ...label(element), colors: `${style.backgroundColor}|${style.color}` };
    });
    const pageHeader = document.querySelector<HTMLElement>("[data-page-header] [data-page-container]");
    const pageBody = document.querySelector<HTMLElement>("[data-page-body] [data-page-container]");
    const alignment = workspace && pageHeader && pageBody
      ? {
          left: Math.abs(pageHeader.getBoundingClientRect().left - pageBody.getBoundingClientRect().left),
          right: Math.abs(pageHeader.getBoundingClientRect().right - pageBody.getBoundingClientRect().right),
        }
      : null;
    return {
      documentOverflow: document.documentElement.scrollWidth - viewportWidth,
      bodyOverflow: document.body.scrollWidth - viewportWidth,
      overflow,
      brokenImages,
      bodyFont,
      headingFont,
      undersizedControls,
      primaryStyles,
      alignment,
    };
  }, { workspace });

  expect(result.documentOverflow, `${path} document overflow: ${JSON.stringify(result.overflow)}`).toBeLessThanOrEqual(1);
  expect(result.bodyOverflow, `${path} body overflow: ${JSON.stringify(result.overflow)}`).toBeLessThanOrEqual(1);
  expect(result.overflow, `${path} elements outside the viewport`).toEqual([]);
  expect(result.brokenImages, `${path} contains broken visible images`).toEqual([]);
  expect(result.bodyFont, `${path} body typography`).toContain("inter");
  expect(result.headingFont, `${path} heading typography`).toContain("poppins");
  expect(result.undersizedControls, `${path} has controls below the 44px touch target`).toEqual([]);
  expect(
    new Set(result.primaryStyles.map(action => action.colors)).size,
    `${path} primary actions must share one color pair: ${JSON.stringify(result.primaryStyles)}`,
  ).toBeLessThanOrEqual(1);
  if (workspace && result.alignment) {
    expect(result.alignment!.left, `${path} left gutter mismatch`).toBeLessThanOrEqual(1);
    expect(result.alignment!.right, `${path} right gutter mismatch`).toBeLessThanOrEqual(1);
  }
}

async function mockAdminApi(page: Page) {
  await page.route("**/api/me", async route => {
    const response = await route.fetch();
    const user = await response.json();
    await route.fulfill({ response, json: { ...user, email: ADMIN_EMAILS[0], emailVerified: true, platformRole: "platform_admin" } });
  });
  await page.route("**/api/admin/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      throw new Error(`Unexpected admin fixture request: ${route.request().method()} ${pathname}`);
    }
    if (["/api/admin/tenant-directory", "/api/admin/users-directory", "/api/admin/audit-directory"].includes(pathname)) {
      const emptyPage = { items: [], total: 0, page: 1, pageSize: ADMIN_TENANT_PAGE_SIZE } satisfies TenantDirectory;
      return route.fulfill({ json: emptyPage });
    }
    if (pathname === "/api/admin/monitoring") {
      const counts = { waiting: 0, active: 0, completed: 4, failed: 0, delayed: 0, paused: 0 };
      const monitoring = {
        generatedAt: new Date(0).toISOString(),
        environment: "production",
        tenantCount: 3,
        queue: { configured: true, reachable: true, queuesReady: true },
        scheduler: { enabled: true, designated: true, production: true },
        jobs: { inbox: counts, publishing: counts },
        scheduled: 0,
        publishing: 0,
        failed: 0,
        overdue: 0,
        recentFailures: [],
        engineFailures: [],
        tenantSignals: [],
      } satisfies AdminMonitoring;
      return route.fulfill({ json: monitoring });
    }
    if (["/api/admin/integrations", "/api/admin/engine-runs", "/api/admin/feature-flags"].includes(pathname)) {
      return route.fulfill({ json: [] });
    }
    throw new Error(`Unexpected admin fixture request: GET ${pathname}`);
  });
}

test.describe("public consistency", () => {
  for (const path of publicRoutes) {
    test(`${path} is responsive and visually consistent`, async ({ page }) => {
      for (const viewport of publicViewports) {
        await page.setViewportSize(viewport);
        await expectConsistentSurface(page, path, false);
      }
    });
  }

  test("formatter preview can expand and collapse with a 44px touch target", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto("/tools/linkedin-post-formatter");
    const preview = page.getByTestId("text-formatter-preview");
    for (const name of ["…see more", "show less"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      if (!box) throw new Error(`Missing ${name} button bounds`);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await button.click();
      if (name === "…see more") await expect(preview).toContainText("What's stopping you from posting weekly?");
      else await expect(preview).not.toContainText("What's stopping you from posting weekly?");
    }
  });
});

test.describe("workspace consistency", () => {
  for (const route of workspaceRoutes) {
    test(`${route.path} is responsive and visually consistent`, async ({ page }) => {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Skip tour", exact: true }).click();
      await expect(page.getByTestId("dialog-app-tour")).toHaveCount(0);
      for (const viewport of workspaceViewports) {
        await page.setViewportSize(viewport);
        await expectConsistentSurface(page, route.path, true, route);
      }
    });
  }
});

test.describe("admin consistency", () => {
  for (const route of adminRoutes) {
    test(`${route.path} is responsive and visually consistent`, async ({ page }) => {
      await mockAdminApi(page);
      for (const viewport of workspaceViewports) {
        await page.setViewportSize(viewport);
        await expectConsistentSurface(page, route.path, true, route);
      }
    });
  }
});
