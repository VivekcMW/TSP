import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: undefined }));
vi.mock("./openRouter", async importOriginal => ({ ...await importOriginal<typeof import("./openRouter")>(), generateText }));

import { analyzeProfessionalIdentity } from "./punditBrain";
import { AIGenerationError } from "./openRouter";

beforeEach(() => { generateText.mockReset(); });

describe("professional identity analysis", () => {
  it.each(['{"primaryIndustry":"Technology & SaaS", broken', '{}', 'null', '[]', 'not JSON'])("rejects malformed or incomplete output without curated content or repair calls: %s", async text => {
    generateText.mockResolvedValue(text);

    const scope = { tenantId: "identity-tenant" };
    await expect(analyzeProfessionalIdentity("I build SaaS products and lead technical teams.", "technology_saas", scope))
      .rejects.toMatchObject({ code: "ai_invalid_output" });

    // A complete answer measured ~3,200 tokens on gpt-4o-mini; the 2,048 default truncated it.
    expect(generateText).toHaveBeenCalledWith(expect.any(String), { scope, timeoutMs: 45_000, maxTokens: 8192 });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it.each(["ai_budget", "ai_quota", "ai_configuration", "ai_timeout", "ai_unavailable", "ai_refusal", "ai_invalid_output"] as const)("propagates %s unchanged without another generation call", async code => {
    const failure = new AIGenerationError(code, 60);
    generateText.mockRejectedValue(failure);
    await expect(analyzeProfessionalIdentity("I build SaaS products and lead technical teams.", "technology_saas", { tenantId: "identity-tenant" }))
      .rejects.toBe(failure);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
