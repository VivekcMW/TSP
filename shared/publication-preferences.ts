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

/** Official domains for built-in suggestions only. Custom names still require an explicit URL. */
export const VERIFIED_PUBLICATION_URLS: Record<string, string> = {
  "ad age": "https://adage.com", "adweek": "https://www.adweek.com", "digiday": "https://digiday.com",
  "campaign": "https://www.campaignlive.co.uk", "the drum": "https://www.thedrum.com", "mediapost": "https://www.mediapost.com",
  "marketing week": "https://www.marketingweek.com", "ad exchanger": "https://www.adexchanger.com", "martech": "https://martech.org",
  "exchangewire": "https://www.exchangewire.com", "mumbrella": "https://mumbrella.com", "little black book": "https://lbbonline.com",
  "contagious": "https://www.contagious.com", "warc": "https://www.warc.com", "campaign asia": "https://www.campaignasia.com",
  "brand equity": "https://brandequity.economictimes.indiatimes.com", "afaqs!": "https://www.afaqs.com", "exchange4media": "https://www.exchange4media.com",
  "bestmediainfo": "https://bestmediainfo.com", "social samosa": "https://www.socialsamosa.com", "techcrunch": "https://techcrunch.com",
  "the verge": "https://www.theverge.com", "wired": "https://www.wired.com", "ars technica": "https://arstechnica.com",
  "venturebeat": "https://venturebeat.com", "financial times": "https://www.ft.com", "wall street journal": "https://www.wsj.com",
  "bloomberg": "https://www.bloomberg.com", "the economist": "https://www.economist.com", "reuters": "https://www.reuters.com",
};

export function verifiedPublicationUrl(name: string): string | undefined {
  return VERIFIED_PUBLICATION_URLS[name.trim().toLowerCase()];
}

export function selectedPublicationCandidates(names: readonly string[], candidates: readonly PublicationCandidate[] = []): PublicationCandidate[] {
  const metadata = new Map(candidates.map(candidate => [candidate.name.toLowerCase(), candidate]));
  const urls = new Set<string>();
  const result: PublicationCandidate[] = [];
  for (const name of names) {
    const url = metadata.get(name.trim().toLowerCase())?.url ?? legacyPublicationUrl(name) ?? verifiedPublicationUrl(name);
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