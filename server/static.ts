import express, { type Express } from "express";
import fs from "fs";
import path from "path";

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
  app.use(
    "/assets",
    express.static(path.resolve(distPath, "assets"), {
      maxAge: "1y",
      immutable: true,
    }),
  );
  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
