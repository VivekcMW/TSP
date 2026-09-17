import { expect, test, type Page } from "@playwright/test";

// Run against a frontend-only local server. Every API request is intercepted;
// this suite never requires accounts, credentials, a database, or email delivery.
test.use({
  baseURL: process.env.E2E_AUTH_BASE_URL ?? "http://127.0.0.1:4302",
  serviceWorkers: "block",
  trace: "off",
});

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Auth reset tests require a local frontend");
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/auth/get-session") return route.fulfill({ json: null });
    if (url.pathname === "/api/auth-providers") return route.fulfill({ json: { google: false, linkedin: false, twitter: false } });
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return route.fulfill({ status: 503, json: { code: "UNMOCKED_REQUEST" } });
    return route.continue();
  });
});

async function fillPasswords(page: Page, password = "replacement-password", confirmation = password) {
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(confirmation);
}

test("keeps recovery public for an existing session even when profile queries fail", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    user: { id: "reset-browser-user", email: "reset@example.com", name: "Reset test", emailVerified: true },
    session: { id: "reset-browser-session", userId: "reset-browser-user", expiresAt: "2099-01-01T00:00:00.000Z" },
  } }));
  await page.goto("/reset-password?token=synthetic-reset-token");
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
});

test("reload does not recover a token from browser storage or history", async ({ page }) => {
  await page.goto("/reset-password?token=synthetic-reset-token");
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("invalid or has expired");
  await expect(page.getByRole("link", { name: "Request a new reset link" })).toBeVisible();
});

test("resets successfully without forwarding a callback, exposing a token, or auto-navigating", async ({ page }) => {
  const token = "synthetic-reset-token";
  const logs: string[] = [];
  page.on("console", (message) => logs.push(message.text()));
  page.on("pageerror", (error) => logs.push(error.message));
  let calls = 0;
  await page.route("**/api/auth/reset-password", async (route) => {
    calls++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ token, newPassword: "replacement-password" });
    expect(route.request().url()).not.toContain(token);
    expect(route.request().headers().referer ?? "").not.toContain(token);
    await route.fulfill({ json: { status: true } });
  });
  await page.goto(`/reset-password?token=${token}&callbackURL=https://untrusted.example&next=//untrusted.example`);
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
  await fillPasswords(page);
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Your password has been reset");
  await expect(page.getByRole("status")).toBeFocused();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
  expect(logs.join("\n")).not.toContain(token);
  expect(await page.locator("body").innerText()).not.toContain(token);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(token);
  await expect(page.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/sign-in");
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

for (const query of ["", "?token=", "?error=INVALID_TOKEN", "?token=valid&error=INVALID_TOKEN", "?token=one&token=two", "?token=%3Cscript%3E"]) {
  test(`rejects missing, expired or malformed reset link ${query || "(missing)"}`, async ({ page }) => {
    let calls = 0;
    page.on("request", (request) => { if (request.url().includes("/api/auth/reset-password")) calls++; });
    await page.goto(`/reset-password${query}`);
    await expect(page.getByRole("alert")).toContainText("invalid or has expired");
    await expect(page.getByRole("alert")).toBeFocused();
    await expect(page.getByRole("button", { name: "Reset password", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute("href", "/sign-in");
    expect(calls).toBe(0);
  });
}

test("validates password length and confirmation before requesting a reset", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/auth/reset-password", async (route) => { calls++; await route.fulfill({ json: { status: true } }); });
  await page.goto("/reset-password?token=synthetic-reset-token");
  await fillPasswords(page, "short");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Use a password between 8 and 128 characters.");
  await fillPasswords(page, "replacement-password", "different-password");
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Passwords do not match.");
  await expect(page.getByRole("alert")).toBeFocused();
  expect(calls).toBe(0);
});

test("handles a token expiring or being consumed before submission", async ({ page }) => {
  await page.route("**/api/auth/reset-password", (route) => route.fulfill({ status: 400, json: { code: "INVALID_TOKEN", message: "untrusted synthetic-reset-token" } }));
  await page.goto("/reset-password?token=synthetic-reset-token");
  await fillPasswords(page);
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("invalid or has expired");
  await expect(page.locator("body")).not.toContainText("synthetic-reset-token");
  await expect(page.getByRole("link", { name: "Request a new reset link" })).toBeVisible();
});

for (const failure of ["server", "network"]) {
  test(`recovers from ${failure} failure without leaking response details`, async ({ page }) => {
    let calls = 0;
    await page.route("**/api/auth/reset-password", async (route) => {
      calls++;
      if (calls === 1) {
        if (failure === "network") return route.abort("failed");
        return route.fulfill({ status: 500, json: { message: "private synthetic-reset-token" } });
      }
      return route.fulfill({ json: { status: true } });
    });
    await page.goto("/reset-password?token=synthetic-reset-token");
    await fillPasswords(page);
    await page.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Unable to reset your password");
    await expect(page.locator("body")).not.toContainText("synthetic-reset-token");
    await expect(page.getByRole("button", { name: "Reset password", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Your password has been reset");
    expect(calls).toBe(2);
  });
}

test("disables the form during submission and remains usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let release!: () => void;
  const response = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/api/auth/reset-password", async (route) => { calls++; await response; await route.fulfill({ json: { status: true } }); });
  await page.goto("/reset-password?token=synthetic-reset-token");
  await fillPasswords(page);
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: "Resetting password…" })).toBeDisabled();
    await expect(page.getByLabel("New password", { exact: true })).toBeDisabled();
    await expect(page.getByRole("form", { name: "Reset password" })).toHaveAttribute("aria-busy", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(calls).toBe(1);
  } finally { release(); }
  await expect(page.getByRole("status")).toContainText("Your password has been reset");
});

test("forgot-password uses a fixed same-origin callback and recovers after delivery errors", async ({ page, baseURL }) => {
  let calls = 0;
  await page.route("**/api/auth/request-password-reset", async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ email: "reset@example.com", redirectTo: `${baseURL}/reset-password` });
    if (calls === 1) return route.abort("failed");
    return route.fulfill({ json: { status: true } });
  });
  await page.goto("/sign-in?callbackURL=https://untrusted.example");
  await page.getByLabel("Email", { exact: true }).fill("reset@example.com");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to send the reset email");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText("If an account exists for that email, a reset link is on its way.")).toBeVisible();
  expect(calls).toBe(2);
});