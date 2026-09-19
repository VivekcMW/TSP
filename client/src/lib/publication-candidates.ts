import { publicationCandidateSchema, type PublicationCandidate } from "@shared/publication-preferences";

/** Shared validation handles incomplete typed URLs and malformed AI metadata. */
export function parsePublicationCandidate(value: unknown): PublicationCandidate | undefined {
  const parsed = publicationCandidateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}