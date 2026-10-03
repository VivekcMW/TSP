import { z } from "zod";

// Null is a real legacy revision, never an omitted precondition. Content is
// deliberately NOT trimmed: the comparison must describe the acknowledged row.
export const draftRevisionTimeSchema = z.string().datetime({ offset: true }).nullable();
export const draftPreconditionSchema = z.object({
  expectedContent: z.string(), expectedUpdatedAt: draftRevisionTimeSchema,
});
export type DraftPrecondition = z.infer<typeof draftPreconditionSchema>;
export class DraftConflictError extends Error {
  constructor() { super("Draft changed elsewhere. Check the latest draft and review it before saving your local text."); }
}

export const draftEditingSnapshotSchema = z.object({
  id: z.string().min(1), content: z.string(), updatedAt: draftRevisionTimeSchema,
  platform: z.string().min(1), tone: z.string().min(1),
});
export type DraftEditingSnapshot = z.infer<typeof draftEditingSnapshotSchema>;
export interface DraftEditingState {
  content: string;
  savedId?: string;
  savedContent?: string;
  savedUpdatedAt?: string | null;
  latestRevision?: DraftEditingSnapshot;
  status: "unsaved" | "saving" | "saved" | "failed" | "checking" | "conflict" | "refresh-failed" | "immutable";
  error?: string;
  keptLocal?: boolean;
}

export function sameDraftRevision(content: string | undefined, updatedAt: string | null | undefined, remote: DraftEditingSnapshot): boolean {
  return content === remote.content && updatedAt !== undefined &&
    (updatedAt === null ? remote.updatedAt === null : remote.updatedAt !== null && Date.parse(updatedAt) === Date.parse(remote.updatedAt));
}
export const draftSaveBlocked = (state: DraftEditingState) =>
  ["saving", "checking", "conflict", "refresh-failed", "immutable"].includes(state.status) ||
  Boolean(state.savedId && (state.savedContent === undefined || state.savedUpdatedAt === undefined));

/** A read never adopts a changed baseline, even if local text equals remote. */
export function observeDraftRevision<T extends DraftEditingState>(state: T, latestRevision: DraftEditingSnapshot): T {
  const matches = sameDraftRevision(state.savedContent, state.savedUpdatedAt, latestRevision);
  const synchronized = state.content === latestRevision.content ? "saved" : "unsaved";
  return { ...state, latestRevision, keptLocal: false, error: undefined,
    status: matches ? synchronized : "conflict" };
}
export function editDraftText<T extends DraftEditingState>(state: T, content: string): T {
  if (draftSaveBlocked(state)) return { ...state, content };
  // A failed write remains unconfirmed even if the user types the old baseline.
  const synchronized = state.savedId && state.savedContent === content ? "saved" : "unsaved";
  return { ...state, content, error: state.status === "failed" ? state.error : undefined,
    status: state.status === "failed" ? "failed" : synchronized };
}
export function acknowledgeDraftSave<T extends DraftEditingState>(state: T, submitted: string, saved: DraftEditingSnapshot): T {
  // Normalization belongs to this submitted revision only, not a later edit.
  const content = state.content === submitted ? saved.content : state.content;
  return { ...state, content, savedId: saved.id, savedContent: saved.content, savedUpdatedAt: saved.updatedAt,
    latestRevision: saved, keptLocal: false, error: undefined, status: content === saved.content ? "saved" : "unsaved" };
}
/** Explicit review only. Neither resolution performs a write. */
export function adoptDraftRevision<T extends DraftEditingState>(state: T, load: boolean): T {
  const remote = state.latestRevision;
  if (!remote || state.status !== "conflict") return state;
  return acknowledgeDraftSave({ ...state, content: load ? remote.content : state.content }, remote.content, remote);
}
export function parseDraftEditingSnapshot(value: unknown, expected: { id?: string; platform: string; tone: string }): DraftEditingSnapshot {
  const parsed = draftEditingSnapshotSchema.safeParse(value);
  if (!parsed.success || expected.id !== undefined && parsed.data.id !== expected.id ||
    parsed.data?.platform !== expected.platform || parsed.data?.tone !== expected.tone) {
    throw new Error("Draft revision could not be confirmed. Check Content before trying again.");
  }
  return parsed.data;
}