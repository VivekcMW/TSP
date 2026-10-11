import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateSitemap } from "../server/public-seo";

const OUTPUT = resolve("client/public/sitemap.xml");

export { generateSitemap };

export async function writeSearchFiles() {
  await writeFile(OUTPUT, generateSitemap(), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeSearchFiles().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
