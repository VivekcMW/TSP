import { expect, test } from "@playwright/test";

test("new user reaches a populated Gmail workspace from one setup screen", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  test.skip(!email || !password, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD for onboarding coverage.");

  await page.goto("/sign-in");
  await page.getByText("Use email instead", { exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email!);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password!);
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-in/email") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "What do you want to talk about?" })).toBeVisible();
  await page.getByTestId("preset-ai-saas").click();
  await page.getByRole("combobox", { name: "Primary market" }).click();
  await page.getByRole("option", { name: "India", exact: true }).click();
  await page.getByRole("button", { name: "Create my LinkedIn workspace", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/discover$/);
  await expect(page.getByRole("banner", { name: "Workspace" })).toBeVisible();
  await expect(page.getByRole("search", { name: "Search your Inbox" })).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get("/api/inbox?status=active");
    return response.ok() ? (await response.json()).length : 0;
  }, { timeout: 150_000, intervals: [2_000, 5_000] }).toBeGreaterThan(0);
});
