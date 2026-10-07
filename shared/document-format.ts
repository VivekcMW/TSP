import { z } from "zod";

export const MAX_DOCUMENT_FORMAT_LENGTH = 200_000;
const blockTypes = ["paragraph", "heading", "blockquote", "bulletList", "orderedList"] as const;
const nodeTypes = ["doc", ...blockTypes, "listItem", "text", "hardBreak"] as const;
const markSchema = z.object({ type: z.enum(["bold", "italic", "underline", "strike", "highlight"]) }).strict();
const attributesSchema = z.object({
  textAlign: z.enum(["left", "center", "right"]).nullable().optional(),
  level: z.number().int().min(1).max(3).optional(),
  start: z.number().int().min(1).max(1_000_000).optional(),
  type: z.enum(["1", "a", "A", "i", "I"]).nullable().optional(),
}).strict();

export interface FormattedDocument {
  type: typeof nodeTypes[number];
  content?: FormattedDocument[];
  text?: string;
  marks?: z.infer<typeof markSchema>[];
  attrs?: z.infer<typeof attributesSchema>;
}

const nodeSchema: z.ZodType<FormattedDocument> = z.lazy(() => z.object({
  type: z.enum(nodeTypes),
  content: z.array(nodeSchema).max(5000).optional(),
  text: z.string().min(1).max(MAX_DOCUMENT_FORMAT_LENGTH).optional(),
  marks: z.array(markSchema).max(5).optional(),
  attrs: attributesSchema.optional(),
}).strict().superRefine((node, ctx) => {
  const allowed: readonly string[] = node.type === "paragraph" || node.type === "heading" ? ["text", "hardBreak"]
    : node.type === "bulletList" || node.type === "orderedList" ? ["listItem"]
      : node.type === "text" || node.type === "hardBreak" ? [] : blockTypes;
  const attributes = node.type === "paragraph" ? ["textAlign"] : node.type === "heading" ? ["textAlign", "level"]
    : node.type === "orderedList" ? ["start", "type"] : [];
  if (node.content?.some(child => !allowed.includes(child.type)) ||
    Object.keys(node.attrs ?? {}).some(key => !attributes.includes(key)) ||
    node.marks?.length && node.type !== "text" && node.type !== "hardBreak" ||
    ["doc", "blockquote", "bulletList", "orderedList", "listItem"].includes(node.type) && !node.content?.length ||
    node.type === "listItem" && node.content?.[0]?.type !== "paragraph" ||
    node.type === "text" && !node.text || node.type !== "text" && node.text !== undefined ||
    node.type === "heading" && !node.attrs?.level) {
    ctx.addIssue({ code: "custom", message: "Invalid formatted document structure." });
  }
}));

export function parseDocumentFormat(json: string): FormattedDocument {
  if (json.length > MAX_DOCUMENT_FORMAT_LENGTH) throw new Error("Document formatting is too large. Simplify formatting before saving.");
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error("Document formatting is not valid JSON."); }
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 10_000 || item.depth > 32) throw new Error("Document formatting is too complex.");
    if (item.value && typeof item.value === "object" && "content" in item.value && Array.isArray(item.value.content)) {
      pending.push(...item.value.content.map(value => ({ value, depth: item.depth + 1 })));
    }
  }
  const parsed = nodeSchema.safeParse(value);
  if (!parsed.success || parsed.data.type !== "doc" || !parsed.data.content?.length) throw new Error("Document formatting is invalid.");
  return parsed.data;
}

/** Generation uses words and paragraph breaks, never rich-text JSON or HTML. */
export function documentPlainText(document: FormattedDocument): string {
  const paragraphs: string[] = [];
  const visit = (node: FormattedDocument) => {
    if (node.type === "paragraph" || node.type === "heading") {
      paragraphs.push((node.content ?? []).map(child => child.type === "hardBreak" ? "\n" : child.text ?? "").join(""));
    } else node.content?.forEach(visit);
  };
  visit(document);
  return paragraphs.join("\n\n");
}

export function documentFromText(text: string): FormattedDocument {
  return { type: "doc", content: text.split("\n\n").map(paragraph => ({
    type: "paragraph", content: paragraph.split("\n").flatMap((line, index): FormattedDocument[] => [
      ...(index ? [{ type: "hardBreak" as const }] : []),
      ...(line ? [{ type: "text" as const, text: line }] : []),
    ]),
  })) };
}
