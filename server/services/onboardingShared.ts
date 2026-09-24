import { z } from "zod";
import { redis } from "../lib/redis";
import { AIGenerationError, generateText } from "./openRouter";

/** Helpers shared by the onboarding understanding, suggestion and agent services. */
export const key = (value: string) => value.trim().toLowerCase();
export const short = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 80);

export async function askJson<S extends z.ZodTypeAny>(prompt: string, schema: S, scope: { tenantId: string }, signal?: AbortSignal): Promise<z.infer<S>> {
  const text = await generateText(prompt, { scope, signal, timeoutMs: 12_000, maxTokens: 1500 });
  const unfenced = /^```(?:json)?[ \t]*\n([\s\S]*?)\n?```$/.exec(text.trim())?.[1] ?? text;
  let output: unknown;
  try { output = JSON.parse(unfenced); } catch { throw new AIGenerationError("ai_invalid_output"); }
  const parsed = schema.safeParse(output);
  if (!parsed.success) throw new AIGenerationError("ai_invalid_output");
  return parsed.data;
}

/** A model-written list: keep each valid entry, so one malformed entry can't discard the rest. */
export const tolerantList = <S extends z.ZodTypeAny>(item: S, max: number) => z.array(z.unknown()).default([])
  .transform(entries => entries.flatMap(entry => { const parsed = item.safeParse(entry); return parsed.success ? [parsed.data as z.infer<S>] : []; }).slice(0, max));
export const reasonText = z.string().max(200).optional();

const CACHE_SECONDS = 6 * 3600;
const memoryCache = new Map<string, { expires: number; value: unknown }>();
export function clearOnboardingCache() { memoryCache.clear(); }

/** Best-effort cache in Redis when configured, else in memory. */
export async function cachedJson<T>(cacheKey: string): Promise<T | undefined> {
  if (redis) {
    try { const hit = await redis.get(cacheKey); if (hit) return JSON.parse(hit) as T; } catch { /* cache is best-effort */ }
    return undefined;
  }
  const hit = memoryCache.get(cacheKey);
  return hit && hit.expires > Date.now() ? hit.value as T : undefined;
}
export async function rememberJson(cacheKey: string, value: unknown) {
  if (redis) { try { await redis.set(cacheKey, JSON.stringify(value), "EX", CACHE_SECONDS); } catch { /* best-effort */ } return; }
  if (memoryCache.size >= 300) memoryCache.delete(memoryCache.keys().next().value!);
  memoryCache.set(cacheKey, { expires: Date.now() + CACHE_SECONDS * 1000, value });
}
