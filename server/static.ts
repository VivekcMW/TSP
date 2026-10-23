import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { filesUnder } from "./precompress";
import { publicSeoForPath, renderInitialSeo, replaceJsonLd } from "./public-seo";
import { PRICING_DATA_ID, pricingOffersJsonLd, type PublicBillingPlan } from "../shared/public-billing";

const ENCODINGS = [["br", ".br"], ["gzip", ".gz"]] as const;
const LONG_CACHE = { maxAge: "1y", immutable: true };
const NOINDEX_PATHS = [
  "/dashboard",
  "/admin",
  "/onboarding",
  "/sign-in",
  "/sign-up",
  "/reset-password",
  "/verify-email",
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

/**
 * Makes the HTML agree with the X-Robots-Tag header: the template carries the homepage's
 * "index, follow" and canonical, and conflicting signals leave crawlers to guess.
 */
export function asNoindexDocument(html: string): string {
  return html
    .replace(/<link[^>]*rel="canonical"[^>]*>/i, "")
    .replace(/<meta[^>]*name="robots"[^>]*>/i, '<meta data-rh="true" name="robots" content="noindex, nofollow" />');
}

/** Strips the query string and hash from a raw request URL, leaving the route path. */
export function requestPathname(originalUrl: string): string {
  return originalUrl.split(/[?#]/, 1)[0] || "/";
}

/**
 * Puts a page's prerendered markup (script/prerender.ts) into the initial HTML. The React root
 * stays hidden beside it until the app can render the page itself (client/src/lib/prerender.ts).
 */
export function withPrerenderedBody(html: string, markup: string): string {
  const root = '<div id="root"></div>';
  if (!html.includes(root)) return html;
  return html.replace(root, () => `<div id="prerendered">${markup}</div><div id="root" hidden></div>`);
}

/** Prerendered markup keyed by route path; empty when the build produced none (e.g. in tests). */
export function loadPrerenderedPages(file: string): Map<string, string> {
  if (!fs.existsSync(file)) return new Map();
  return new Map(Object.entries(JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>));
}

type CompressedDocument = { br: Buffer; gzip: Buffer };

/**
 * Sends an HTML document brotli- or gzip-compressed when the client accepts it. Documents are
 * compressed once per key. Dynamic pricing uses a request-scoped cache.
 */
function sendDocument(req: Request, res: Response, html: string, key: string, cache: Map<string, CompressedDocument>) {
  res.vary("Accept-Encoding");
  res.type("html");
  // No header means "anything", which would include brotli for clients that can't decode it.
  // Checked one at a time so brotli wins whenever it's accepted, whatever the header's order.
  const encoding = !req.headers["accept-encoding"] ? undefined
    : (["br", "gzip"] as const).find(candidate => req.acceptsEncodings(candidate) === candidate);
  if (!encoding) {
    res.send(html);
    return;
  }
  let compressed = cache.get(key);
  if (!compressed) {
    const source = Buffer.from(html, "utf8");
    compressed = {
      br: brotliCompressSync(source, {
        params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT, [constants.BROTLI_PARAM_SIZE_HINT]: source.length },
      }),
      gzip: gzipSync(source, { level: constants.Z_BEST_COMPRESSION }),
    };
    cache.set(key, compressed);
  }
  res.setHeader("Content-Encoding", encoding);
  res.send(encoding === "br" ? compressed.br : compressed.gzip);
}

/**
 * Serves the SPA shell with metadata, and the prerendered page where one exists, for the
 * requested route. Mounted last, so it only sees requests that no static file matched.
 */
export type PricingRenderer = () => Promise<{ markup: string; plans: PublicBillingPlan[] }>;

export function seoDocumentHandler(indexTemplate: string, prerendered: ReadonlyMap<string, string> = new Map(), renderPricing?: PricingRenderer): RequestHandler {
  // Bounded: one entry per public route plus the shared app shell.
  const compressed = new Map<string, CompressedDocument>();
  return async (req, res) => {
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
    if (!rendered.indexable) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      const normalized = pathname.replace(/\/+$/, "");
      const knownShell = NOINDEX_PATHS.includes(normalized) ||
        ["/dashboard/", "/admin/", "/sign-in/", "/sign-up/"].some(prefix => pathname.startsWith(prefix));
      if (knownShell) {
        sendDocument(req, res, asNoindexDocument(rendered.html), "", compressed);
      } else {
        res.status(404);
        const html = asNoindexDocument(rendered.html)
          .replace(/<title(?:\s[^>]*)?>[\s\S]*?<\/title>/i, '<title data-rh="true">Page not found | TheSocialPundit</title>');
        sendDocument(req, res, withPrerenderedBody(html, prerendered.get("/404") ?? "<main><h1>Page not found</h1><p>This page does not exist.</p><a href=\"/\">Go home</a></main>"), "/404", compressed);
      }
      return;
    }
    const route = new URL(publicSeoForPath(pathname)!.canonical).pathname;
    if (route === "/pricing" && renderPricing) {
      res.setHeader("Cache-Control", "no-store");
      try {
        const { markup, plans } = await renderPricing();
        if (!plans.length) throw new Error("Public plan catalogue is empty");
        const bootstrap = JSON.stringify({ plans }).replaceAll("<", "\\u003c");
        const pageJsonLd = publicSeoForPath(pathname)?.jsonLd;
        const jsonLd = [...(pageJsonLd ? [pageJsonLd].flat() : []), pricingOffersJsonLd(plans)];
        const html = withPrerenderedBody(replaceJsonLd(rendered.html, jsonLd), markup)
          .replace("</head>", `<script id="${PRICING_DATA_ID}" type="application/json">${bootstrap}</script></head>`);
        sendDocument(req, res, html, route, new Map());
      } catch (error) {
        console.error("Public pricing document could not be rendered", error);
        res.status(503).setHeader("Retry-After", "60");
        const html = withPrerenderedBody(rendered.html, '<main><h1>Current pricing is temporarily unavailable.</h1><p>We could not confirm the live plan catalogue. No prices are shown.</p><a href="/pricing">Retry pricing</a></main>');
        sendDocument(req, res, html, route, new Map());
      }
      return;
    }
    const markup = prerendered.get(route);
    sendDocument(req, res, markup ? withPrerenderedBody(rendered.html, markup) : rendered.html, route, compressed);
  };
}

/**
 * Sends the build-time `.br` or `.gz` copy of an asset (see precompress.ts) to browsers that
 * accept it, and passes everything else on. Only copies found in `dir` at startup are served,
 * so a request path never reaches the filesystem unchecked.
 */
export function precompressedAssets(dir: string, sendOptions: { maxAge?: string; immutable?: boolean } = LONG_CACHE): RequestHandler {
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
    res.sendFile(req.path.slice(1) + chosen[1], { root: dir, ...sendOptions }, error => {
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
  // The raw template would be a second, metadata-less copy of the homepage.
  app.get("/index.html", (_req, res) => res.redirect(301, "/"));

  // Vite emits content-hashed filenames under /assets/ (e.g. index-CEo2F5WN.js)
  // that never change for a given build — cache them for a year so the CDN in
  // front of the app (and browsers) can actually cache them instead of
  // re-fetching every large bundle on every page load, which is what was
  // causing intermittent 500s for the biggest chunks on a resource-constrained
  // instance. Everything else (index.html, robots.txt, etc.) keeps the
  // default no-long-cache behavior since those aren't safe to cache long.
  const assets = path.resolve(distPath, "assets");
  app.use("/assets", precompressedAssets(assets), express.static(assets, LONG_CACHE));
  // Root files such as sitemap.xml: compressed, but without the long cache — they change per deploy.
  app.use(precompressedAssets(distPath, {}), express.static(distPath, { index: false }));

  // Serve route-specific metadata and the prerendered page in the initial HTML so crawlers and
  // link unfurlers do not need to execute the React bundle to read the page.
  const indexTemplate = fs.readFileSync(path.resolve(distPath, "index.html"), "utf8");
  const prerendered = loadPrerenderedPages(path.resolve(__dirname, "prerender.json"));
  const rendererUrl = pathToFileURL(path.resolve(__dirname, "ssr/entry-server.js")).href;
  app.use("*", seoDocumentHandler(indexTemplate, prerendered, async () => {
    const { readPublicBillingPlans } = await import("./services/public-billing");
    const renderer = await import(rendererUrl) as { render(path: string, pricing: { plans: PublicBillingPlan[] }): Promise<string> };
    const plans = await readPublicBillingPlans();
    return { plans, markup: await renderer.render("/pricing", { plans }) };
  }));
}
