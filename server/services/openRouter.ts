import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { randomInt, randomUUID } from "node:crypto";
import { acquireAILease, AIProviderLimitError, type AILease } from "./aiProviderLimiter";
import { logAIInvalidOutputDiagnostic, logAIProviderFailure, type AIAbortOrigin, type AIDiagnosticInput, type AIProviderStage } from "./aiDiagnostics";

const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o";
// Pinned, stable snapshot verified against official model docs on 2026-09-16:
// https://platform.claude.com/docs/en/models/sonnet-5/overview
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export type AIProvider = "openrouter" | "gemini" | "anthropic" | "openai";

export const AI_REQUEST_TIMEOUT_MS = 20_000;
// Per-process safety valve, in addition to the Redis-backed shared admission
// lease (AI_SHARED_MAX_CONCURRENT_REQUESTS in aiProviderLimiter.ts). On a
// single Cloud Run instance this is the binding limit; raise it alongside the
// shared one, not instead of it. Falls back to 4 on an invalid value rather
// than crashing the process over a tuning knob.
function readMaxConcurrentRequests(): number {
  const raw = process.env.AI_MAX_CONCURRENT_REQUESTS;
  if (!raw) return 4;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    console.warn(`Invalid AI_MAX_CONCURRENT_REQUESTS="${raw}"; falling back to 4`);
    return 4;
  }
  return value;
}
export const AI_MAX_CONCURRENT_REQUESTS = readMaxConcurrentRequests();

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
  /** providerStatus is the upstream HTTP status, for diagnostics only; it never reaches clients. */
  constructor(public readonly code: keyof typeof FAILURE_DETAILS, public readonly retryAfterSeconds?: number, public readonly providerStatus?: number) {
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
  /** Overrides AI_REQUEST_TIMEOUT_MS for calls with a larger expected output
   * (e.g. onboarding's structured analysis) where the default is too tight. */
  timeoutMs?: number;
  /** Trusted absolute deadline; admission, retry and fallback cannot reset it. */
  deadlineAt?: number;
  /** Server-authored identifiers only; never user/tenant IDs or prompt content. */
  diagnosticContext?: { jobId?: string; stage?: "writer" | "repair" };
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
  const upstream = typeof status === "number" ? status : undefined;
  if (status === 429 || status === 402) {
    let seconds = 60;
    if (retryAfter) seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1000;
    return new AIGenerationError("ai_quota", Math.max(60, Math.min(3600, Math.ceil(seconds) || 60)), upstream);
  }
  if (status === 400 || status === 413 || status === 422) return new AIGenerationError("ai_invalid_input", undefined, upstream);
  if (status === 401 || status === 403 || status === 404) return new AIGenerationError("ai_configuration", 60, upstream);
  if (status === 408 || status === 504) return new AIGenerationError("ai_timeout", undefined, upstream);
  return new AIGenerationError("ai_unavailable", undefined, upstream);
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
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS, logLevel: "off", baseURL: "https://api.anthropic.com", fetchOptions: { redirect: "error" } });
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
  const modelId = model.replace(/^models\//, "");
  const pro = modelId === "gemini-3.1-pro-preview" || modelId === "gemini-3.1-pro-preview-customtools";
  const maxOutputTokens = options.maxTokens ?? (pro ? 8192 : 2048);
  diagnostic.model = model;
  diagnostic.maxTokens = maxOutputTokens;
  // No retryOptions: the SDK's default unary path makes exactly one fetch and
  // preserves ApiError.status. Its opt-in retry wrapper discards that status.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS } });

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction: options.systemPrompt,
      abortSignal: options.signal,
      temperature: options.temperature ?? (pro ? 1 : 0.7),
      // Pro cannot disable thinking. Its cap includes reasoning AND visible
      // output; keep a bounded allowance while honoring explicit caller caps.
      // https://ai.google.dev/gemini-api/docs/gemini-3
      maxOutputTokens,
      thinkingConfig: pro ? { thinkingLevel: ThinkingLevel.LOW } : { thinkingBudget: 0 },
    },
  });

  const candidate = response.candidates?.[0];
  diagnostic.model = response.modelVersion || model;
  diagnostic.finishReason = candidate?.finishReason;
  diagnostic.inputTokens = response.usageMetadata?.promptTokenCount;
  const visibleTokens = tokenCount(response.usageMetadata?.candidatesTokenCount);
  // Thinking tokens are billable output, even though reasoning stays private.
  const outputTokens = visibleTokens === null ? null : visibleTokens + (tokenCount(response.usageMetadata?.thoughtsTokenCount) ?? 0);
  diagnostic.outputTokens = outputTokens;
  diagnostic.visibleTextLength = Array.isArray(candidate?.content?.parts) ? candidate.content.parts.reduce((length, part) => length + (!part?.thought && typeof part?.text === "string" ? part.text.length : 0), 0) : 0;
  if (response.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(candidate?.finishReason ?? "")) throw new AIGenerationError("ai_refusal");
  diagnostic.stage = "provider_finish_reason";
  if (candidate?.finishReason && candidate.finishReason !== "STOP") throw new AIGenerationError("ai_invalid_output");
  const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || "").join("") || "";
  return { text: text.trim(), model: response.modelVersion || model, usage: { inputTokens: tokenCount(response.usageMetadata?.promptTokenCount), outputTokens } };
}

