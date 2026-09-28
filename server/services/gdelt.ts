import { inflateRawSync } from "node:zlib";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { CrawlError, fetchPublicBytes, fetchPublicText } from "./crawlerFetch.js";
import { storePooledArticles, type StoryToStore } from "./articlePool";
import { noteDiscoveredSites, watchTermList } from "./indexDiscovery";

/**
 * GDELT as a global discovery feed. Every 15 minutes GDELT publishes every news article it saw
 * worldwide (URL, site, date, page title, and the organisations and people named), as one
 * zipped tab-separated file. Records mentioning any watched term become pool stories, with
 * their bodies read by the crawler like any other, and their sites become discovery candidates.
 * Free, no key, no throttling; about 10–30 MB per file.
 */

const LAST_UPDATE_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const MAX_ZIP_BYTES = 48 * 1024 * 1024;
const MAX_STORIES_PER_FILE = 150;
const MAX_TERMS = 500;
// GKG 2.0 columns (tab-separated, 27 fields).
const COLUMN = { date: 1, collection: 2, source: 3, url: 4, persons: 12, organisations: 14, extras: 26 } as const;

export interface GdeltStats { file: string | null; records: number; matched: number; stored: number; sites: number }
export type TermMatcher = (text: string) => boolean;

let lastFile: string | null = null;

/** The first entry of a zip archive, inflated. Enough for GDELT's one-file archives. */
export function readFirstZipEntry(zip: Buffer): Buffer {
  if (zip.length < 30 || zip.readUInt32LE(0) !== 0x04034b50) throw new Error("Not a zip archive");
  const flags = zip.readUInt16LE(6);
  const method = zip.readUInt16LE(8);
  const compressedSize = zip.readUInt32LE(18);
  const start = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
  // With bit 3 set the sizes follow the data; inflating to the stream's own end still works.
  const sizeUnknown = (flags & 0x8) !== 0 || compressedSize === 0;
  const data = zip.subarray(start, sizeUnknown ? zip.length : start + compressedSize);
  if (method === 0) return Buffer.from(data);
  if (method !== 8) throw new Error(`Unsupported zip method ${method}`);
  return inflateRawSync(data);
}

/** A whole-word, case-insensitive test for any of the terms; null when there are none. */
export function watchTermMatcher(terms: ReadonlyArray<{ term: string; kind?: string }>): TermMatcher | null {
  const escaped = [...new Set(terms.map(entry => entry.term.trim().toLowerCase()).filter(term => term.length >= 2))]
    .sort((a, b) => b.length - a.length).slice(0, MAX_TERMS)
    .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  if (!escaped.length) return null;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}])`, "iu");
  return text => pattern.test(text);
}

const decodeEntities = (value: string) => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const namesOf = (field: string) => field.split(";").map(entry => entry.split(",")[0]).filter(Boolean);

function gdeltDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The same file `steps` quarter-hours earlier; GDELT lists a file before it is uploaded, sometimes by an hour. */
export function earlierGdeltFile(file: string, steps = 1): string | null {
  const match = /(\d{14})(\.gkg\.csv\.zip)$/.exec(file);
  const iso = match && gdeltDate(match[1]);
  if (!match || !iso) return null;
  const stamp = new Date(Date.parse(iso) - steps * 15 * 60_000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return file.slice(0, match.index) + stamp + match[2];
}
// How many quarter-hours back to look for a file that has actually been uploaded.
const FALLBACK_STEPS = 6;

/** Web records whose page title, organisations or people mention a watched term, as stories to store. */
export function gkgStories(tsv: string, matches: TermMatcher, limit: number): StoryToStore[] {
  const stories: StoryToStore[] = [];
  for (const line of tsv.split("\n")) {
    if (stories.length >= limit) break;
    const columns = line.split("\t");
    if (columns.length < 27 || columns[COLUMN.collection] !== "1") continue;
    const link = canonicalHttpUrl(columns[COLUMN.url]);
    if (!link) continue;
    const title = decodeEntities(/<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/.exec(columns[COLUMN.extras])?.[1] ?? "").replace(/\s+/g, " ").trim();
    const names = [...namesOf(columns[COLUMN.organisations]), ...namesOf(columns[COLUMN.persons])];
    if (!matches(`${title} ${names.join(" ")}`)) continue;
    const source = columns[COLUMN.source].trim().toLowerCase();
    stories.push({ link, title: title || source, source, content: "", publishedAt: gdeltDate(columns[COLUMN.date]) });
  }
  return stories;
}

/** Fetches the newest GDELT file not seen yet and stores what anyone here watches. */
export async function ingestLatestGdelt(signal?: AbortSignal): Promise<GdeltStats> {
  const listing = await fetchPublicText(LAST_UPDATE_URL, { signal, timeoutMs: 8000 });
  const newest = listing.text.split(/\r?\n/).map(line => line.trim().split(/\s+/).pop() ?? "").find(url => url.endsWith(".gkg.csv.zip"))?.replace(/^http:\/\//, "https://") ?? null;
  const stats: GdeltStats = { file: null, records: 0, matched: 0, stored: 0, sites: 0 };
  if (!newest) return stats;
  const matches = watchTermMatcher(await watchTermList(MAX_TERMS));
  if (!matches) return stats;
  let tsv: string | null = null;
  for (let step = 0; step <= FALLBACK_STEPS; step++) {
    const file = step === 0 ? newest : earlierGdeltFile(newest, step);
    if (!file || file === lastFile) break;
    try {
      tsv = readFirstZipEntry(await fetchPublicBytes(file, { signal, timeoutMs: 60_000, maxBytes: MAX_ZIP_BYTES })).toString("utf8");
      stats.file = file;
      break;
    } catch (error) {
      // Not uploaded yet: try the quarter-hour before. Anything else is a real failure.
      if (!(error instanceof CrawlError && error.code === "http")) throw error;
    }
  }
  if (!tsv || !stats.file) return stats;
  stats.records = tsv.split("\n").length - 1;
  const stories = gkgStories(tsv, matches, MAX_STORIES_PER_FILE);
  stats.matched = stories.length;
  stats.stored = await storePooledArticles(stories);
  stats.sites = await noteDiscoveredSites(stories.map(story => story.link), "gdelt");
  lastFile = stats.file;
  return stats;
}
