import { z } from "zod";
import { ALL_PLATFORM_KEYS } from "./schema";
import { EDITORIAL_TONES, MAX_CREATION_REFERENCES, sourceFailureSchema } from "./editorial";
import { draftRevisionTimeSchema } from "./draft-revision";
import { documentPlainText, MAX_DOCUMENT_FORMAT_LENGTH, parseDocumentFormat } from "./document-format";

export const creationStepSchema = z.enum(["source", "review", "platforms", "versions"]);
export type CreationStep = z.infer<typeof creationStepSchema>;
const mediaSchema = z.array(z.object({
  id: z.string().optional(), type: z.enum(["image", "video", "audio"]),
  name: z.string().max(255), url: z.string().max(2000),
})).max(8);
const reviewJsonSchema = z.string().max(250_000);
export { MAX_CREATION_REFERENCES } from "./editorial";
const creationMainSchema = z.object({
  title: z.string().max(200), content: z.string().max(5000), original: z.string().max(5000),
  revision: z.number().int().positive(), reviewJson: reviewJsonSchema.optional(),
  formatJson: z.string().min(1).max(MAX_DOCUMENT_FORMAT_LENGTH).optional(),
}).superRefine((main, ctx) => {
  if (!main.formatJson) return;
  try {
    if (documentPlainText(parseDocumentFormat(main.formatJson)) !== main.content) {
      ctx.addIssue({ code: "custom", message: "Document formatting and text do not match.", path: ["formatJson"] });
    }
  } catch (error) {
    ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid document formatting.", path: ["formatJson"] });
  }
});
const suggestionBaseSchema = z.object({
  id: z.string().uuid(), title: z.string().max(200), content: z.string().max(5000),
  revision: z.number().int().nonnegative(),
  formatJson: z.string().min(1).max(MAX_DOCUMENT_FORMAT_LENGTH).optional(),
});
export const creationChatSchema = z.object({
  input: z.string().max(4000),
  referenceUrls: z.array(z.string().url().max(2048)).max(MAX_CREATION_REFERENCES),
  messages: z.array(z.object({
    id: z.string().uuid(), role: z.enum(["user", "assistant"]), content: z.string().max(4000),
  })).max(100),
  pending: suggestionBaseSchema.optional(),
  proposal: suggestionBaseSchema.extend({ reviewJson: reviewJsonSchema }).optional(),
  undo: z.object({ previous: creationMainSchema.optional(), applied: suggestionBaseSchema }).optional(),
  failure: sourceFailureSchema.optional(),
});
export type CreationChat = z.infer<typeof creationChatSchema>;
export const creationSessionSchema = z.object({
  version: z.literal(1),
  step: creationStepSchema,
  source: z.object({
    mode: z.enum(["article", "manual"]), url: z.string().max(2048),
    inboxItemId: z.string().optional(),
    manual: z.object({ title: z.string().max(200), content: z.string().max(20_000), media: mediaSchema }),
  }),
  tone: z.enum(EDITORIAL_TONES),
  format: z.enum(["short-post", "article"]),
  selectedPlatforms: z.array(z.enum(ALL_PLATFORM_KEYS)).max(4),
  main: creationMainSchema.optional(),
  chat: creationChatSchema.optional(),
  reviewedRevision: z.number().int().positive().optional(),
  versions: z.array(z.object({
    platform: z.enum(ALL_PLATFORM_KEYS), tone: z.enum(EDITORIAL_TONES),
    content: z.string().max(5000), original: z.string().max(5000), reviewJson: reviewJsonSchema,
    mainRevision: z.number().int().positive().optional(), inboxItemId: z.string().optional(),
    savedId: z.string().optional(), savedContent: z.string().max(5000).optional(),
    savedUpdatedAt: draftRevisionTimeSchema.optional(),
  })).max(92),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 900_000,
  "Creation is too large to save.");
export type CreationSession = z.infer<typeof creationSessionSchema>;
export const creationSessionResponseSchema = z.object({
  revision: z.number().int().nonnegative(), state: creationSessionSchema.nullable(),
});
export const saveCreationSessionSchema = z.object({
  revision: z.number().int().nonnegative(), state: creationSessionSchema,
}).strict();