interface ProviderExecution {
  operationId: string;
  jobId?: string;
  stage: AIProviderStage;
  startedAt: number;
  budgetMs: number;
  provider: AIProvider;
  attempt: number;
  diagnostic?: AIDiagnosticInput;
  abortOrigin?: AIAbortOrigin;
  expire: () => void;
}

/** @google/genai 1.52 attaches its listener after async preprocessing without
 * checking an already-aborted signal. Fence that subscription before its unary
 * dispatch path. Do not mutate the operation signal or global fetch. Recheck
 * this version-specific workaround whenever upgrading the SDK. */
function geminiAbortSignal(options: GenerationOptions, execution: ProviderExecution): AbortSignal {
  return new Proxy(options.signal!, {
    get(signal, key) {
      if (key === "addEventListener") return (...args: Parameters<AbortSignal["addEventListener"]>) => {
        if (args[0] === "abort") remainingAttemptBudget(options, execution);
        return signal.addEventListener(...args);
      };
      // Native signal getters/methods require their original receiver.
      const value = Reflect.get(signal, key, signal);
      return typeof value === "function" ? value.bind(signal) : value;
    },
  });
}

function executionDiagnostic(execution: ProviderExecution) {
  return {
    operationId: execution.operationId, jobId: execution.jobId, stage: execution.stage,
    elapsedMs: Math.max(0, Date.now() - execution.startedAt), budgetMs: execution.budgetMs,
    attempt: execution.attempt, timeoutOrigin: execution.abortOrigin,
  };
}

function remainingAttemptBudget(options: GenerationOptions, execution: ProviderExecution) {
  const signal = options.signal!;
  if (signal.aborted) throw cancellationFailure(signal);
  const remaining = Math.min(options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS, options.deadlineAt! - Date.now());
  // Avoid dispatch at an exhausted deadline, including after delayed admission.
  if (remaining < 1000) {
    execution.expire();
    throw cancellationFailure(signal);
  }
  return remaining;
}

function recordAttemptFailure(failure: AIGenerationError, error: unknown, signal: AbortSignal,
  diagnostic: AIDiagnosticInput, execution: ProviderExecution) {
  if (signal.aborted) return; // The operation boundary logs local aborts immediately.
  if (failure.code === "ai_invalid_output") logAIInvalidOutputDiagnostic(diagnostic);
  else if (failure.code !== "ai_cancelled") {
    const status = typeof error === "object" && error !== null && "status" in error ? error.status : failure.providerStatus;
    logAIProviderFailure({ ...executionDiagnostic(execution), provider: execution.provider, model: diagnostic.model, code: failure.code, status,
      retryAfterSeconds: failure.retryAfterSeconds, timeoutOrigin: failure.code === "ai_timeout" ? "upstream_timeout" : undefined });
  }
}

async function attempt(provider: AIProvider, prompt: string, options: GenerationOptions, execution: ProviderExecution): Promise<ProviderResult> {
  const signal = options.signal!;
  const remaining = remainingAttemptBudget(options, execution);
  const cooldown = cooldowns.get(provider);
  if (cooldown && cooldown.until > Date.now()) {
    throw new AIGenerationError(cooldown.code, Math.ceil((cooldown.until - Date.now()) / 1000));
  }
  const diagnostic: AIDiagnosticInput = { provider, stage: "provider_response_json", maxTokens: options.maxTokens ?? 2048 };
  execution.provider = provider;
  execution.stage = options.diagnosticContext?.stage ?? "provider";
  execution.budgetMs = remaining;
  execution.attempt++;
  execution.diagnostic = diagnostic;
  try {
    const adapter = { anthropic: generateWithAnthropic, gemini: generateWithGemini, openrouter: generateWithOpenRouter, openai: generateWithOpenAI }[provider];
    const result = await adapter(prompt, { ...options, timeoutMs: remaining,
      signal: provider === "gemini" ? geminiAbortSignal(options, execution) : signal }, diagnostic);
    // Timer callbacks can be delayed by an event-loop stall; time is authoritative.
    if (Date.now() >= options.deadlineAt!) execution.expire();
    if (signal.aborted) throw cancellationFailure(signal);
    diagnostic.stage = "provider_empty_text";
    if (!result.text.trim()) throw new AIGenerationError("ai_invalid_output");
    return result;
  } catch (error) {
    const failure = normalizeFailure(error, signal);
    recordAttemptFailure(failure, error, signal, diagnostic, execution);
    if (failure.code === "ai_quota" || failure.code === "ai_configuration" || failure.code === "ai_rate_limit") {
      cooldowns.set(provider, { code: failure.code, until: Date.now() + (failure.retryAfterSeconds ?? 60) * 1000 });
    }
    throw failure;
  }
}

