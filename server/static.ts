import express, { type Express, type RequestHandler } from "express";
import fs from "fs";
import path from "path";
import { filesUnder } from "./precompress";

const ENCODINGS = [["br", ".br"], ["gzip", ".gz"]] as const;
const LONG_CACHE = { maxAge: "1y", immutable: true };

/**
 * Sends the build-time `.br` or `.gz` copy of an asset (see precompress.ts) to browsers that
 * accept it, and passes everything else on. Only copies found in `dir` at startup are served,
 * so a request path never reaches the filesystem unchecked.
 */
export function precompressedAssets(dir: string): RequestHandler {
  const available = new Set(Array.from(filesUnder(dir), file => `/${path.relative(dir, file).split(path.sep).join("/")}`));
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const variants = ENCODINGS.filter(([, suffix]) => available.has(req.path + suffix));
    if (variants.length === 0) return next();
    res.vary("Accept-Encoding");
    // No header means "anything", which would include brotli for clients that can't decode it.
    if (!req.headers["accept-encoding"]) return next();
    // Checked one at a time so brotli wins whenever it's accepted, whatever the header's order.
    const chosen = variants.find(([encoding]) => req.acceptsEncodings(encoding) === encoding);
    if (!chosen) return next();
    res.type(path.extname(req.path));
    res.setHeader("Content-Encoding", chosen[0]);
    res.sendFile(req.path.slice(1) + chosen[1], { root: dir, ...LONG_CACHE }, error => {
      if (error) next(error);
    });
  };
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Vite emits content-hashed filenames under /assets/ (e.g. index-CEo2F5WN.js)
  // that never change for a given build — cache them for a year so the CDN in
  // front of the app (and browsers) can actually cache them instead of
  // re-fetching every large bundle on every page load, which is what was
  // causing intermittent 500s for the biggest chunks on a resource-constrained
  // instance. Everything else (index.html, robots.txt, etc.) keeps the
  // default no-long-cache behavior since those aren't safe to cache long.
  const assets = path.resolve(distPath, "assets");
  app.use("/assets", precompressedAssets(assets), express.static(assets, LONG_CACHE));
  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
