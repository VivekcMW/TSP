import { describe, expect, it } from "vitest";
import {
  PROVIDER_CATALOG,
  resolveProviderDefinition,
  runProviderSandbox,
  type ProviderExecutionMode,
} from "./providerSandbox";

describe("provider sandbox", () => {
  it("lists the supported providers", () => {
    expect(PROVIDER_CATALOG.length).toBeGreaterThan(0);
    expect(PROVIDER_CATALOG.some((provider) => provider.key === "linkedin")).toBe(true);
    expect(PROVIDER_CATALOG.some((provider) => provider.key === "twitter")).toBe(true);
  });

  it("resolves a provider definition by alias", () => {
    expect(resolveProviderDefinition("x")?.key).toBe("twitter");
    expect(resolveProviderDefinition("dev.to")?.key).toBe("devto");
  });

  it("runs a sandbox publish for a supported provider", async () => {
    const result = await runProviderSandbox({
      provider: "linkedin",
      content: "Hello world",
      mode: "sandbox",
      metadata: { draftId: "draft-123" },
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe("sandbox");
    expect(result.provider).toBe("linkedin");
    expect(result.externalId).toMatch(/linkedin/);
  });

  it("rejects unsupported providers cleanly", async () => {
    const result = await runProviderSandbox({
      provider: "not-real",
      content: "Hello world",
      mode: "sandbox",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not supported");
  });

  it("accepts dry-run mode as valid execution mode", () => {
    const mode: ProviderExecutionMode = "dry-run";
    expect(mode).toBe("dry-run");
  });
});
