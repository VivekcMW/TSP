import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { precompressAssets } from "./precompress";
import { precompressedAssets } from "./static";

// Visitors abroad download the app's scripts over long links; compressed copies cut them to about a third.
const script = `export const words = ${JSON.stringify(Array.from({ length: 4000 }, (_, i) => `word-${i % 50}`))};\n`;
const styles = `.a{color:red}\n`.repeat(400);
let dir: string;
let app: express.Express;

// The test client decompresses bodies itself, so the transfer size proves what was sent.
const sentBytes = (res: request.Response) => Number(res.headers["content-length"]);
const raw = (res: request.Response, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tsp-assets-"));
  mkdirSync(path.join(dir, "fonts"));
  writeFileSync(path.join(dir, "index-abc123.js"), script);
  writeFileSync(path.join(dir, "index-abc123.css"), styles);
  writeFileSync(path.join(dir, "tiny-abc123.js"), "export{};");
  writeFileSync(path.join(dir, "photo-abc123.webp"), Buffer.alloc(4096, 7));
  writeFileSync(path.join(dir, "fonts", "brand-abc123.svg"), `<svg>${"<g/>".repeat(500)}</svg>`);
  precompressAssets(dir);

  app = express();
  app.use("/assets", precompressedAssets(dir), express.static(dir, { maxAge: "1y", immutable: true }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("precompressAssets", () => {
  it("writes brotli and gzip copies of scripts, styles and SVGs that decompress to the original", () => {
    expect(brotliDecompressSync(readFileSync(path.join(dir, "index-abc123.js.br"))).toString()).toBe(script);
    expect(gunzipSync(readFileSync(path.join(dir, "index-abc123.js.gz"))).toString()).toBe(script);
    expect(existsSync(path.join(dir, "index-abc123.css.br"))).toBe(true);
    expect(existsSync(path.join(dir, "fonts", "brand-abc123.svg.br"))).toBe(true);
    expect(readFileSync(path.join(dir, "index-abc123.js.br")).length).toBeLessThan(script.length / 3);
  });

  it("skips files too small to gain and formats that are already compressed", () => {
    expect(existsSync(path.join(dir, "tiny-abc123.js.br"))).toBe(false);
    expect(existsSync(path.join(dir, "photo-abc123.webp.br"))).toBe(false);
    expect(existsSync(path.join(dir, "photo-abc123.webp.gz"))).toBe(false);
  });
});

describe("precompressedAssets", () => {
  it("sends brotli to browsers that accept it, with the script's type and long caching", async () => {
    const res = await request(app).get("/assets/index-abc123.js").set("Accept-Encoding", "gzip, deflate, br").buffer(true).parse(raw);
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["content-type"]).toMatch(/^text\/javascript|^application\/javascript/);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers.vary).toMatch(/Accept-Encoding/);
    expect(sentBytes(res)).toBe(readFileSync(path.join(dir, "index-abc123.js.br")).length);
    expect(res.body.toString()).toBe(script);
  });

  it("falls back to gzip, then to the original file", async () => {
    const gzip = await request(app).get("/assets/index-abc123.css").set("Accept-Encoding", "gzip").buffer(true).parse(raw);
    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(gzip.headers["content-type"]).toMatch(/^text\/css/);
    expect(sentBytes(gzip)).toBe(readFileSync(path.join(dir, "index-abc123.css.gz")).length);
    expect(gzip.body.toString()).toBe(styles);

    const plain = await request(app).get("/assets/index-abc123.js").set("Accept-Encoding", "identity").buffer(true).parse(raw);
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.headers.vary).toMatch(/Accept-Encoding/);
    expect(sentBytes(plain)).toBe(Buffer.byteLength(script));
    expect(plain.body.toString()).toBe(script);
  });

  it("honours a browser that refuses brotli", async () => {
    const res = await request(app).get("/assets/index-abc123.js").set("Accept-Encoding", "br;q=0, gzip").buffer(true).parse(raw);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("serves files in subfolders, and leaves other files and methods alone", async () => {
    const svg = await request(app).get("/assets/fonts/brand-abc123.svg").set("Accept-Encoding", "br").buffer(true).parse(raw);
    expect(svg.headers["content-encoding"]).toBe("br");
    expect(svg.headers["content-type"]).toMatch(/^image\/svg\+xml/);

    const photo = await request(app).get("/assets/photo-abc123.webp").set("Accept-Encoding", "br");
    expect(photo.status).toBe(200);
    expect(photo.headers["content-encoding"]).toBeUndefined();

    const post = await request(app).post("/assets/index-abc123.js").set("Accept-Encoding", "br");
    expect(post.headers["content-encoding"]).toBeUndefined();
  });

  it("never serves a compressed copy for a path outside the assets folder", async () => {
    const res = await request(app).get("/assets/..%2findex-abc123.js").set("Accept-Encoding", "br");
    expect(res.headers["content-encoding"]).toBeUndefined();
    const missing = await request(app).get("/assets/nope.js").set("Accept-Encoding", "br");
    expect(missing.status).toBe(404);
  });
});
