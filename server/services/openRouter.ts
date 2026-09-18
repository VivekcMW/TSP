import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { acquireAILease, AIProviderLimitError, type AILease } from "./aiProviderLimiter";
import { logAIInvalidOutputDiagnostic, type AIDiagnosticInput } from "./aiDiagnostics";

const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o";
// Pinned, stable snapshot verified against official model docs on 2026-09-16:
// https://platform.claude.com/docs/en/models/sonnet-5/overview
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export type AIProvider = "openrouter" | "gemini" | "anthropic" | "openai";

export const AI_REQUEST_TIMEOUT_MS = 20_000;
export const AI_MAX_CONCURRENT_REQUESTS = 4;

const FAILURE_DETAILS = {
  ai_configuration: { status: 503, message: "AI generation is not configured correctly. Ask an administrator to check the provider credentials and model." },
  ai_quota: { status: 503, message: "AI provider quota or credits are exhausted. Wait before trying again, or ask an administrator to check provider billing and limits." },
  ai_unavailable: { status: 503, message: "The AI provider is temporarily unavailable. Please try again later." },
  ai_busy: { status: 503, message: "AI generation is busy. Please try again shortly." },
  ai_timeout: { status: 504, message: "AI generation timed out. Please try again later." },
  ai_cancelled: { status: 503, message: "AI generation was cancelled. No posts were returned." },
  ai_invalid_output: { status: 502, message: "The AI provider did not return a usable post. Check the article content and try again." },
  ai_invalid_input: { status: 400, message: "Provide a supported platform, tone, source, and non-empty article content within the allowed limits." },
  ai_rate_limit: { status: 503, message: "The AI provider is rate limited. Please wait before trying again." },
  ai_refusal: { status: 422, message: "The AI provider declined this request. No posts were returned." },
  ai_budget: { status: 429, message: "The AI generation budget for this workspace has been reached. Please try again after the budget resets." },
} as const;

export class AIGenerationError extends Error {
  constructor(public readonly code: keyof typeof FAILURE_DETAILS, public readonly retryAfterSeconds?: number) {
    super(FAILURE_DETAILS[code].message);
    this.name = "AIGenerationError";
  }
}

/** Only allowlisted messages/statuses may cross the API boundary; never SDK bodies. */
export function getAIErrorResponse(error: unknown) {
  if (error instanceof AIGenerationError) {
    const detail = FAILURE_DETAILS[error.code];
    return { status: detail.status, body: { code: error.code, message: detail.message }, retryAfterSeconds: error.retryAfterSeconds };
  }
  return { status: 500, body: { code: "ai_generation_failed", message: "AI generation failed. Please try again later." }, retryAfterSeconds: undefined };
}

export interface GenerationOptions {
  systemPrompt?: string;
  /** Used by legacy providers only; Sonnet 5 rejects non-default sampling. */
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Trusted server scope, never a client-supplied tenant identifier. */
  scope?: { tenantId: string };
}

export interface GenerationResult {
  text: string;
  provider: AIProvider;
  model: string;
  /** Successful attempt only; null means the provider did not report usage. */
  usage: { inputTokens: number | null; outputTokens: number | null };
  fallbackUsed: boolean;
}

type ProviderResult = Omit<GenerationResult, "provider" | "fallbackUsed">;
const tokenCount = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

let activeRequests = 0;
// Bounded per-process circuit breaker, in addition to the shared admission lease.
const cooldowns = new Map<AIProvider, { until: number; code: "ai_configuration" | "ai_quota" | "ai_rate_limit" }>();

function providerFailure(status: unknown, retryAfter?: string | null): AIGenerationError {
  if (status === 429 || status === 402) {
    let seconds = 60;
    if (retryAfter) seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1000;
    return new AIGenerationError("ai_quota", Math.max(60, Math.min(3600, Math.ceil(seconds) || 60)));
  }
  if (status === 400 || status === 413 || status === 422) return new AIGenerationError("ai_invalid_input");
  if (status === 401 || status === 403 || status === 404) return new AIGenerationError("ai_configuration", 60);
  if (status === 408 || status === 504) return new AIGenerationError("ai_timeout");
  return new AIGenerationError("ai_unavailable");
}

function normalizeFailure(error: unknown, signal: AbortSignal): AIGenerationError {
  if (signal.aborted) return cancellationFailure(signal);
  if (error instanceof AIGenerationError) return error;
  if (error instanceof AIProviderLimitError) return new AIGenerationError(error.code, error.retryAfterSeconds);
  if (error instanceof SyntaxError) return new AIGenerationError("ai_invalid_output");
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  return providerFailure(status);
}

function cancellationFailure(signal?: AbortSignal): AIGenerationError {
  if (signal?.reason instanceof AIGenerationError) return signal.reason;
  return new AIGenerationError("ai_cancelled");
}

