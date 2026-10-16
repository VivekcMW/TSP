import type { PublicationDate, PublicationDateSource } from "@shared/article-quality";
import { canonicalHttpUrl } from "@shared/canonical-url";
import { DomUtils, ElementType, parseDocument } from "htmlparser2";

export function publicationDate(raw: unknown, source: PublicationDateSource, now = Date.now()): PublicationDate {
  const result: PublicationDate = { publishedAt: null, publicationDateSource: source, precision: "unknown", quality: "missing" };
  if (raw === undefined || raw === null || raw === "") return { ...result, publicationDateSource: "unknown" };
  if (typeof raw !== "string" || raw.length > 100) return { ...result, quality: "invalid" };
  const value = raw.trim();
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const clock = value.slice(10).split(/(?=Z$|[+-]\d{2}:\d{2}$)/i);
  const iso = isoDay && (value.length === 10 ||
    (/^T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/i.test(clock[0]) &&
      /^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i.test(clock[1] ?? ""))) ? isoDay : null;
  const rfcBody = value.replace(/^[a-z]{3},\s*/i, "");
  const rfcDate = /^(\d{1,2})\s+([a-z]{3})\s+(\d{4})\s+/i.exec(rfcBody);
  const rfc = rfcDate && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\s+(?:GMT|UT|[+-]\d{4})$/i.test(rfcBody.slice(rfcDate[0].length));
  if (!iso && !rfc) return { ...result, quality: "ambiguous" };
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return { ...result, quality: "invalid" };
  if (iso) {
    const calendar = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    if (calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return { ...result, quality: "invalid" };
  }
  if (rfc && rfcDate) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(rfcDate[2].toLowerCase());
    const days = new Date(Date.UTC(+rfcDate[3], month + 1, 0)).getUTCDate();
    if (month < 0 || +rfcDate[1] < 1 || +rfcDate[1] > days) return { ...result, quality: "invalid" };
  }
  if (time > now) return { ...result, quality: "future" };
  if (value.length === 10) return { ...result, precision: "day", day: value, quality: "valid" };
  return { ...result, publishedAt: new Date(time).toISOString(), precision: "instant", quality: "valid" };
}

/** Iterative DOM traversal excludes comments, JS strings and inert descendants. */
function* publicationElements(html: string) {
  const document = parseDocument(html.slice(0, 2_000_000));
  const inert = new Set(["template", "noscript", "textarea", "title", "style", "xmp", "iframe", "noembed", "noframes", "plaintext"]);
  const pending = [...document.children].reverse();
  while (pending.length) {
    const element = pending.pop()!;
    if (element.type !== ElementType.Tag && element.type !== ElementType.Script) continue;
    if (inert.has(element.name)) continue;
    if (element.name === "meta" || element.name === "script") {
      yield element;
      continue;
    }
    for (let index = element.children.length - 1; index >= 0; index--) pending.push(element.children[index]);
  }
}

/** Parse bounded HTML BEFORE scripts are cleaned. Never execute scripts. */
export function extractPublicationDate(html: string, url: string, now = Date.now()): PublicationDate {
  const candidates: PublicationDate[] = [];
  const canonical = canonicalHttpUrl(url);
  let visited = 0;
  const visit = (value: unknown, depth: number) => {
    if (++visited > 100 || depth > 6 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.slice(0, 30).forEach(v => visit(v, depth + 1)); return; }
    const node = value as Record<string, unknown>;
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    const page = node.mainEntityOfPage;
    const identity = [node.url, node["@id"], typeof page === "object" && page ? (page as Record<string, unknown>)["@id"] : page];
    if (types.some(t => typeof t === "string" && /^(?:NewsArticle|Article|BlogPosting|ReportageNewsArticle)$/.test(t)) &&
      canonical && identity.some(id => typeof id === "string" && canonicalHttpUrl(id) === canonical) && node.datePublished !== undefined) {
      candidates.push(publicationDate(node.datePublished, "jsonld-datePublished", now));
    }
    // Do not descend into related stories, ItemLists or arbitrary nested objects.
    if (node["@graph"]) visit(node["@graph"], depth + 1);
  };
  let scripts = 0;
  for (const element of publicationElements(html)) {
    if (element.name === "meta") {
      const supported = ["name", "property", "itemprop"].some(attribute =>
        ["article:published_time", "datepublished"].includes(element.attribs[attribute]?.trim().toLowerCase()));
      if (supported) candidates.push(publicationDate(element.attribs.content, "article-meta", now));
      continue;
    }
    if (element.attribs.type?.trim().toLowerCase() !== "application/ld+json" || ++scripts > 8) continue;
    const raw = DomUtils.textContent(element);
    if (raw.length > 64_000) continue;
    try { visit(JSON.parse(raw), 0); } catch { /* Invalid metadata is not evidence. */ }
  }
  const valid = candidates.filter(c => c.quality === "valid");
  const days = new Set(valid.map(c => c.day ?? c.publishedAt?.slice(0, 10)));
  const instants = new Set(valid.filter(c => c.precision === "instant").map(c => c.publishedAt));
  if (days.size > 1 || instants.size > 1) return { publishedAt: null, publicationDateSource: "unknown", precision: "unknown", quality: "conflicting" };
  // Stable provenance/diagnostics, independent of DOM candidate order. Prefer
  // instant precision, then meta over JSON-LD; no invalid candidate masks valid.
  const stable = (a: PublicationDate, b: PublicationDate) => {
    const key = (c: PublicationDate) => `${c.precision === "instant" ? "0" : "1"}:${c.quality}:${c.publicationDateSource}`;
    if (key(a) === key(b)) return 0;
    return key(a) < key(b) ? -1 : 1;
  };
  return (valid.length ? valid : candidates).sort(stable)[0] ?? publicationDate(null, "unknown", now);
}