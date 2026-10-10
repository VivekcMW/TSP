import { expect, test, type Page } from "@playwright/test";

const publicRoutes = [
  "/", "/pricing", "/how-it-works", "/industries", "/blog",
  "/blog/one-voice-ten-platforms", "/resources", "/about", "/contact",
  "/privacy", "/terms", "/refund-policy", "/subscription-cancellation",
  "/data-retention", "/ai-data-processing", "/cookies", "/email-preferences",
  "/invitation-preferences", "/newsletter", "/case-studies", "/careers",
  "/sign-in", "/sign-up", "/verify-email", "/reset-password",
];

const workspaceRoutes = [
  "/dashboard",
  "/dashboard/discover",
  "/dashboard/content",
  "/dashboard/calendar",
  "/dashboard/settings",
  "/dashboard/create",
];

const adminRoutes = [
  "/admin",
  "/admin/tenants",
  "/admin/users",
  "/admin/integrations",
  "/admin/audit-log",
  "/admin/engine-runs",
  "/admin/feature-flags",
  "/admin/monitoring",
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

async function expectConsistentSurface(page: Page, path: string, workspace: boolean) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1:visible"), `${path} must expose one visible page heading`).toHaveCount(1);
  await expect(page.locator("main:visible"), `${path} must expose one visible main landmark`).toHaveCount(1);
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
    await route.fulfill({ response, json: { ...user, platformRole: "platform_admin" } });
  });
  await page.route("**/api/admin/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/admin/usage") {
      return route.fulfill({ json: { tenants: 3, users: 5, inboxItems: 24, drafts: 8, engineRuns: 4 } });
    }
    if (pathname === "/api/admin/monitoring") {
      const counts = { waiting: 0, active: 0, completed: 4, failed: 0, delayed: 0, paused: 0 };
      return route.fulfill({ json: {
        generatedAt: new Date(0).toISOString(),
        tenantCount: 3,
        queue: { configured: true, reachable: true, queuesReady: true },
        scheduler: { enabled: true, designated: true },
        jobs: { inbox: counts, publishing: counts },
        scheduled: 0,
        publishing: 0,
        failed: 0,
        overdue: 0,
        recentFailures: [],
        engineFailures: [],
      } });
    }
    return route.fulfill({ json: [] });
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
});

test.describe("workspace consistency", () => {
  for (const path of workspaceRoutes) {
    test(`${path} is responsive and visually consistent`, async ({ page }) => {
      for (const viewport of workspaceViewports) {
        await page.setViewportSize(viewport);
        await expectConsistentSurface(page, path, true);
      }
    });
  }
});

test.describe("admin consistency", () => {
  for (const path of adminRoutes) {
    test(`${path} is responsive and visually consistent`, async ({ page }) => {
      await mockAdminApi(page);
      for (const viewport of workspaceViewports) {
        await page.setViewportSize(viewport);
        await expectConsistentSurface(page, path, true);
      }
    });
  }
});
