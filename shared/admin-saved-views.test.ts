import { expect, it } from "vitest";
import { savedViewSchema, savedViewsSchema } from "./admin-saved-views";
it.each(["javascript:alert(1)", "https://evil.invalid/admin/search", "//evil.invalid/admin/search", "/dashboard", "https://[", "/admin/search#fragment"])("rejects unsafe saved destination %s without throwing", href => {
  expect(savedViewSchema.safeParse({ name: "Saved", href }).success).toBe(false);
});
it("allows bounded directory bookmarks but not more than ten", () => {
  const view = { name: "Unknown deliveries", href: "/admin/email-deliveries?status=unknown" };
  expect(savedViewSchema.safeParse(view).success).toBe(true);
  expect(savedViewsSchema.safeParse(Array.from({ length: 11 }, () => view)).success).toBe(false);
});
