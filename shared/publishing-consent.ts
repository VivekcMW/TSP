import { z } from "zod";
import { draftPreconditionSchema, draftRevisionTimeSchema } from "./draft-revision";

// Consent is distinct from policy approval. Even when review is disabled (or
// someone approved a newer version), admission must match what THIS user saw.
const targetSchema = z.object({
  id: z.string().min(1), platform: z.string().min(1), status: z.string().min(1),
  revision: z.number().int().nonnegative(), updatedAt: draftRevisionTimeSchema,
}).strict();
export const publishingSchedulePreconditionSchema = z.object({
  id: z.string().min(1), status: z.string().min(1),
  scheduledPublishAt: z.string().datetime({ offset: true }), updatedAt: draftRevisionTimeSchema,
  targets: z.array(targetSchema).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).strict();
export const publishingConsentSchema = draftPreconditionSchema.extend({
  // Required null means "I reviewed a draft with no prior schedule", NOT a wildcard.
  expectedSchedule: publishingSchedulePreconditionSchema.nullable(),
}).strict();
export type PublishingConsent = z.infer<typeof publishingConsentSchema>;
export class PublishingConsentError extends Error {
  readonly code = "publishing_reconfirm_required";
  constructor() { super("Draft or publishing targets changed. Refresh and review the exact text, destinations and schedule, then confirm again. Nothing was admitted by this request."); }
}

type Time = Date | string | null;
export interface ConsentScheduleSource {
  id: string; status: string; scheduledPublishAt: Date | string; updatedAt?: Time;
  targets?: Array<{ id: string; platform: string; status: string; revision?: number; updatedAt?: Time }>;
}
const iso = (value: Time | undefined) => value instanceof Date ? value.toISOString() : value;
/** Missing fields remain missing: malformed/old snapshots must fail closed. */
export function capturePublishingConsent(draft: { content: string; updatedAt?: Time }, schedule: ConsentScheduleSource | null): PublishingConsent | undefined {
  const result = publishingConsentSchema.safeParse({
    expectedContent: draft.content, expectedUpdatedAt: iso(draft.updatedAt),
    expectedSchedule: schedule === null ? null : {
      id: schedule.id, status: schedule.status, scheduledPublishAt: iso(schedule.scheduledPublishAt), updatedAt: iso(schedule.updatedAt),
      targets: schedule.targets?.map(target => ({ id: target.id, platform: target.platform, status: target.status,
        revision: target.revision, updatedAt: iso(target.updatedAt) })),
    },
  });
  return result.success ? result.data : undefined;
}
function comparable(value: PublishingConsent) {
  const time = (input: string | null) => input === null ? null : Date.parse(input);
  const schedule = value.expectedSchedule;
  return JSON.stringify([value.expectedContent, time(value.expectedUpdatedAt), schedule && [schedule.id, schedule.status,
    time(schedule.scheduledPublishAt), time(schedule.updatedAt), [...schedule.targets].sort((a, b) => a.id.localeCompare(b.id))
      .map(target => [target.id, target.platform, target.status, target.revision, time(target.updatedAt)])]]);
}
/** Must be called only after taking the owner draft FOR UPDATE lock. */
export function assertPublishingConsent(expected: PublishingConsent, draft: { content: string; updatedAt?: Time }, schedule: ConsentScheduleSource | null): void {
  const parsed = publishingConsentSchema.safeParse(expected);
  const current = capturePublishingConsent(draft, schedule);
  if (!parsed.success || !current || comparable(parsed.data) !== comparable(current)) throw new PublishingConsentError();
}