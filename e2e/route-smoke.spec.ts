import { expect, test } from "@playwright/test";

const publicRoutes = [
  { path: "/", heading: /Turn what you know into influence/i },
  { path: "/pricing", heading: /Begin with your voice/i },
  { path: "/how-it-works", heading: /Automate your professional narrative/i },
  { path: "/use-cases", heading: /Start with the outcome/i },
  { path: "/use-cases/thought-leadership", heading: /Build authority from what is happening now/i },
  { path: "/use-cases/professional-content-creation", heading: /Move from a blank page/i },
  { path: "/use-cases/multi-platform-publishing", heading: /One point of view/i },
  { path: "/roles", heading: /Personal branding built around the work you do/i },
  { path: "/roles/executives", heading: /Leadership visibility without a ghostwriting team/i },
  { path: "/industries", heading: /Thought leadership for the industry you know best/i },
  { path: "/industries/advertising-media", heading: /Have a point of view on every shift in advertising/i },
  { path: "/compare", heading: /How TheSocialPundit compares/i },
  { path: "/compare/taplio", heading: /TheSocialPundit vs Taplio/i },
  { path: "/blog", heading: /Ideas for people/i },
  { path: "/sitemap", heading: /Find your way around/i },
];

for (const route of publicRoutes) {
  test(`loads ${route.path} without horizontal overflow`, async ({ page }) => {
    await page.goto(route.path);
    await expect(page.locator("h1").first()).toHaveText(route.heading);
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 3).map((element) => ({ tag: element.tagName, className: typeof element.className === "string" ? element.className : "", text: element.textContent?.trim().slice(0, 40) })),
    }));
    expect(dimensions.scrollWidth, `${route} horizontal overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}

test("shows useful recovery actions for unknown routes", async ({ page }) => {
  await page.goto("/");
  await page.goto("/route-that-does-not-exist");
  await expect(page.locator("#prerendered")).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("hidden", "");
  await expect(page.getByRole("heading", { name: "This page took a wrong turn." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: "Go back" })).toBeVisible();
  await expect(page).toHaveTitle("Page not found | TheSocialPundit");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("h1").first()).toHaveText(/Turn what you know into influence/i);
});

test("reduced motion renders public content immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pricing");
  await expect(page.locator("h1").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const heading = document.querySelector("h1");
    return heading ? getComputedStyle(heading).opacity : "0";
  })).toBe("1");
});

for (const route of publicRoutes) {
  test(`${route.path} remains usable on a phone viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(route.path);
    await expect(page.locator("h1").first()).toHaveText(route.heading);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test("authenticated workspace routes load without overflow", async ({ page }) => {
  test.skip(!process.env.E2E_TEST_EMAIL || !process.env.E2E_TEST_PASSWORD, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD for authenticated route coverage.");
  await page.goto("/sign-in");
  const fields = page.locator("input");
  await fields.nth(0).fill(process.env.E2E_TEST_EMAIL!);
  await fields.nth(1).fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  for (const route of ["/dashboard", "/dashboard/discover", "/dashboard/drafts", "/dashboard/calendar", "/dashboard/connections", "/dashboard/preferences"]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator('a[href="/dashboard/performance"], a[href="/dashboard/analytics"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  for (const route of ["/dashboard/performance", "/dashboard/analytics"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  }
});