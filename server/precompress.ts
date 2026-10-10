import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

// Text formats only: images and fonts are already compressed.
const COMPRESSIBLE = /\.(?:js|mjs|css|svg|json|txt|html)$/;
// Below this, headers outweigh the saving.
const MIN_BYTES = 1024;

/** Every file under `dir`, as absolute paths; nothing when `dir` doesn't exist. */
export function* filesUnder(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* filesUnder(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Writes a `.br` and a `.gz` copy next to each script, stylesheet and SVG under `dir`, once at
 * build time, so the server sends small files without compressing on every request.
 * Returns how many files were compressed.
 */
export function precompressAssets(dir: string) {
  let compressed = 0;
  for (const file of Array.from(filesUnder(dir))) {
    if (!COMPRESSIBLE.test(file)) continue;
    const source = readFileSync(file);
    if (source.length < MIN_BYTES) continue;
    writeFileSync(`${file}.br`, brotliCompressSync(source, {
      params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: source.length },
    }));
    writeFileSync(`${file}.gz`, gzipSync(source, { level: constants.Z_BEST_COMPRESSION }));
    compressed++;
  }
  return compressed;
}
