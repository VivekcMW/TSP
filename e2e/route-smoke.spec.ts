import { expect, test } from "@playwright/test";
import { skipFirstWorkspaceTour } from "./app-tour";

const publicRoutes = [
  { path: "/", heading: /Turn industry news into LinkedIn influence/i },
  { path: "/pricing", heading: /Begin with your voice/i },
  { path: "/how-it-works", heading: /Turn industry news into thoughtful LinkedIn posts/i },
  { path: "/use-cases", heading: /Start with the outcome/i },
  { path: "/use-cases/thought-leadership", heading: /Build authority from what is happening now/i },
  { path: "/use-cases/professional-content-creation", heading: /Move from a blank page/i },
  { path: "/use-cases/multi-platform-publishing", heading: /Show up consistently on LinkedIn without posting on autopilot/i },
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
  await expect(page.locator("h1").first()).toHaveText(/Turn industry news into LinkedIn influence/i);
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
  const origin = new URL(page.url()).origin;
  await page.getByText("Use email instead", { exact: true }).click();
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  const password = page.getByRole("textbox", { name: "Password", exact: true });
  await email.fill(process.env.E2E_TEST_EMAIL!);
  await password.fill(process.env.E2E_TEST_PASSWORD!);
  const [signInResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/auth/sign-in/email")
      && response.request().method() === "POST"),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  if (!signInResponse.ok()) {
    await email.fill("");
    await password.fill("");
    throw new Error(`Candidate sign-in failed with HTTP ${signInResponse.status()}.`);
  }
  await expect(page).toHaveURL(url => url.origin === origin && (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")));
  await skipFirstWorkspaceTour(page);
  const features = await (await page.request.get(`${origin}/api/features`)).json() as { linkedinInbox?: boolean };
  const inboxLayout = features.linkedinInbox === true;

  const routes = [
    { path: "/dashboard", destination: "/dashboard", heading: "Home" },
    { path: "/dashboard/discover", destination: "/dashboard/discover", heading: "Discover" },
    { path: "/dashboard/drafts", destination: "/dashboard/content", heading: "Content" },
    { path: "/dashboard/calendar", destination: "/dashboard/calendar", heading: "Calendar" },
    { path: "/dashboard/connections", destination: "/dashboard/settings?tab=integrations", heading: "Settings", tab: "integrations" },
    { path: "/dashboard/preferences", destination: "/dashboard/settings?tab=publishing", heading: "Settings", tab: "publishing" },
  ];
  for (const route of routes) {
    await page.goto(route.path);
    await expect(page).toHaveURL(`${origin}${route.destination}`);
    if (inboxLayout && (route.path === "/dashboard" || route.path === "/dashboard/discover")) {
      await expect(page.getByRole("main", { name: "For you", exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { level: 1, name: route.heading, exact: true })).toBeVisible();
    }
    if (route.tab) await expect(page.getByRole("tab", { name: route.tab, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('a[href="/dashboard/performance"], a[href="/dashboard/analytics"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  for (const route of ["/dashboard/performance", "/dashboard/analytics"]) {
    await page.goto(route);
    await expect(page).toHaveURL(`${origin}/dashboard`);
    if (inboxLayout) await expect(page.getByRole("main", { name: "For you", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  }
});