// Only a confirmed unavailable response permits one short retry. A network error,
// gateway failure or timeout may hide paid work; never automatically replay it.
const TRANSIENT_RETRY_DELAY_MS = 1_000;
const retryableUnavailable = (failure: AIGenerationError) => failure.code === "ai_unavailable" && failure.providerStatus === 503;

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(cancellationFailure(signal)); return; }
    const stop = () => { clearTimeout(timer); reject(cancellationFailure(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

async function attemptWithTransientRetry(provider: AIProvider, prompt: string, options: GenerationOptions, execution: ProviderExecution): Promise<ProviderResult> {
  try {
    return await attempt(provider, prompt, options, execution);
  } catch (error) {
    const signal = options.signal!;
    const failure = normalizeFailure(error, signal);
    if (!retryableUnavailable(failure) || signal.aborted) throw failure;
    await abortableDelay(TRANSIENT_RETRY_DELAY_MS + randomInt(0, 251), signal);
    return attempt(provider, prompt, options, execution);
  }
}

function validateGenerationInput(prompt: string, options: GenerationOptions) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 200_000 ||
    (options.systemPrompt !== undefined && (typeof options.systemPrompt !== "string" || options.systemPrompt.length > 200_000)) ||
    (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1 || options.maxTokens > 128_000)) ||
    (options.temperature !== undefined && (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)) ||
    (options.scope !== undefined && (typeof options.scope?.tenantId !== "string" || !options.scope.tenantId.trim() || options.scope.tenantId.length > 256)) ||
    (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120_000)) ||
    (options.deadlineAt !== undefined && (!Number.isSafeInteger(options.deadlineAt) || options.deadlineAt <= 0))) {
    throw new AIGenerationError("ai_invalid_input");
  }
}

export async function generateTextWithMetadata(prompt: string, options: GenerationOptions = {}): Promise<GenerationResult> {
  if (options.signal?.aborted) throw cancellationFailure(options.signal);
  validateGenerationInput(prompt, options);
  const provider = getProvider();
  const fallback = process.env.AI_FALLBACK_PROVIDER ? parseProvider(process.env.AI_FALLBACK_PROVIDER) : undefined;
  const startedAt = Date.now();
  const deadlineAt = Math.min(startedAt + (options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS), options.deadlineAt ?? Infinity);
  const budgetMs = deadlineAt - startedAt;
  if (budgetMs < 1000) throw new AIGenerationError("ai_timeout");
  if (activeRequests >= AI_MAX_CONCURRENT_REQUESTS) throw new AIGenerationError("ai_busy", 5);
  activeRequests++;
  const execution: ProviderExecution = { operationId: randomUUID(), jobId: options.diagnosticContext?.jobId,
    provider, startedAt, budgetMs, stage: "admission", attempt: 0,
    expire: () => abort(new AIGenerationError("ai_timeout"), "operation_deadline") };
  const controller = new AbortController();
  const abort = (reason: AIGenerationError, origin: AIAbortOrigin) => {
    if (controller.signal.aborted) return;
    execution.abortOrigin = origin;
    controller.abort(reason);
  };
  const cancel = () => {
    const failure = cancellationFailure(options.signal);
    abort(failure, failure.code === "ai_timeout" ? "caller_deadline" : "caller_cancel");
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => abort(new AIGenerationError("ai_timeout"), "operation_deadline"), budgetMs);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) cancel();
  });
  const run = async (release: AILease): Promise<GenerationResult> => {
    try {
      const requestOptions = { ...options, deadlineAt, signal: controller.signal };
      try {
        return { ...await attemptWithTransientRetry(provider, prompt, requestOptions, execution), provider, fallbackUsed: false };
      } catch (error) {
        const failure = normalizeFailure(error, controller.signal);
        // At most one explicit fallback. No invalid input/output, refusals,
        // cancellation, admission failures or uncertain transport outcomes may replay.
        if (controller.signal.aborted || !fallback || fallback === provider ||
          !(["ai_configuration", "ai_quota", "ai_rate_limit"].includes(failure.code) || retryableUnavailable(failure))) throw failure;
        try {
          return { ...await attempt(fallback, prompt, requestOptions, execution), provider: fallback, fallbackUsed: true };
        } catch (fallbackError) {
          // The configured provider's failure is the real one: an unhealthy fallback
          // (e.g. unfunded) must not turn a brief outage into "quota exhausted".
          if (controller.signal.aborted) throw normalizeFailure(fallbackError, controller.signal);
          throw failure;
        }
      }
    } finally {
      release();
    }
  };
  let operation: Promise<GenerationResult>;
  try {
    const lease = acquireAILease(options.scope?.tenantId, { ttlMs: budgetMs + 30_000,
      onLost: failure => abort(new AIGenerationError(failure.code, failure.retryAfterSeconds), "lease_lost") });
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
    const failure = normalizeFailure(error, controller.signal);
    // Log the local abort now, even when the underlying transport ignores it.
    // The late adapter completion must not emit a duplicate or revive a result.
    if (controller.signal.aborted || execution.attempt === 0) {
      logAIProviderFailure({ ...executionDiagnostic(execution), provider: execution.provider, model: execution.diagnostic?.model,
        code: failure.code, status: failure.providerStatus, retryAfterSeconds: failure.retryAfterSeconds });
    }
    throw failure;
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
