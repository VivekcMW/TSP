import { describe, expect, it } from "vitest";
import { canonicalHttpUrl } from "./canonical-url";

describe("canonical HTTP(S) identity", () => {
  it("normalizes host/default port and removes fragments and only known tracking keys", () => {
    expect(canonicalHttpUrl("HTTPS://NEWS.test:443/Story/?b=2&utm_source=x&a=1&fbclid=y#part"))
      .toBe("https://news.test/Story/?b=2&a=1");
  });
  it.each([
    "https://news.test/Story", "https://news.test/story", "https://news.test/Story/", "http://news.test/Story",
    "https://news.test/Story?a=1&b=2", "https://news.test/Story?b=2&a=1", "https://news.test/Story?a=1&a=2",
    "https://news.test/Story?ref=meaningful&source=news&utm_unknown=keep", "https://news.test/Story?q=a%20b&x=~+%2f",
    "https://news.test/Story?redirect=https%3A%2F%2Felsewhere.test%2F", "https://news.test/Story?UTM_SOURCE=case-sensitive",
  ])("preserves meaningful URL distinctions and is idempotent: %s", value => {
    expect(canonicalHttpUrl(value)).toBe(value);
    expect(canonicalHttpUrl(canonicalHttpUrl(value)!)).toBe(value);
  });
  it.each(["invalid", "//news.test/story", "ftp://news.test/story", "javascript:alert(1)", "https://user:password@news.test/"])("rejects %s", value => {
    expect(canonicalHttpUrl(value)).toBeNull();
  });
  it("preserves unknown percent-encoded keys but removes explicitly encoded tracking names", () => {
    expect(canonicalHttpUrl("https://news.test/?%75tm_source=x&%ZZ=y&signature=a%2Fb#anchor"))
      .toBe("https://news.test/?%ZZ=y&signature=a%2Fb");
  });
  it.each([
    ["?", ""], ["??", "??"], ["???", "???"],
    ["??key=1&?key=2&x=a%20b", "??key=1&?key=2&x=a%20b"],
    ["?utm_source=x&?key=1&?key=2", "??key=1&?key=2"],
    ["?fbclid=x&??key=1&x=2&x=1&utm_medium=email", "???key=1&x=2&x=1"],
    ["?utm_source=x&?utm_source=meaningful", "??utm_source=meaningful"],
    ["?%75tm_source=x&?&gclid=y", "??"],
    ["?utm_source=x&??", "???"],
    ["?utm_source=x", ""],
  ])("preserves literal question marks when tracking removal exposes them: %s", (query, expected) => {
    const result = `https://news.test/Story${expected}`;
    expect(canonicalHttpUrl(`https://news.test/Story${query}#fragment`)).toBe(result);
    for (let i = 0; i < 3; i++) expect(canonicalHttpUrl(result)).toBe(result);
  });
});