function parseProvider(value: string): AIProvider {
  const provider = value.trim().toLowerCase();
  if (provider === "anthropic" || provider === "claude") return "anthropic";
  if (provider !== "gemini" && provider !== "openrouter" && provider !== "openai") throw new AIGenerationError("ai_configuration");
  return provider;
}

function getProvider(): AIProvider {
  return parseProvider(process.env.AI_PROVIDER || ((process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) ? "anthropic" : "openrouter"));
}

/** Non-secret generation identity for cache invalidation; no credentials or URLs. */
export function getEditorialModelIdentity() {
  return {
    provider: getProvider(),
    fallback: process.env.AI_FALLBACK_PROVIDER ? parseProvider(process.env.AI_FALLBACK_PROVIDER) : null,
    models: {
      anthropic: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
      gemini: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      openrouter: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      openai: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    },
  };
}

function anthropicFailure(error: unknown): AIGenerationError {
  if (error instanceof AIGenerationError) return error;
  if (error instanceof SyntaxError) return new AIGenerationError("ai_invalid_output");
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AIGenerationError("ai_timeout");
  if (error instanceof Anthropic.APIUserAbortError) return new AIGenerationError("ai_cancelled");
  if (!(error instanceof Anthropic.APIError)) return new AIGenerationError("ai_unavailable");
  // Inspect only a documented machine code, never log/return SDK bodies/messages.
  const body = error.error as { error?: { details?: { error_code?: string } } } | undefined;
  if (body?.error?.details?.error_code === "enforced_spend_limit_reached") return new AIGenerationError("ai_quota", 3600);
  if (error.status === 400 || error.status === 413 || error.status === 422) return new AIGenerationError("ai_invalid_input");
  if (error.status === 429) {
    const header = error.headers?.get("retry-after")?.trim();
    let seconds = 60;
    if (header) seconds = /^\d+(\.\d+)?$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
    return new AIGenerationError("ai_rate_limit", Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 60);
  }
  return providerFailure(error.status, error.headers?.get("retry-after"));
}

async function generateWithAnthropic(prompt: string, options: GenerationOptions, diagnostic: AIDiagnosticInput): Promise<ProviderResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new AIGenerationError("ai_configuration");
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  diagnostic.model = model;
  try {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: AI_REQUEST_TIMEOUT_MS, logLevel: "off", baseURL: "https://api.anthropic.com", fetchOptions: { redirect: "error" } });
    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 2048,
      ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
      // Sonnet 5 defaults to adaptive thinking; reserve this budget for visible text.
      // https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5
      thinking: { type: "disabled" },
    }, { signal: options.signal });
    diagnostic.model = response.model || model;
    diagnostic.finishReason = response.stop_reason;
    diagnostic.inputTokens = tokenCount(response.usage?.input_tokens) === null ? null : response.usage.input_tokens + (tokenCount(response.usage.cache_creation_input_tokens) ?? 0) + (tokenCount(response.usage.cache_read_input_tokens) ?? 0);
    diagnostic.outputTokens = response.usage?.output_tokens;
    diagnostic.visibleTextLength = Array.isArray(response.content) ? response.content.reduce((length, block) => length + (block?.type === "text" && typeof block.text === "string" ? block.text.length : 0), 0) : null;
    const details = response as typeof response & { stop_details?: { type?: string } | null };
    if (response.stop_reason === "refusal" || details.stop_details?.type === "refusal") throw new AIGenerationError("ai_refusal");
    if (response.stop_reason === "model_context_window_exceeded") throw new AIGenerationError("ai_invalid_input");
    // Never return truncated text, tool requests, or a partial/pause turn as a post.
    diagnostic.stage = "provider_finish_reason";
    if (response.stop_reason !== "end_turn") throw new AIGenerationError("ai_invalid_output");
    diagnostic.stage = "provider_content_shape";
    if (!Array.isArray(response.content) || response.content.some(block => !block || (block.type === "text" && typeof block.text !== "string"))) throw new AIGenerationError("ai_invalid_output");
    return {
      text: response.content.filter(block => block.type === "text").map(block => block.text).join("").trim(),
      model: response.model || model,
      usage: {
        inputTokens: tokenCount(response.usage?.input_tokens) === null ? null : response.usage.input_tokens + (tokenCount(response.usage.cache_creation_input_tokens) ?? 0) + (tokenCount(response.usage.cache_read_input_tokens) ?? 0),
        outputTokens: tokenCount(response.usage?.output_tokens),
      },
    };
  } catch (error) {
    throw anthropicFailure(error);
  }
}

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = (process.env.OPENROUTER_BASE_URL || process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;

  if (!apiKey) {
    throw new AIGenerationError("ai_configuration");
  }

  return { apiKey, baseUrl, model };
}

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  if (!apiKey) {
    throw new AIGenerationError("ai_configuration");
  }

  return { apiKey, model };
}

