const STAGES = ["provider_response_json", "provider_finish_reason", "provider_content_shape", "provider_empty_text", "writer_json", "writer_schema", "writer_validation", "writer_sentinel"] as const;
export type AIDiagnosticStage = typeof STAGES[number];

const VALIDATION_REASONS = ["json_parse", "schema", "empty_content", "insufficient_source", "format", "evidence", "attribution", "length", "url", "publication_missing", "source_url_missing", "unexpected_url", "placeholder_url", "multiple_urls", "hashtags", "quotation", "personal_experience"] as const;
export type AIValidationReason = typeof VALIDATION_REASONS[number];

const TONES = ["thoughtLeader", "industryInsider", "provocateur", "dataDriven", "professional", "custom"] as const;
export type AIDiagnosticTone = typeof TONES[number];

const FINISH_REASONS = ["end_turn", "max_tokens", "tool_use", "pause_turn", "stop_sequence", "stop", "length", "tool_calls", "function_call", "STOP", "MAX_TOKENS", "OTHER", "MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL"] as const;
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

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
    const model = typeof input.model === "string" && /^[a-zA-Z0-9._:/-]{1,120}$/.test(input.model) &&
      !/[\r\n\u2028\u2029]/.test(input.model) && !input.model.includes("://") && !/^(?:sk-|AIza|Bearer)/i.test(input.model) ? input.model : null;
    const diagnostic = {
      code: "ai_invalid_output",
      stage: input.stage,
      provider: input.provider === "anthropic" || input.provider === "openrouter" || input.provider === "gemini" || input.provider === "openai" ? input.provider : null,
      model,
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