import { describe, expect, it } from "vitest";
import { getProviderAdapter } from "./adapter";

describe("provider adapter registry", () => {
  it("returns a simulation adapter for linkedin", () => {
    const adapter = getProviderAdapter("linkedin");
    expect(adapter).toBeDefined();
    expect(adapter?.key).toBe("linkedin");
  });

  it("never fabricates a provider receipt", async () => {
    const result = await getProviderAdapter("linkedin").publish("Preview");
    expect(result.status).toBe("simulated");
    expect(result.postId).toBeUndefined();
  });

  it("falls back to a mock adapter for unsupported providers", () => {
    const adapter = getProviderAdapter("not-real-provider");
    expect(adapter).toBeDefined();
    expect(adapter?.key).toBe("not-real-provider");
  });
});
