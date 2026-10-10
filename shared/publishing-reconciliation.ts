import { z } from "zod";

/** Operator evidence is a manual claim, NEVER a provider verification result. */
export const reconciliationSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(["delivered", "not_delivered", "unresolved"]),
  note: z.string().trim().min(10).max(1000),
  receipt: z.string().trim().min(1).max(300).optional(),
  workerStopped: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.decision === "delivered" && !value.receipt) context.addIssue({ code: "custom", message: "A provider receipt reference is required for a manual delivery claim." });
  if (value.decision === "not_delivered" && !value.workerStopped) context.addIssue({ code: "custom", message: "Confirm the old worker is stopped before permitting a new attempt." });
});
export type ReconciliationDecision = z.infer<typeof reconciliationSchema>;