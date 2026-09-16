import { describe, expect, it } from "vitest";
import { filterEnabledPlatforms } from "./platformAvailability";

describe("platform availability filtering", () => {
  it("removes globally disabled platforms from a user's saved list", () => {
    const filtered = filterEnabledPlatforms(["linkedin", "twitter", "threads", "reddit"], new Set(["threads", "reddit"]));

    expect(filtered).toEqual(["linkedin", "twitter"]);
  });

  it("keeps a valid selection when no global disables are active", () => {
    const filtered = filterEnabledPlatforms(["linkedin", "bluesky"], new Set());

    expect(filtered).toEqual(["linkedin", "bluesky"]);
  });
});
