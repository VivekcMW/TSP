import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { aiAttemptObservations } from "@shared/schema";

const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export async function recordAIAttempt(input: { tenantId: string; provider: string; model?: string; outcome: "succeeded" | "failed";
  inputTokens: unknown; outputTokens: unknown; providerCostUsd?: number | null; durationMs: number }) {
  const model = typeof input.model === "string" && /^[a-zA-Z0-9._:/-]{1,120}$/.test(input.model)
    && !input.model.includes("://") && !/^(sk-|AIza|Bearer)/i.test(input.model) ? input.model : null;
  const cost = typeof input.providerCostUsd === "number" && Number.isFinite(input.providerCostUsd)
    && input.providerCostUsd >= 0 && input.providerCostUsd < 1e10 ? input.providerCostUsd.toFixed(10) : null;
  await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${input.tenantId}, true)`);
    await tx.execute(sql`select set_config('statement_timeout', '1000', true)`);
    await tx.insert(aiAttemptObservations).values({ id: randomUUID(), tenantId: input.tenantId, provider: input.provider,
      model, outcome: input.outcome, inputTokens: count(input.inputTokens), outputTokens: count(input.outputTokens),
      providerCostUsd: cost, durationMs: Math.min(2_147_483_647, Math.max(0, Math.floor(input.durationMs))) });
  });
}
