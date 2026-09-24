const STAGES = ["provider_response_json", "provider_finish_reason", "provider_content_shape", "provider_empty_text", "writer_json", "writer_schema", "writer_validation", "writer_sentinel"] as const;
export type AIDiagnosticStage = typeof STAGES[number];

const VALIDATION_REASONS = ["json_parse", "schema", "empty_content", "insufficient_source", "format", "evidence", "attribution", "length", "url", "publication_missing", "source_url_missing", "unexpected_url", "placeholder_url", "multiple_urls", "hashtags", "quotation", "personal_experience"] as const;
export type AIValidationReason = typeof VALIDATION_REASONS[number];

const TONES = ["thoughtLeader", "industryInsider", "provocateur", "dataDriven", "professional", "custom"] as const;
export type AIDiagnosticTone = typeof TONES[number];

const FINISH_REASONS = ["end_turn", "max_tokens", "tool_use", "pause_turn", "stop_sequence", "stop", "length", "tool_calls", "function_call", "STOP", "MAX_TOKENS", "OTHER", "MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL"] as const;
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const safeProvider = (value: unknown) => value === "anthropic" || value === "openrouter" || value === "gemini" || value === "openai" ? value : null;
const safeModel = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9._:/-]{1,120}$/.test(value) &&
  !/[\r\n\u2028\u2029]/.test(value) && !value.includes("://") && !/^(?:sk-|AIza|Bearer)/i.test(value) ? value : null;
const FAILURE_CODES = ["ai_configuration", "ai_quota", "ai_rate_limit", "ai_unavailable", "ai_timeout", "ai_invalid_input", "ai_refusal", "ai_busy", "ai_budget"] as const;

/** Metadata only. Never pass prompts, output, SDK objects, errors, or request scope. */
export interface AIDiagnosticInput {
  stage: AIDiagnosticStage;
  provider?: unknown;
  model?: unknown;
  finishReason?: unknown;
  maxTokens?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  visibleTextLength?: unknown;
  validationReasons?: readonly AIValidationReason[];
  tone?: unknown;
  attempt?: unknown;
}

/** Call only on invalid output. Unknown fields are discarded; logging cannot change the failure. */
export function logAIInvalidOutputDiagnostic(input: AIDiagnosticInput): void {
  try {
    if (!STAGES.includes(input.stage)) return;
    const diagnostic = {
      code: "ai_invalid_output",
      stage: input.stage,
      provider: safeProvider(input.provider),
      model: safeModel(input.model),
      finishReason: FINISH_REASONS.find(reason => reason === input.finishReason) ?? "other",
      maxTokens: count(input.maxTokens),
      inputTokens: count(input.inputTokens),
      outputTokens: count(input.outputTokens),
      visibleTextLength: count(input.visibleTextLength),
      validationReasons: VALIDATION_REASONS.filter(reason => Array.isArray(input.validationReasons) && input.validationReasons.includes(reason)),
      ...(input.tone === undefined ? {} : { tone: TONES.find(tone => tone === input.tone) ?? "custom" }),
      ...(input.attempt === undefined ? {} : { attempt: input.attempt === 1 || input.attempt === 2 ? input.attempt : null }),
    };
    console.warn('[ai-diagnostic]', JSON.stringify(diagnostic));
  } catch {
    // Diagnostics must never replace the original error or cause a fallback.
  }
}

/**
 * One line per failed provider call, so an outage is visible (and which provider caused it)
 * even when a retry or fallback follows. Metadata only: never messages, bodies or headers.
 */
export function logAIProviderFailure(input: { provider?: unknown; model?: unknown; code?: unknown; status?: unknown; retryAfterSeconds?: unknown }): void {
  try {
    const status = typeof input.status === "number" && Number.isInteger(input.status) && input.status >= 100 && input.status <= 599 ? input.status : null;
    console.warn("[ai-provider-failure]", JSON.stringify({
      provider: safeProvider(input.provider),
      model: safeModel(input.model),
      code: FAILURE_CODES.find(code => code === input.code) ?? "other",
      status,
      retryAfterSeconds: count(input.retryAfterSeconds),
    }));
  } catch {
    // Diagnostics must never replace the original error.
  }
}