function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

  if (!apiKey) {
    throw new AIGenerationError("ai_configuration");
  }

  return { apiKey, model };
}

/** Shared by OpenRouter and direct OpenAI: both speak the same chat-completions protocol. */
async function generateChatCompletion(
  config: { apiKey: string; baseUrl: string; model: string; extraHeaders?: Record<string, string> },
  prompt: string,
  options: GenerationOptions,
  diagnostic: AIDiagnosticInput,
): Promise<ProviderResult> {
  const { apiKey, baseUrl, model, extraHeaders } = config;
  diagnostic.model = model;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
        { role: "user", content: prompt },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    }),
  });

  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw providerFailure(response.status, response.headers.get("retry-after"));
  }

  const json = await response.json() as {
    error?: { code?: number };
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: Array<{
      finish_reason?: string;
      message?: {
        refusal?: string;
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };

  if (json?.error) throw providerFailure(json.error.code);
  const choice = json?.choices?.[0];
  diagnostic.model = json?.model || model;
  diagnostic.finishReason = choice?.finish_reason;
  diagnostic.inputTokens = json?.usage?.prompt_tokens;
  diagnostic.outputTokens = json?.usage?.completion_tokens;
  const visibleContent = choice?.message?.content;
  diagnostic.visibleTextLength = 0;
  if (typeof visibleContent === "string") diagnostic.visibleTextLength = visibleContent.length;
  else if (Array.isArray(visibleContent)) diagnostic.visibleTextLength = visibleContent.reduce((length, part) => length + ((!part?.type || part.type === "text") && typeof part?.text === "string" ? part.text.length : 0), 0);
  if (choice?.finish_reason === "content_filter" || choice?.message?.refusal) throw new AIGenerationError("ai_refusal");
  diagnostic.stage = "provider_finish_reason";
  if (choice?.finish_reason && choice.finish_reason !== "stop") throw new AIGenerationError("ai_invalid_output");
  const content = choice?.message?.content;

  let text = "";
  if (typeof content === "string") text = content.trim();
  else if (Array.isArray(content)) text = content.filter(part => !part?.type || part.type === "text").map(part => part?.text || "").join("").trim();
  return { text, model: json.model || model, usage: { inputTokens: tokenCount(json.usage?.prompt_tokens), outputTokens: tokenCount(json.usage?.completion_tokens) } };
}

async function generateWithOpenRouter(prompt: string, options: GenerationOptions, diagnostic: AIDiagnosticInput): Promise<ProviderResult> {
  const { apiKey, baseUrl, model } = getOpenRouterConfig();
  return generateChatCompletion(
    { apiKey, baseUrl, model, extraHeaders: { "HTTP-Referer": process.env.APP_URL || "http://localhost:4300", "X-Title": "TheSocialPundit" } },
    prompt, options, diagnostic,
  );
}

async function generateWithOpenAI(prompt: string, options: GenerationOptions, diagnostic: AIDiagnosticInput): Promise<ProviderResult> {
  const { apiKey, model } = getOpenAIConfig();
  return generateChatCompletion({ apiKey, baseUrl: "https://api.openai.com/v1", model }, prompt, options, diagnostic);
}

async function generateWithGemini(prompt: string, options: GenerationOptions, diagnostic: AIDiagnosticInput): Promise<ProviderResult> {
  const { apiKey, model } = getGeminiConfig();
  diagnostic.model = model;
  // No retryOptions: the SDK's default unary path makes exactly one fetch and
  // preserves ApiError.status. Its opt-in retry wrapper discards that status.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: AI_REQUEST_TIMEOUT_MS } });

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction: options.systemPrompt,
      abortSignal: options.signal,
      temperature: options.temperature ?? 0.7,
      // Newer Gemini models spend part of this budget on internal reasoning
      // before the visible output, which can truncate short JSON responses
      // at the old 1024 default -- give more headroom.
      maxOutputTokens: options.maxTokens ?? 2048,
      // Mirrors the Anthropic adapter's thinking:disabled above: reserve the
      // full budget for visible text instead of internal reasoning tokens.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const candidate = response.candidates?.[0];
  diagnostic.model = response.modelVersion || model;
  diagnostic.finishReason = candidate?.finishReason;
  diagnostic.inputTokens = response.usageMetadata?.promptTokenCount;
  diagnostic.outputTokens = response.usageMetadata?.candidatesTokenCount;
  diagnostic.visibleTextLength = Array.isArray(candidate?.content?.parts) ? candidate.content.parts.reduce((length, part) => length + (!part?.thought && typeof part?.text === "string" ? part.text.length : 0), 0) : 0;
  if (response.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(candidate?.finishReason ?? "")) throw new AIGenerationError("ai_refusal");
  diagnostic.stage = "provider_finish_reason";
  if (candidate?.finishReason && candidate.finishReason !== "STOP") throw new AIGenerationError("ai_invalid_output");
  const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || "").join("") || "";
  return { text: text.trim(), model: response.modelVersion || model, usage: { inputTokens: tokenCount(response.usageMetadata?.promptTokenCount), outputTokens: tokenCount(response.usageMetadata?.candidatesTokenCount) } };
}

