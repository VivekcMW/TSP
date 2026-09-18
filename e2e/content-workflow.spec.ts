import { expect, test } from "@playwright/test";

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;
const blueskyHandle = process.env.E2E_BLUESKY_HANDLE;
const blueskyAppPassword = process.env.E2E_BLUESKY_APP_PASSWORD;
const createdDraftIds: string[] = [];
const createdMediaIds: string[] = [];

test.skip(!email || !password, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run authenticated browser tests.");

test.afterEach(async ({ page }) => {
  await Promise.all(createdDraftIds.map(async (id) => {
    await page.request.delete(`/api/drafts/${id}/schedule`);
    await page.request.delete(`/api/drafts/${id}`);
  }));
  await Promise.all(createdMediaIds.map((id) => page.request.delete(`/api/media/${id}`)));
  createdDraftIds.length = 0;
  createdMediaIds.length = 0;
});

test("sign in, create a draft, bulk schedule it, and drag-reschedule it", async ({ page }) => {
  test.skip(!blueskyHandle || !blueskyAppPassword, "Set E2E_BLUESKY_HANDLE and E2E_BLUESKY_APP_PASSWORD (a real Bluesky handle + App Password) to test bulk scheduling — it requires a connected platform.");

  await page.goto("/sign-in");
  const fields = page.locator("input");
  await fields.nth(0).fill(email!);
  await fields.nth(1).fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const connect = await page.evaluate(async ({ handle, appPassword }) => {
    const response = await fetch("/api/integrations/bluesky/app-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, appPassword }) });
    return { status: response.status, body: await response.json() };
  }, { handle: blueskyHandle, appPassword: blueskyAppPassword });
  expect(connect.status).toBe(200);

  const content = `E2E scheduling test ${Date.now()}`;
  const draft = await page.evaluate(async ({ content }) => {
    const response = await fetch("/api/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "bluesky", tone: "professional", content }) });
    return { status: response.status, body: await response.json() };
  }, { content });
  expect(draft.status).toBe(200);
  createdDraftIds.push(draft.body.id);

  await page.goto("/dashboard/drafts");
  await page.getByRole("checkbox", { name: "Select Bluesky draft" }).first().click();
  await page.getByRole("button", { name: /Schedule 1 selected/ }).click();
  const scheduleDate = new Date();
  scheduleDate.setDate(scheduleDate.getDate() + 2);
  const movedDate = new Date(scheduleDate);
  movedDate.setDate(movedDate.getDate() + 1);
  const dateKey = scheduleDate.toISOString().slice(0, 10);
  const movedDateKey = movedDate.toISOString().slice(0, 10);
  await page.locator("#bulk-schedule-date").fill(dateKey);
  await page.locator("#bulk-schedule-time").fill("10:45");
  await page.getByRole("button", { name: "Schedule 1 drafts" }).click();
  await expect(page.getByText("Bulk Schedule Complete", { exact: true })).toBeVisible();

  await page.goto("/dashboard/calendar");
  await expect(page.getByRole("heading", { name: "Publishing Calendar" })).toBeVisible();
  const beforeMove = await page.evaluate(async (draftId) => fetch("/api/drafts/scheduled?limit=100").then((response) => response.json()).then((data) => data.items.find((item: { draftId: string }) => item.draftId === draftId)?.scheduledPublishAt), draft.body.id);
  const postCard = page.getByText(content).locator("..");
  await postCard.dispatchEvent("dragstart");
  await page.locator(`[data-calendar-day="${movedDateKey}"]`).dispatchEvent("drop");
  await postCard.dispatchEvent("dragend");
  const scheduled = await page.evaluate(async (draftId) => fetch("/api/drafts/scheduled?limit=100").then((response) => response.json()).then((data) => data.items.find((item: { draftId: string }) => item.draftId === draftId)), draft.body.id);
  expect(scheduled.scheduledPublishAt).not.toBe(beforeMove);
  expect(scheduled.scheduledPublishAt).toMatch(/T10:45:00\.000Z$/);
});

test("uploads media and retains it on a draft", async ({ page }) => {
  await page.goto("/sign-in");
  const fields = page.locator("input");
  await fields.nth(0).fill(email!);
  await fields.nth(1).fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const result = await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9pAAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("files", new File([bytes], "e2e.png", { type: "image/png" }));
    const upload = await fetch("/api/media/upload", { method: "POST", body: form });
    const uploadBody = await upload.json();
    const asset = uploadBody.assets?.[0];
    const draft = await fetch("/api/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "bluesky", tone: "professional", content: `E2E media draft ${Date.now()}`, media: [asset] }) });
    return { uploadStatus: upload.status, asset, draftStatus: draft.status, draft: await draft.json() };
  });

  expect(result.uploadStatus).toBe(201);
  expect(result.draftStatus).toBe(200);
  expect(result.draft.media).toEqual([expect.objectContaining({ id: result.asset.id, type: "image" })]);
  createdDraftIds.push(result.draft.id);
  createdMediaIds.push(result.asset.id);
});

test("tracks a draft through scheduling, observability, and cancellation", async ({ page }) => {
  await page.goto("/sign-in");
  const fields = page.locator("input");
  await fields.nth(0).fill(email!);
  await fields.nth(1).fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const content = `E2E publish lifecycle test ${Date.now()}`;
  const draft = await page.evaluate(async ({ content }) => {
    const response = await fetch("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "bluesky", tone: "professional", content }),
    });
    return { status: response.status, body: await response.json() };
  }, { content });

  expect(draft.status).toBe(200);
  expect(draft.body.publishStatus).toBe("draft");
  createdDraftIds.push(draft.body.id);

  const publishAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const scheduled = await page.evaluate(async ({ draftId, publishAt }) => {
    const response = await fetch(`/api/drafts/${draftId}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishAt }),
    });
    return { status: response.status, body: await response.json() };
  }, { draftId: draft.body.id, publishAt });

  expect(scheduled.status).toBe(200);
  expect(scheduled.body.status).toBe("scheduled");

  const [drafts, logs, overview] = await Promise.all([
    page.request.get("/api/drafts"),
    page.request.get(`/api/drafts/${draft.body.id}/publish-logs`),
    page.request.get("/api/jobs/overview"),
  ]);
  expect(drafts.ok()).toBe(true);
  expect((await drafts.json()).find((item: { id: string }) => item.id === draft.body.id).publishStatus).toBe("scheduled");
  expect(logs.ok()).toBe(true);
  expect(await logs.json()).toEqual([]);
  expect(overview.ok()).toBe(true);
  expect(await overview.json()).toEqual(expect.objectContaining({
    scheduled: expect.any(Number),
    publishing: expect.any(Number),
    failed: expect.any(Number),
    overdue: expect.any(Number),
    recentFailures: expect.any(Array),
  }));

  const cancelled = await page.request.delete(`/api/drafts/${draft.body.id}/schedule`);
  expect(cancelled.ok()).toBe(true);

  const afterCancel = await page.request.get("/api/drafts");
  expect(afterCancel.ok()).toBe(true);
  expect((await afterCancel.json()).find((item: { id: string }) => item.id === draft.body.id).publishStatus).toBe("draft");
});
