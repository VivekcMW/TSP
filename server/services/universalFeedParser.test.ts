import { describe, expect, it } from "vitest";
import { decodeHtmlText, feedTitle, parseFeedContent, PublicationFeedParser, stripHtml } from "./universalFeedParser";

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

describe("feed text cleanup", () => {
  it("strips whole tags even when quoted attribute values contain markup or are very long", () => {
    const html = '<div data-props="{&quot;html&quot;:&quot;<a href=x>Privacy</a>&quot;}" id="r">Judge rules</div>'
      + `<img style="${"x".repeat(3000)}" src="a.png">Body`;
    expect(stripHtml(html)).toBe("Judge rules Body");
  });

  it("drops a tag cut off at either end of an excerpt but keeps prose with comparison signs", () => {
    expect(stripHtml('class="lead" data-x="1">Rates rise <img src="chart.png')).toBe("Rates rise");
    expect(stripHtml("Margins < 5% and growth > 2x")).toBe("Margins < 5% and growth > 2x");
  });

  it("decodes titles that were encoded twice", () => {
    expect(decodeHtmlText("&#x27;AI-trade&#x27; bust &amp; tax &#8217;s")).toBe("'AI-trade' bust & tax \u2019s");
    expect(feedTitle("&lt;b&gt;Budget&lt;/b&gt; 2027 &mdash; what changes")).toBe("Budget 2027 \u2014 what changes");
    expect(feedTitle(undefined)).toBe("Untitled");
    expect(decodeHtmlText("A&ensp;|&ensp;B &middot; Caf&eacute; &unknown; &AMP;")).toBe("A | B \u00b7 Caf\u00e9 &unknown; &");
    expect(decodeHtmlText("&toString; &constructor;")).toBe("&toString; &constructor;");
  });
});
