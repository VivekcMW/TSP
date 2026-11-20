import { expect, type Page } from "@playwright/test";

export async function skipFirstWorkspaceTour(page: Page) {
  const origin = new URL(page.url()).origin;
  await expect(page).toHaveURL(url => url.origin === origin && url.pathname === "/dashboard/settings"
    && url.searchParams.get("tab") === "integrations");
  await expect(page.getByRole("tab", { name: "integrations", exact: true })).toHaveAttribute("aria-selected", "true");
  const tour = page.getByTestId("dialog-app-tour");
  await expect(tour.getByRole("heading", { name: "Connect an account (optional)", exact: true })).toBeVisible();
  await expect(page.getByTestId("app-tour-arrow")).toBeVisible();
  await tour.getByRole("button", { name: "Skip tour", exact: true }).press("Enter");
  await expect(tour).toHaveCount(0);
}