async function attempt(provider: AIProvider, prompt: string, options: GenerationOptions): Promise<ProviderResult> {
  const signal = options.signal!;
  if (signal.aborted) throw cancellationFailure(signal);
  const cooldown = cooldowns.get(provider);
  if (cooldown && cooldown.until > Date.now()) {
    throw new AIGenerationError(cooldown.code, Math.ceil((cooldown.until - Date.now()) / 1000));
  }
  const diagnostic: AIDiagnosticInput = { provider, stage: "provider_response_json", maxTokens: options.maxTokens ?? 2048 };
  try {
    const adapter = { anthropic: generateWithAnthropic, gemini: generateWithGemini, openrouter: generateWithOpenRouter, openai: generateWithOpenAI }[provider];
    const result = await adapter(prompt, options, diagnostic);
    if (signal.aborted) throw cancellationFailure(signal);
    diagnostic.stage = "provider_empty_text";
    if (!result.text.trim()) throw new AIGenerationError("ai_invalid_output");
    return result;
  } catch (error) {
    const failure = normalizeFailure(error, signal);
    if (failure.code === "ai_invalid_output" && !signal.aborted) logAIInvalidOutputDiagnostic(diagnostic);
    if (failure.code === "ai_quota" || failure.code === "ai_configuration" || failure.code === "ai_rate_limit") {
      cooldowns.set(provider, { code: failure.code, until: Date.now() + (failure.retryAfterSeconds ?? 60) * 1000 });
    }
    throw failure;
  }
}

export async function generateTextWithMetadata(prompt: string, options: GenerationOptions = {}): Promise<GenerationResult> {
  if (options.signal?.aborted) throw cancellationFailure(options.signal);
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 200_000 ||
    (options.systemPrompt !== undefined && (typeof options.systemPrompt !== "string" || options.systemPrompt.length > 200_000)) ||
    (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1 || options.maxTokens > 128_000)) ||
    (options.temperature !== undefined && (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)) ||
    (options.scope !== undefined && (typeof options.scope?.tenantId !== "string" || !options.scope.tenantId.trim() || options.scope.tenantId.length > 256))) {
    throw new AIGenerationError("ai_invalid_input");
  }
  const provider = getProvider();
  const fallback = process.env.AI_FALLBACK_PROVIDER ? parseProvider(process.env.AI_FALLBACK_PROVIDER) : undefined;
  if (activeRequests >= AI_MAX_CONCURRENT_REQUESTS) throw new AIGenerationError("ai_busy", 5);
  activeRequests++;
  const controller = new AbortController();
  const cancel = () => controller.abort(cancellationFailure(options.signal));
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new AIGenerationError("ai_timeout")), AI_REQUEST_TIMEOUT_MS);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  const run = async (release: AILease): Promise<GenerationResult> => {
    try {
      const requestOptions = { ...options, signal: controller.signal };
      try {
        return { ...await attempt(provider, prompt, requestOptions), provider, fallbackUsed: false };
      } catch (error) {
        const failure = normalizeFailure(error, controller.signal);
        // At most one explicit fallback. No invalid input/output, refusals,
        // cancellation, or admission/budget failures may trigger another provider.
        if (controller.signal.aborted || !fallback || fallback === provider ||
          !["ai_configuration", "ai_quota", "ai_rate_limit", "ai_unavailable", "ai_timeout"].includes(failure.code)) throw failure;
        return { ...await attempt(fallback, prompt, requestOptions), provider: fallback, fallbackUsed: true };
      }
    } finally {
      release();
    }
  };
  let operation: Promise<GenerationResult>;
  try {
    const lease = acquireAILease(options.scope?.tenantId);
    // Preserve synchronous transport start on the no-Redis path. A late Redis
    // admission after cancellation is released by run without starting transport.
    operation = typeof lease === "function" ? run(lease) : lease.then(run);
  } catch (error) {
    operation = Promise.reject(error);
  }
  // Keep the slot until the transport settles, even if a broken adapter ignores abort.
  void operation.then(() => { activeRequests--; }, () => { activeRequests--; });
  try {
    return await Promise.race([operation, aborted]);
  } catch (error) {
    throw normalizeFailure(error, controller.signal);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

/** Backwards-compatible string-only entry point. */
export async function generateText(prompt: string, options: GenerationOptions = {}): Promise<string> {
  return (await generateTextWithMetadata(prompt, options)).text;
}
