import { expect, test } from "@playwright/test";

const publicRoutes = [
  { path: "/", heading: /Too busy to post/i },
  { path: "/pricing", heading: /Start building authority today/i },
  { path: "/how-it-works", heading: /Automate your professional narrative/i },
  { path: "/industries", heading: /Industry-specific AI that knows your field/i },
  { path: "/blog", heading: /Blog/i },
  { path: "/resources", heading: /Resources/i },
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
  await page.goto("/route-that-does-not-exist");
  await expect(page.getByRole("heading", { name: "This page took a wrong turn." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: "Go back" })).toBeVisible();
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

test("public pages remain usable on a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ["/", "/pricing", "/blog", "/resources"]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    await page.waitForTimeout(700);
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, offenders: [...document.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 3).map((element) => ({ tag: element.tagName, className: typeof element.className === "string" ? element.className : "", text: element.textContent?.trim().slice(0, 40) })) }));
    expect(dimensions.scrollWidth, `${route} horizontal overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test("authenticated workspace routes load without overflow", async ({ page }) => {
  test.skip(!process.env.E2E_TEST_EMAIL || !process.env.E2E_TEST_PASSWORD, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD for authenticated route coverage.");
  await page.goto("/sign-in");
  const fields = page.locator("input");
  await fields.nth(0).fill(process.env.E2E_TEST_EMAIL!);
  await fields.nth(1).fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  for (const route of ["/dashboard", "/dashboard/discover", "/dashboard/drafts", "/dashboard/calendar", "/dashboard/performance", "/dashboard/connections", "/dashboard/preferences"]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});