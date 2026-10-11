import express, { type Express, type RequestHandler } from "express";
import fs from "fs";
import path from "path";
import { filesUnder } from "./precompress";
import { renderInitialSeo } from "./public-seo";

const ENCODINGS = [["br", ".br"], ["gzip", ".gz"]] as const;
const LONG_CACHE = { maxAge: "1y", immutable: true };
const NOINDEX_PATHS = [
  "/dashboard",
  "/admin",
  "/onboarding",
  "/sign-in",
  "/sign-up",
  "/reset-password",
  "/complete-registration",
  "/accept-invite",
  "/email-preferences",
  "/invitation-preferences",
  // Public but intentionally unindexed: honest "coming soon" placeholders. Thin pages like
  // these dilute site quality, so they stay out of the index and out of sitemap.xml until
  // they carry real content.
  "/case-studies",
  "/careers",
];

export const indexingHeaders: RequestHandler = (req, res, next) => {
  if (req.path.startsWith("/api/") || NOINDEX_PATHS.some(pathname => req.path === pathname || req.path.startsWith(`${pathname}/`))) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
  }
  next();
};

/** Strips the query string and hash from a raw request URL, leaving the route path. */
export function requestPathname(originalUrl: string): string {
  return originalUrl.split(/[?#]/, 1)[0] || "/";
}

/**
 * Serves the SPA shell with metadata for the requested route. Mounted last, so it only sees
 * requests that no static file matched.
 */
export function seoDocumentHandler(indexTemplate: string): RequestHandler {
  return (req, res) => {
    // Inside `app.use("*")` Express strips the mount path, so `req.path` is always "/".
    // The requested route only survives on `originalUrl`.
    const pathname = requestPathname(req.originalUrl);
    // Anything that looks like a file was not matched by express.static above. Replying with
    // the SPA shell and a 200 would make a missing sitemap.xml or asset look like a real page.
    if (path.extname(pathname)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.status(404).type("txt").send("Not found");
      return;
    }
    const rendered = renderInitialSeo(indexTemplate, pathname);
    if (!rendered.indexable) res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(rendered.html);
  };
}

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

  app.use(indexingHeaders);

  // Vite emits content-hashed filenames under /assets/ (e.g. index-CEo2F5WN.js)
  // that never change for a given build — cache them for a year so the CDN in
  // front of the app (and browsers) can actually cache them instead of
  // re-fetching every large bundle on every page load, which is what was
  // causing intermittent 500s for the biggest chunks on a resource-constrained
  // instance. Everything else (index.html, robots.txt, etc.) keeps the
  // default no-long-cache behavior since those aren't safe to cache long.
  const assets = path.resolve(distPath, "assets");
  app.use("/assets", precompressedAssets(assets), express.static(assets, LONG_CACHE));
  app.use(express.static(distPath, { index: false }));

  // Serve route-specific metadata in the initial HTML so crawlers and link
  // unfurlers do not need to execute the React bundle to identify the page.
  const indexTemplate = fs.readFileSync(path.resolve(distPath, "index.html"), "utf8");
  app.use("*", seoDocumentHandler(indexTemplate));
}
