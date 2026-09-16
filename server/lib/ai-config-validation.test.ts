import { describe, expect, it } from "vitest";
import { validateAIConfig } from "./ai-config-validation";

// Synthetic configuration only: never read real credentials or call providers.
const credentials = {
  ANTHROPIC_API_KEY: "anthropic-unit-test-only",
  OPENROUTER_API_KEY: "router-unit-test-only",
  GEMINI_API_KEY: "gemini-unit-test-only",
};

describe("AI production configuration", () => {
  it.each(["anthropic", "claude", " CLAUDE ", "AnThRoPiC"])("accepts %j with either Claude credential", AI_PROVIDER => {
    for (const key of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]) {
      expect(validateAIConfig({ AI_PROVIDER, [key]: "unit-test-only" })).toEqual([]);
    }
  });

  it.each(["anthropic", "claude"])("does not accept other providers' keys for %s", AI_PROVIDER => {
    expect(validateAIConfig({
      AI_PROVIDER,
      OPENROUTER_API_KEY: credentials.OPENROUTER_API_KEY,
      GEMINI_API_KEY: credentials.GEMINI_API_KEY,
      AI_INTEGRATIONS_GEMINI_API_KEY: "integration-unit-test-only",
    })).toEqual([expect.stringContaining("ANTHROPIC_API_KEY or CLAUDE_API_KEY")]);
  });

  it.each([
    ["openrouter", "OPENROUTER_API_KEY"],
    ["openrouter", "AI_INTEGRATIONS_GEMINI_API_KEY"],
    ["gemini", "GEMINI_API_KEY"],
    ["gemini", "AI_INTEGRATIONS_GEMINI_API_KEY"],
  ])("accepts %s's runtime credential %s", (AI_PROVIDER, key) => {
    expect(validateAIConfig({ AI_PROVIDER, [key]: "unit-test-only" })).toEqual([]);
  });

  it.each(["openrouter", "gemini"])("honors explicit %s instead of inferring Claude", AI_PROVIDER => {
    expect(validateAIConfig({ AI_PROVIDER, ANTHROPIC_API_KEY: credentials.ANTHROPIC_API_KEY })).toEqual([
      expect.stringContaining(`AI_PROVIDER (${AI_PROVIDER}) requires`),
    ]);
  });

  it("infers Claude only from its credentials, otherwise defaults to OpenRouter", () => {
    for (const key of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]) {
      expect(validateAIConfig({ [key]: "unit-test-only" })).toEqual([]);
      expect(validateAIConfig({ AI_PROVIDER: "", [key]: "unit-test-only" })).toEqual([]);
    }
    expect(validateAIConfig({ OPENROUTER_API_KEY: credentials.OPENROUTER_API_KEY })).toEqual([]);
    expect(validateAIConfig({ GEMINI_API_KEY: credentials.GEMINI_API_KEY })).toEqual([
      expect.stringContaining("AI_PROVIDER (openrouter) requires"),
    ]);
    expect(validateAIConfig({})).toEqual([expect.stringContaining("AI_PROVIDER (openrouter) requires")]);
    expect(validateAIConfig({ ANTHROPIC_API_KEY: " ", OPENROUTER_API_KEY: credentials.OPENROUTER_API_KEY })).toEqual([
      expect.stringContaining("AI_PROVIDER (anthropic) requires"),
    ]);
  });

  it.each(["unknown", " ", "constructor", "__proto__"])("rejects unsupported primary %j without echoing its value", AI_PROVIDER => {
    expect(validateAIConfig({ ...credentials, AI_PROVIDER })).toEqual([
      "AI_PROVIDER must be anthropic (or claude), openrouter, or gemini",
    ]);
  });

  it.each(["anthropic", "claude", "openrouter", "gemini"])("checks distinct fallbacks for %s", AI_PROVIDER => {
    for (const AI_FALLBACK_PROVIDER of ["anthropic", "claude", "openrouter", "gemini"]) {
      const same = AI_PROVIDER === AI_FALLBACK_PROVIDER ||
        (["anthropic", "claude"].includes(AI_PROVIDER) && ["anthropic", "claude"].includes(AI_FALLBACK_PROVIDER));
      const failures = validateAIConfig({ ...credentials, AI_PROVIDER, AI_FALLBACK_PROVIDER });
      expect(failures).toEqual(same ? [expect.stringContaining("must be distinct")] : []);
    }
  });

  it("normalizes fallback aliases and compares against the inferred primary", () => {
    expect(validateAIConfig({ ...credentials, AI_FALLBACK_PROVIDER: " CLAUDE " })).toEqual([
      expect.stringContaining("must be distinct"),
    ]);
    expect(validateAIConfig({ OPENROUTER_API_KEY: credentials.OPENROUTER_API_KEY, AI_FALLBACK_PROVIDER: " OpenRouter " })).toEqual([
      expect.stringContaining("must be distinct"),
    ]);
  });

  it.each(["unknown", " ", "constructor"])("rejects unsupported fallback %j", AI_FALLBACK_PROVIDER => {
    expect(validateAIConfig({ ...credentials, AI_FALLBACK_PROVIDER })).toEqual([
      "AI_FALLBACK_PROVIDER must be anthropic (or claude), openrouter, or gemini",
    ]);
  });

  it.each([
    ["anthropic", "openrouter", "ANTHROPIC_API_KEY"],
    ["anthropic", "gemini", "ANTHROPIC_API_KEY"],
    ["gemini", "claude", "GEMINI_API_KEY"],
  ])("requires credentials for %s's %s fallback", (AI_PROVIDER, AI_FALLBACK_PROVIDER, key) => {
    expect(validateAIConfig({ AI_PROVIDER, AI_FALLBACK_PROVIDER, [key]: "unit-test-only" })).toEqual([
      expect.stringContaining("AI_FALLBACK_PROVIDER"),
    ]);
  });

  it("does not let a valid fallback rescue a missing primary credential", () => {
    expect(validateAIConfig({ AI_PROVIDER: "claude", AI_FALLBACK_PROVIDER: "gemini", GEMINI_API_KEY: credentials.GEMINI_API_KEY })).toEqual([
      expect.stringContaining("AI_PROVIDER (anthropic) requires"),
    ]);
    expect(validateAIConfig({ ...credentials, AI_FALLBACK_PROVIDER: "" })).toEqual([]);
  });

  it.each([
    ["anthropic", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    ["openrouter", "OPENROUTER_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY"],
    ["gemini", "GEMINI_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY"],
  ])("matches %s credential precedence and rejects whitespace", (AI_PROVIDER, primaryKey, aliasKey) => {
    expect(validateAIConfig({ AI_PROVIDER, [primaryKey]: " ", [aliasKey]: "unit-test-only" })).toHaveLength(1);
    expect(validateAIConfig({ AI_PROVIDER, [primaryKey]: "", [aliasKey]: "unit-test-only" })).toEqual([]);
    expect(validateAIConfig({ AI_PROVIDER, [primaryKey]: "unit-test-only", [aliasKey]: " " })).toEqual([]);
    expect(validateAIConfig({ AI_PROVIDER, [aliasKey]: "\t" })).toHaveLength(1);
  });

  describe.each([
    ["AI_SHARED_MAX_CONCURRENT_REQUESTS", 1000],
    ["AI_TENANT_REQUEST_BUDGET", 1_000_000],
    ["AI_TENANT_BUDGET_WINDOW_SECONDS", 86400],
  ] as const)("%s", (name, max) => {
    it.each([undefined, "", "1", String(max), " 2 "])("accepts default or valid value %j", value => {
      expect(validateAIConfig({ ...credentials, [name]: value })).toEqual([]);
    });

    it.each(["0", "-1", "1.5", "NaN", "Infinity", " ", "10ms", String(max + 1), "9007199254740992"])("rejects invalid value %j", value => {
      expect(validateAIConfig({ ...credentials, [name]: value })).toEqual([
        `${name} must be a safe integer between 1 and ${max}`,
      ]);
    });
  });

  it("collects independent failures without mutating configuration or exposing values", () => {
    const env = Object.freeze({
      AI_PROVIDER: "private-invalid-provider",
      AI_FALLBACK_PROVIDER: "private-invalid-fallback",
      ANTHROPIC_API_KEY: "private-credential",
      AI_TENANT_REQUEST_BUDGET: "private-invalid-budget",
      AI_SHARED_MAX_CONCURRENT_REQUESTS: "0",
      AI_TENANT_BUDGET_WINDOW_SECONDS: "0",
    });
    const failures = validateAIConfig(env);
    expect(failures).toHaveLength(5);
    expect(failures.join(" ")).not.toContain("private-");
  });
});