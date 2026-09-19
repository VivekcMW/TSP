import { z } from "zod";

export const MAX_VOICE_SAMPLES = 5;
export const MAX_VOICE_SAMPLE_CHARACTERS = 1000;
const sampleText = z.string().trim().min(20).max(MAX_VOICE_SAMPLE_CHARACTERS);
const origin = z.enum(["explicit-sample", "approved-edit"]);
const revision = z.number().int().nonnegative().max(2147483646);
export const voiceScopeSchema = z.object({ tenantId: z.string().trim().min(1).max(256), userId: z.string().trim().min(1).max(256) }).strict();
export type VoiceScope = z.infer<typeof voiceScopeSchema>;
export const voiceSampleSchema = z.object({
  id: z.string().uuid(), text: sampleText, origin, approvedAt: z.string().datetime(), deletedAt: z.string().datetime().nullable(),
}).strict();
export const editorialVoiceSchema = z.object({ enabled: z.boolean(), revision, samples: z.array(voiceSampleSchema).max(MAX_VOICE_SAMPLES) }).strict();
export type EditorialVoice = z.infer<typeof editorialVoiceSchema>;
export const voiceMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), revision, enabled: z.boolean(), consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("add"), revision, text: sampleText, origin, consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("edit"), revision, id: z.string().uuid(), text: sampleText, consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("delete"), revision, id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("restore"), revision, id: z.string().uuid(), consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("forget"), revision, id: z.string().uuid(), confirm: z.literal(true) }).strict(),
]);
export type VoiceMutation = z.infer<typeof voiceMutationSchema>;
export const emptyEditorialVoice = (): EditorialVoice => ({ enabled: false, revision: 0, samples: [] });

/** Only explicitly approved, active samples. Not biography, instructions or evidence. */
export function voicePromptData(value: EditorialVoice) {
  const voice = editorialVoiceSchema.parse(value);
  if (!voice.enabled) return undefined;
  const samples = voice.samples.filter(sample => sample.deletedAt === null).map(sample => ({ text: sample.text }));
  return samples.length ? { trust: "UNTRUSTED" as const, purpose: "optional-style-only" as const, samples } : undefined;
}