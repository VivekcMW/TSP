import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateSitemap } from "../server/public-seo";
import { generateLlmsTxt, generateRss } from "./discovery-files";

const PUBLIC_DIR = resolve("client/public");

export { generateSitemap };

/** Regenerates the committed discovery files from the page catalogue. Runs on every build. */
export async function writeSearchFiles() {
  await writeFile(resolve(PUBLIC_DIR, "sitemap.xml"), generateSitemap(), "utf8");
  await writeFile(resolve(PUBLIC_DIR, "llms.txt"), generateLlmsTxt(), "utf8");
  await writeFile(resolve(PUBLIC_DIR, "rss.xml"), generateRss(), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeSearchFiles().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
