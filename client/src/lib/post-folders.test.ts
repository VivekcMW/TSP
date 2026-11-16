import { describe, expect, it } from "vitest";
import type { Draft } from "@shared/schema";
import type { PublishingSchedule } from "./publishing";
import { postCounts, postFolderOf, postRows, postsIn } from "./post-folders";

const draft = (id: string, publishStatus: string, updatedAt: string, content = id) =>
  ({ id, publishStatus, updatedAt, createdAt: updatedAt, content, platform: "linkedin" }) as unknown as Draft;
const schedule = (draftId: string, status: string, targets: string[], scheduledPublishAt = "2026-11-20T08:00:00Z"): PublishingSchedule =>
  ({ id: `s-${draftId}`, draftId, status, scheduledPublishAt, targets: targets.map((state, index) => ({ id: `t${index}`, platform: "linkedin", status: state })) });

describe("Post folders", () => {
  it("never files an unconfirmed or failed delivery under Posted", () => {
    expect(postFolderOf(draft("a", "draft", ""))).toBe("drafts");
    expect(postFolderOf(draft("a", "draft", ""), schedule("a", "cancelled", ["cancelled"]))).toBe("drafts");
    expect(postFolderOf(draft("a", "scheduled", ""), schedule("a", "scheduled", ["scheduled"]))).toBe("scheduled");
    expect(postFolderOf(draft("a", "published", ""), schedule("a", "published", ["published"]))).toBe("posted");
    expect(postFolderOf(draft("a", "simulated", ""), schedule("a", "simulated", ["simulated"]))).toBe("posted");
    expect(postFolderOf(draft("a", "failed", ""), schedule("a", "failed", ["failed"]))).toBe("outbox");
    expect(postFolderOf(draft("a", "accepted_unverified", ""), schedule("a", "accepted_unverified", ["accepted_unverified"]))).toBe("outbox");
    expect(postFolderOf(draft("a", "scheduled", ""), schedule("a", "scheduled", ["failed"]))).toBe("outbox");
  });

  it("sorts Scheduled soonest first, others newest first, and searches post text", () => {
    const rows = postRows([
      draft("old", "draft", "2026-11-01T00:00:00Z", "Retail media take"), draft("new", "draft", "2026-11-10T00:00:00Z"),
      draft("late", "scheduled", "2026-11-01T00:00:00Z"), draft("soon", "scheduled", "2026-11-02T00:00:00Z"),
    ], [schedule("late", "scheduled", ["scheduled"], "2026-12-01T08:00:00Z"), schedule("soon", "scheduled", ["queued"], "2026-11-20T08:00:00Z")]);
    expect(postsIn(rows, "drafts").map(row => row.draft.id)).toEqual(["new", "old"]);
    expect(postsIn(rows, "scheduled").map(row => row.draft.id)).toEqual(["soon", "late"]);
    expect(postsIn(rows, "drafts", "  RETAIL ").map(row => row.draft.id)).toEqual(["old"]);
    expect(postCounts(rows)).toEqual({ drafts: 2, scheduled: 2, posted: 0, outbox: 0 });
  });
});
