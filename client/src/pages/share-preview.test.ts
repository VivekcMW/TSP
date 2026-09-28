import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// LinkedIn, X and chat apps read these tags from the raw HTML without running JavaScript.
const root = path.resolve(import.meta.dirname, "../../..");
const html = readFileSync(path.join(root, "client/index.html"), "utf8");
const meta = (attribute: "property" | "name", key: string) =>
  html.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`))?.[1];

describe("link previews", () => {
  it("give shared links a large image, at an absolute address, with its size and a description", () => {
    expect(meta("property", "og:image")).toBe("https://www.thesocialpundit.com/og-image.jpg");
    expect(meta("property", "og:image:width")).toBe("1200");
    expect(meta("property", "og:image:height")).toBe("630");
    expect(meta("property", "og:image:alt")).toBeTruthy();
    expect(meta("name", "twitter:card")).toBe("summary_large_image");
    expect(meta("name", "twitter:image")).toBe("https://www.thesocialpundit.com/og-image.jpg");
  });

  it("ship the preview image itself", () => {
    const bytes = readFileSync(path.join(root, "client/public/og-image.jpg"));
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(statSync(path.join(root, "client/public/og-image.jpg")).size).toBeLessThan(300 * 1024);
  });
});
