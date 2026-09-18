import { expect, test } from "@playwright/test";

// Makes real, billed calls to whichever AI_PROVIDER is configured. Gated
// separately from other authenticated tests (which only hit internal APIs
// with static content) so setting E2E_TEST_EMAIL/PASSWORD alone never starts
// spending AI provider quota/credits on every run.
const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;
const enabled = process.env.E2E_TEST_ARTICLE_GENERATION === "1";

test.skip(!email || !password || !enabled, "Set E2E_TEST_EMAIL, E2E_TEST_PASSWORD, and E2E_TEST_ARTICLE_GENERATION=1 to run live AI generation tests (makes real, billed AI provider calls).");

test("generates a post from a large article across all four tones, each citing the source", async ({ page }) => {
  test.setTimeout(75_000); // real AI generation across 4 tones has run up to ~34s in practice
  await page.goto("/sign-in");
  const fields = page.locator("input");
  await fields.nth(0).fill(email!);
  await fields.nth(1).fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole("button", { name: "Create post" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create draft" });
  await expect(dialog).toBeVisible();

  // Wikipedia's "Artificial intelligence" page is ~2.2MB of raw HTML -- this
  // exercises the crawl size cap (server/services/crawlerFetch.ts) as well
  // as the generation pipeline. A regression here would most likely show up
  // as "source_unreadable" (crawl) rather than a generation failure.
  await dialog.getByRole("textbox", { name: "Article URL" }).fill("https://en.wikipedia.org/wiki/Artificial_intelligence");
  await dialog.getByRole("button", { name: /^Generate .+ only$/ }).click();

  await expect(dialog.getByText("Generation complete.", { exact: false })).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByRole("alert")).toHaveCount(0);

  const toneSelect = dialog.getByRole("combobox", { name: "Tone" });
  const postContent = dialog.getByRole("textbox", { name: "Post content" });
  const seenContent = new Set<string>();
  for (const tone of ["Thought Leader", "Industry Insider", "Provocateur", "Data-Driven"]) {
    await toneSelect.selectOption({ label: tone });
    const content = await postContent.inputValue();
    expect(content.length, `${tone} version should have content`).toBeGreaterThan(0);
    expect(content, `${tone} version should cite the source article`).toContain("en.wikipedia.org/wiki/Artificial_intelligence");
    seenContent.add(content);
  }
  // All four tones are generated in one request (see the "One platform, four
  // tones per request" copy in the dialog) and must not be identical text.
  expect(seenContent.size, "each tone should produce distinct content").toBe(4);
});
