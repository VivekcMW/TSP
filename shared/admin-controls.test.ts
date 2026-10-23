import { expect, it } from "vitest";
import { quotaGrantSchema, validControlExpiry, flagPolicySchema } from "./admin-controls";
const now = Date.parse("2026-10-23T00:00:00Z");
it("enforces future and maximum expiry boundaries exactly", () => {
  expect(validControlExpiry(new Date(now).toISOString(), now)).toBe(false);
  expect(validControlExpiry(new Date(now + 30 * 86_400_000).toISOString(), now)).toBe(true);
  expect(validControlExpiry(new Date(now + 30 * 86_400_000 + 1).toISOString(), now)).toBe(false);
  expect(validControlExpiry("not a date", now)).toBe(false);
});
it("rejects plan changes and unbounded grants", () => {
  const base = { operationId: "31e43402-9b9c-4592-8c46-7f1d6ef7a7d0", additional: 1, expiresAt: "2026-10-24T00:00:00Z" };
  expect(quotaGrantSchema.safeParse(base).success).toBe(true);
  for (const additional of [0, -1, 1001, 1.5]) expect(quotaGrantSchema.safeParse({ ...base, additional }).success).toBe(false);
  expect(quotaGrantSchema.safeParse({ ...base, plan: "pro" }).success).toBe(false);
});
it("requires valid ownership and unique bounded tenant UUID targets", () => {
  const base = { owner: "hello@thesocialpundit.com", expiresAt: "2026-10-24T00:00:00Z", tenantIds: [], revision: 1 };
  expect(flagPolicySchema.safeParse(base).success).toBe(true);
  expect(flagPolicySchema.safeParse({ ...base, owner: "" }).success).toBe(false);
  expect(flagPolicySchema.safeParse({ ...base, tenantIds: ["invalid"] }).success).toBe(false);
  expect(flagPolicySchema.safeParse({ ...base, tenantIds: [ "31e43402-9b9c-4592-8c46-7f1d6ef7a7d0", "31e43402-9b9c-4592-8c46-7f1d6ef7a7d0" ] }).success).toBe(false);
});
