import { describe, expect, it } from "vitest";
import { parseFeedContent, PublicationFeedParser } from "./universalFeedParser";

const rss = (title: string) => `<rss version="2.0"><channel><title>News</title><item><title>${title}</title><link>https://example.test/story</link></item></channel></rss>`;

describe("independent feed parsing", () => {
  it.each([
    "<!-- no feed root -->",
    '<?xml version="1.0"?>',
    "<!DOCTYPE html>",
  ])("settles rootless XML after a valid feed: %s", async (xml) => {
    expect(await parseFeedContent(rss("Before"))).toHaveLength(1);
    expect(await parseFeedContent(xml)).toBeNull();
    expect(await parseFeedContent(rss("After"))).toMatchObject([{ title: "After" }]);
  }, 1000);

  it("isolates concurrent XML parses and preserves custom fields", async () => {
    const parser = new PublicationFeedParser({
      xml2js: { async: true, chunkSize: 16 },
      customFields: { item: [["source", "publisher"]] },
    });
    const feed = (title: string) => rss(title).replace("</item>", `<source>${title} publisher</source></item>`);
    const results = await Promise.all([
      parser.parseString(feed("First")),
      parser.parseString(feed("Second")),
    ]);
    expect(results.map(result => result.items[0])).toMatchObject([
      { title: "First", publisher: "First publisher" },
      { title: "Second", publisher: "Second publisher" },
    ]);
  }, 1000);
});
