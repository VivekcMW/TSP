import { describe, expect, it } from "vitest";
import { getProviderAdapter } from "./adapter";

describe("provider adapter registry", () => {
  it("returns a real adapter for linkedin", () => {
    const adapter = getProviderAdapter("linkedin");
    expect(adapter).toBeDefined();
    expect(adapter?.key).toBe("linkedin");
  });

  it("falls back to a mock adapter for unsupported providers", () => {
    const adapter = getProviderAdapter("not-real-provider");
    expect(adapter).toBeDefined();
    expect(adapter?.key).toBe("not-real-provider");
  });
});
