import { expect, it } from "vitest";
import { effectivePlatformRole, isAdminIdentity } from "./admin-access";

it.each(["hello@thesocialpundit.com", "marketing@thesocialpundit.com", " HELLO@THESOCIALPUNDIT.COM "])("allows verified exact approved identity %s", email => {
  expect(effectivePlatformRole({ email, emailVerified: true, platformRole: "platform_admin" })).toBe("platform_admin");
});
it.each(["dev@example.com", "hello+admin@thesocialpundit.com", "hello@thesocialpundit.com.evil.test", "other@thesocialpundit.com"])("rejects %s despite stored privilege", email => {
  expect(effectivePlatformRole({ email, emailVerified: true, platformRole: "platform_admin" })).toBeNull();
});
it("requires both verified ownership and a provisioned role, never self-promotes allowed signups", () => {
  expect(effectivePlatformRole({ email: "hello@thesocialpundit.com", emailVerified: false, platformRole: "platform_admin" })).toBeNull();
  expect(effectivePlatformRole({ email: "hello@thesocialpundit.com", emailVerified: true })).toBeNull();
  expect(effectivePlatformRole(null)).toBeNull();
  expect(isAdminIdentity(undefined)).toBe(false);
});
