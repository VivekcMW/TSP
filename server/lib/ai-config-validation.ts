type AIProvider = "anthropic" | "openrouter" | "gemini" | "openai";
type AIEnvironment = Readonly<Record<string, string | undefined>>;

function parseProvider(value: string): AIProvider | undefined {
  const provider = value.trim().toLowerCase();
  if (provider === "anthropic" || provider === "claude") return "anthropic";
  if (provider === "openrouter" || provider === "gemini" || provider === "openai") return provider;
  return undefined;
}

const credentialNames: Record<AIProvider, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "AI_INTEGRATIONS_GEMINI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
};

// Match aiProviderLimiter.setting bounds. The 30s lease TTL is fixed, not an env setting.
const limiterSettings = [
  ["AI_SHARED_MAX_CONCURRENT_REQUESTS", 1000],
  ["AI_TENANT_REQUEST_BUDGET", 1_000_000],
  ["AI_TENANT_BUDGET_WINDOW_SECONDS", 86400],
] as const;

/** Pure preflight checks: no SDKs, connections, environment reads, or secret values in errors. */
export function validateAIConfig(env: AIEnvironment): string[] {
  const failures: string[] = [];
  // Match openRouter.getProvider, including truthiness BEFORE normalization.
  const primary = parseProvider(env.AI_PROVIDER || ((env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY) ? "anthropic" : "openrouter"));

  function validateCredentials(provider: AIProvider, setting: string) {
    const names = credentialNames[provider];
    // Runtime uses `primaryKey || aliasKey`: a whitespace primary must not be
    // rescued by an alias that the runtime would never actually select.
    const credential = names.map(name => env[name]).find(Boolean);
    if (!credential?.trim()) failures.push(`${setting} (${provider}) requires ${names.join(" or ")}`);
  }

  if (primary) validateCredentials(primary, "AI_PROVIDER");
  else failures.push("AI_PROVIDER must be anthropic (or claude), openrouter, gemini, or openai");

  if (env.AI_FALLBACK_PROVIDER) {
    const fallback = parseProvider(env.AI_FALLBACK_PROVIDER);
    if (!fallback) {
      failures.push("AI_FALLBACK_PROVIDER must be anthropic (or claude), openrouter, gemini, or openai");
    } else {
      if (fallback === primary) failures.push("AI_FALLBACK_PROVIDER must be distinct from AI_PROVIDER (anthropic and claude are aliases)");
      validateCredentials(fallback, "AI_FALLBACK_PROVIDER");
    }
  }

  for (const [name, max] of limiterSettings) {
    const raw = env[name];
    // Empty/unset uses runtime defaults; explicit zero is invalid, even for budget.
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      failures.push(`${name} must be a safe integer between 1 and ${max}`);
    }
  }

  return failures;
}