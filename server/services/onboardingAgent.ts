import { z } from "zod";
import { key } from "./onboardingShared";
import { onboardingSuggestionRequestSchema, suggestOnboardingItems, type OnboardingSuggestionResponse } from "./onboardingSuggestions";
import { AIGenerationError, getAIErrorResponse } from "./openRouter";

const agentStep = z.enum(["publications", "topics", "people"]);
const ORDER = agentStep.options;
export type AgentStep = z.infer<typeof agentStep>;

export const onboardingAgentRequestSchema = onboardingSuggestionRequestSchema.omit({ step: true }).extend({
  steps: z.array(agentStep).min(1).max(3)
    .refine(steps => steps.every((step, index) => index === 0 || ORDER.indexOf(step) > ORDER.indexOf(steps[index - 1])), "Steps must be unique and in order"),
});
export type OnboardingAgentRequest = z.input<typeof onboardingAgentRequestSchema>;

export type AgentEvent =
  | { type: "progress"; step: AgentStep; message: string }
  | ({ type: "result" } & Exclude<OnboardingSuggestionResponse, { step: "preview" }>)
  | { type: "error"; step: AgentStep | null; code: string; retryAfterSeconds?: number }
  | { type: "done" };

// A provider that did not answer may answer a moment later. Quota and rate-limit failures put
// the provider in a cooldown of a minute or more, where an immediate retry cannot help.
const RETRYABLE = new Set(["ai_unavailable", "ai_busy"]);
const DEFAULT_RETRY_DELAY_MS = 1500;

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * One agent run: research each requested step in order. Within a run, the agent's own picks
 * feed the next step (after anything the user already chose), so topics come from the sources
 * it picked and people from the topics it picked. A failed step is reported and the run goes on.
 */
export async function runOnboardingAgent(input: OnboardingAgentRequest, scope: { tenantId: string }, signal: AbortSignal, emit: (event: AgentEvent) => void,
  { retryDelayMs = DEFAULT_RETRY_DELAY_MS }: { retryDelayMs?: number } = {}) {
  const { steps, ...base } = onboardingAgentRequestSchema.parse(input);
  let publications = base.publications;
  let topics = base.topics;
  for (const step of steps) {
    const research = () => suggestOnboardingItems({ ...base, step, publications, topics }, scope, signal, message => emit({ type: "progress", step, message }));
    try {
      let result;
      try {
        result = await research();
      } catch (error) {
        if (signal.aborted || !(error instanceof AIGenerationError) || !RETRYABLE.has(error.code)) throw error;
        emit({ type: "progress", step, message: "The AI service didn't respond, so I'm trying again…" });
        await wait(retryDelayMs, signal);
        result = await research();
      }
      if (result.step === "preview") continue;
      emit({ type: "result", ...result });
      if (result.step === "publications") {
        const known = new Set(publications.map(publication => key(publication.name)));
        const picked = result.items.filter(item => result.picks.includes(item.name) && !known.has(key(item.name)))
          .map(item => item.url ? { name: item.name, url: item.url } : { name: item.name });
        publications = [...publications, ...picked].slice(0, 20);
      }
      if (result.step === "topics") {
        const known = new Set(topics.map(key));
        topics = [...topics, ...result.picks.filter(name => !known.has(key(name)))].slice(0, 20);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      const failure = getAIErrorResponse(error);
      const retryAfterSeconds = failure.retryAfterSeconds ? Number(failure.retryAfterSeconds) : undefined;
      console.warn(`[onboarding-agent] ${step} failed: ${failure.body.code}${retryAfterSeconds ? ` (retry after ${retryAfterSeconds}s)` : ""}`);
      emit({ type: "error", step, code: failure.body.code, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
    }
  }
  emit({ type: "done" });
}
