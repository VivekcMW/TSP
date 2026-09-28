import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { earlierGdeltFile, gkgStories, readFirstZipEntry, watchTermMatcher } from "./gdelt";

/** A one-entry zip as any zip tool would write it: local file header, name, deflated data. */
function zipOf(name: string, content: string, stored = false) {
  const data = Buffer.from(content, "utf8");
  const body = stored ? data : deflateRawSync(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6); header.writeUInt16LE(stored ? 0 : 8, 8);
  header.writeUInt32LE(body.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26); header.writeUInt16LE(0, 28);
  return Buffer.concat([header, Buffer.from(name), body, Buffer.from("PK\x01\x02 trailing central directory")]);
}

const record = (fields: Partial<Record<"id" | "date" | "collection" | "source" | "url" | "persons" | "orgs" | "title", string>>) => {
  const columns = new Array(27).fill("");
  columns[0] = fields.id ?? "20260928120000-1"; columns[1] = fields.date ?? "20260928120000"; columns[2] = fields.collection ?? "1";
  columns[3] = fields.source ?? "pharmadaily.test"; columns[4] = fields.url ?? "https://pharmadaily.test/story";
  columns[12] = fields.persons ?? ""; columns[14] = fields.orgs ?? "";
  columns[26] = fields.title === undefined ? "" : `<PAGE_TITLE>${fields.title}</PAGE_TITLE>`;
  return columns.join("\t");
};

describe("readFirstZipEntry", () => {
  it("inflates the first entry of a deflated zip, or copies a stored one", () => {
    expect(readFirstZipEntry(zipOf("a.csv", "hello\tworld\n")).toString()).toBe("hello\tworld\n");
    expect(readFirstZipEntry(zipOf("a.csv", "stored", true)).toString()).toBe("stored");
  });

  it("rejects anything that isn't a zip", () => {
    expect(() => readFirstZipEntry(Buffer.from("not a zip file at all, really not"))).toThrow(/zip/i);
  });
});

describe("gkgStories", () => {
  const matcher = watchTermMatcher([{ term: "drug pricing", kind: "keyword" }, { term: "roche", kind: "company" }, { term: "tukaram mundhe", kind: "person" }, { term: "ai", kind: "keyword" }])!;

  it("keeps web records whose title, organisations or people mention a watched term", () => {
    const tsv = [
      record({ title: "NPPA tightens drug pricing rules", url: "https://pharmadaily.test/nppa" }),
      record({ id: "2", orgs: "Roche Holding,120;Novartis,300", title: "Swiss pharma results", url: "https://swiss.test/results", source: "swiss.test", date: "20260927083000" }),
      record({ id: "3", persons: "Tukaram Mundhe,40", title: "", url: "https://mumbai.test/devices", source: "mumbai.test" }),
      record({ id: "4", title: "Football results", url: "https://sport.test/a" }),
      record({ id: "5", title: "Brain scans and AI", url: "https://ai.test/a", collection: "2" }),
      record({ id: "6", title: "Drug pricing again", url: "javascript:alert(1)" }),
    ].join("\n");
    const stories = gkgStories(tsv, matcher, 10);
    expect(stories.map(story => story.link)).toEqual(["https://pharmadaily.test/nppa", "https://swiss.test/results", "https://mumbai.test/devices"]);
    expect(stories[0]).toMatchObject({ title: "NPPA tightens drug pricing rules", source: "pharmadaily.test", publishedAt: "2026-09-28T12:00:00.000Z" });
    expect(stories[1]).toMatchObject({ publishedAt: "2026-09-27T08:30:00.000Z" });
    // No page title: the record is still a lead, named after its site until the crawler reads it.
    expect(stories[2].title).toBe("mumbai.test");
  });

  it("matches whole words only and stops at the limit", () => {
    const tsv = [record({ title: "Braille and pain relief" }), record({ id: "2", title: "AI in pharma", url: "https://a.test/1" }), record({ id: "3", title: "AI again", url: "https://a.test/2" })].join("\n");
    expect(gkgStories(tsv, matcher, 1).map(story => story.link)).toEqual(["https://a.test/1"]);
  });
});

describe("earlierGdeltFile", () => {
  it("steps back one quarter-hour, across midnight too", () => {
    expect(earlierGdeltFile("https://data.gdeltproject.org/gdeltv2/20260928190000.gkg.csv.zip")).toBe("https://data.gdeltproject.org/gdeltv2/20260928184500.gkg.csv.zip");
    expect(earlierGdeltFile("https://data.gdeltproject.org/gdeltv2/20260929000000.gkg.csv.zip")).toBe("https://data.gdeltproject.org/gdeltv2/20260928234500.gkg.csv.zip");
    expect(earlierGdeltFile("https://data.gdeltproject.org/gdeltv2/20260928190000.gkg.csv.zip", 4)).toBe("https://data.gdeltproject.org/gdeltv2/20260928180000.gkg.csv.zip");
    expect(earlierGdeltFile("https://data.gdeltproject.org/gdeltv2/lastupdate.txt")).toBeNull();
  });
});
