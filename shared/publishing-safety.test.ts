import { describe, expect, it } from "vitest";
import { DIRECT_PUBLISH_PLATFORMS, PUBLISHING_PLATFORM_KEYS, publishingCapability } from "./publishing-capabilities";
import { reconciliationSchema } from "./publishing-reconciliation";
import { aggregateScheduleStatus } from "../server/jobs/schedule-state";

describe("publishing capability and reconciliation contract", () => {
  it("exposes only the ten implemented direct adapters", () => {
    expect(DIRECT_PUBLISH_PLATFORMS).toHaveLength(10);
    expect(DIRECT_PUBLISH_PLATFORMS).toContain("slack");
    expect(DIRECT_PUBLISH_PLATFORMS).toContain("reddit");
    expect(new Set(PUBLISHING_PLATFORM_KEYS).size).toBe(PUBLISHING_PLATFORM_KEYS.length);
    expect(publishingCapability("toString")).toBeUndefined();
    expect(publishingCapability("threads")?.live).toBe(false);
  });
  it("does not claim Reddit media or Slack delivery receipts", () => {
    expect(publishingCapability("reddit")).toMatchObject({ maxMedia: 0, mediaTypes: [] });
    expect(publishingCapability("slack")).toMatchObject({ receipt: "unavailable", maxMedia: 0, verifyDelivery: false });
  });
  it.each(["simulated", "accepted_unverified", "manual_published", "unknown"])("never aggregates %s as live published", status => {
    expect(aggregateScheduleStatus([status])).toBe(status);
    expect(aggregateScheduleStatus(["published", status])).not.toBe("published");
  });
  const base = { expectedRevision: 1, decision: "unresolved", note: "Checked provider and worker", workerStopped: false };
  it("requires receipt evidence for manual delivery", () => {
    expect(reconciliationSchema.safeParse({ ...base, decision: "delivered" }).success).toBe(false);
    expect(reconciliationSchema.safeParse({ ...base, decision: "delivered", receipt: "provider-post-123" }).success).toBe(true);
  });
  it("requires stopped-worker declaration for replay clearance", () => {
    expect(reconciliationSchema.safeParse({ ...base, decision: "not_delivered" }).success).toBe(false);
    expect(reconciliationSchema.safeParse({ ...base, decision: "not_delivered", workerStopped: true }).success).toBe(true);
  });
  it("rejects forged verification fields and invalid revisions", () => {
    expect(reconciliationSchema.safeParse({ ...base, providerVerified: true }).success).toBe(false);
    expect(reconciliationSchema.safeParse({ ...base, expectedRevision: -1 }).success).toBe(false);
    expect(reconciliationSchema.safeParse({ ...base, note: "short" }).success).toBe(false);
  });
});