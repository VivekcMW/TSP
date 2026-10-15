import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sitemapEntries } from "../server/public-seo";
import { generateLlmsFullTxt } from "./discovery-files";

const SSR_OUT = resolve("dist/ssr");
export const PRERENDER_MANIFEST = resolve("dist/prerender.json");

/** Every public route in the sitemap, as a path. */
export function prerenderPaths(): string[] {
  return sitemapEntries().map(entry => new URL(entry.loc).pathname);
}

/** Fails the build rather than shipping a page crawlers would read as empty or broken. */
export function assertCrawlable(path: string, markup: string) {
  const h1s = markup.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) throw new Error(`prerender ${path}: expected exactly one <h1>, found ${h1s}`);
  if (markup.includes('data-testid="loading-screen"')) throw new Error(`prerender ${path}: rendered the loading screen, not the page`);
  if (!/<p[\s>]/.test(markup)) throw new Error(`prerender ${path}: no paragraphs`);
}

/**
 * Renders every public page with the real React components (client/src/entry-server.tsx) and
 * writes them to dist/prerender.json, which server/static.ts inlines into the initial HTML.
 */
export async function prerenderPublicPages() {
  const { build } = await import("vite");
  const { default: viteConfig } = await import("../vite.config");
  await build({
    ...viteConfig,
    configFile: false,
    logLevel: "warn",
    // Bundled, not externalized: some dependencies ship CommonJS that Node can't import by name.
    ssr: { noExternal: true },
    build: { ssr: "src/entry-server.tsx", outDir: SSR_OUT, emptyOutDir: true, rollupOptions: {} },
  });
  try {
    const { render } = await import(pathToFileURL(resolve(SSR_OUT, "entry-server.js")).href) as { render(path: string): Promise<string> };
    const pages: Record<string, string> = {};
    for (const path of prerenderPaths()) {
      const markup = await render(path);
      assertCrawlable(path, markup);
      pages[path] = markup;
    }
    await writeFile(PRERENDER_MANIFEST, JSON.stringify(pages), "utf8");
    await writeFile(resolve("dist/public/llms-full.txt"), generateLlmsFullTxt(pages), "utf8");
    return Object.keys(pages).length;
  } finally {
    // Build-time only: the server never runs React.
    await rm(SSR_OUT, { recursive: true, force: true });
  }
}
