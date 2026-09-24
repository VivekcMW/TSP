import { describe, expect, it } from "vitest";
import { industryDisplayName } from "./metaEngine";

describe("industry names in customer emails", () => {
  it("uses the catalogue name for known industries and a readable name otherwise", () => {
    expect(industryDisplayName("media_advertising")).toBe("Media & Advertising");
    expect(industryDisplayName("technology_saas")).toBe("Technology & SaaS");
    expect(industryDisplayName("legal_services")).toBe("Legal Services");
    expect(industryDisplayName("  ")).toBeNull();
    expect(industryDisplayName(null)).toBeNull();
  });
});
