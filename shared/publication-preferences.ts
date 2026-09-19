import { z } from "zod";

/** A user-selected candidate, not proof of a working feed or publisher identity. */
export const publicationCandidateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().max(2048).transform((value, context) => {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
      url.hash = "";
      // Percent-encoding may expand a valid short input past our storage limit.
      if (url.href.length > 2048) throw new Error("URL too long");
      return url.href;
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Use an HTTP(S) URL without credentials, up to 2048 characters" });
      return z.NEVER;
    }
  }),
});

export type PublicationCandidate = z.infer<typeof publicationCandidateSchema>;

export const publicationCandidatesSchema = z.array(publicationCandidateSchema).max(20).transform(items => {
  const unique = new Map<string, PublicationCandidate>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
});

/** Preserve URL metadata only for names still selected; never guess a domain. */
export function reconcilePublicationCandidates(names: readonly string[], candidates: readonly PublicationCandidate[]): PublicationCandidate[] {
  const selected = new Set(names.map(name => name.trim().toLowerCase()));
  return candidates.filter(candidate => selected.has(candidate.name.toLowerCase()));
}

/** Legacy explicit URLs and bare domains remain supported; plain names do not. */
export function legacyPublicationUrl(name: string): string | undefined {
  const input = name.trim().replace(/^\/\//, "https://");
  const url = /^https?:\/\//i.test(input) ? input
    : /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(input) ? `https://${input}` : undefined;
  if (!url) return undefined;
  const parsed = publicationCandidateSchema.safeParse({ name: "Legacy source", url });
  return parsed.success ? parsed.data.url : undefined;
}

export function selectedPublicationCandidates(names: readonly string[], candidates: readonly PublicationCandidate[] = []): PublicationCandidate[] {
  const metadata = new Map(candidates.map(candidate => [candidate.name.toLowerCase(), candidate]));
  const urls = new Set<string>();
  const result: PublicationCandidate[] = [];
  for (const name of names) {
    const url = metadata.get(name.trim().toLowerCase())?.url ?? legacyPublicationUrl(name);
    if (!url || urls.has(url)) continue;
    urls.add(url);
    result.push({ name, url });
  }
  return result;
}

export interface PublicationSourceStatus {
  name: string;
  url?: string;
  status: "needs-url" | "pending" | "checking" | "failed" | "connected" | "paused" | "removed";
  message: string;
  lastAttemptAt?: string | null;
  sourceId?: string;
}