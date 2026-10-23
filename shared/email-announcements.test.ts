import { expect, it } from "vitest";
import { announcementSchema } from "./email-announcements";

const content = { type: "product_update", title: "Platform update", body: "A helpful product update.", actionLabel: "Read more", actionUrl: "https://example.invalid/update" };
it.each(["", "not a URL", "http://example.invalid", "https://user:password@example.invalid"])("rejects invalid links without throwing during form validation: %s", actionUrl => {
  expect(announcementSchema.safeParse({ ...content, actionUrl }).success).toBe(false);
});
it("accepts a credential-free HTTPS action", () => {
  expect(announcementSchema.safeParse(content).success).toBe(true);
});
