import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CAPTURE_NOTE_LIMIT, captureCors, captureNoteText, generateCaptureToken, hashSecretToken, isCapturePath, isCaptureTokenFormat, readBearerToken,
} from "./captureTokens";

describe("capture tokens", () => {
  it("generates prefixed 256-bit tokens and stores only their SHA-256 and last four characters", () => {
    const generated = Array.from({ length: 20 }, generateCaptureToken);
    expect(new Set(generated.map(entry => entry.token)).size).toBe(20);
    for (const { token, hash, hint } of generated) {
      expect(token).toMatch(/^tsp_cap_[A-Za-z0-9_-]{43}$/);
      expect(isCaptureTokenFormat(token)).toBe(true);
      expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
      expect(hash).not.toContain(token.slice(8));
      expect(hint).toBe(token.slice(-4));
    }
  });

  it("hashes deterministically and distinguishes near-identical tokens", () => {
    const { token } = generateCaptureToken();
    expect(hashSecretToken(token)).toBe(hashSecretToken(token));
    expect(hashSecretToken(`${token.slice(0, -1)}A`)).not.toBe(hashSecretToken(`${token.slice(0, -1)}B`));
  });

  it("reads only well-formed Bearer headers and rejects other token shapes", () => {
    const { token } = generateCaptureToken();
    expect(readBearerToken(`Bearer ${token}`)).toBe(token);
    expect(readBearerToken(`bearer   ${token} `)).toBe(token);
    expect(readBearerToken(`Basic ${token}`)).toBeNull();
    expect(readBearerToken(undefined)).toBeNull();
    for (const bad of ["tsp_cap_short", `tsp_key_${token.slice(8)}`, `${token}x`, `tsp_cap_${"!".repeat(43)}`]) expect(isCaptureTokenFormat(bad)).toBe(false);
  });

  it("matches the capture path with a trailing slash or different case only", () => {
    expect(["/api/capture", "/api/capture/", "/API/Capture"].every(isCapturePath)).toBe(true);
    expect(["/api/captures", "/api/capture/x", "/api/inputs"].some(isCapturePath)).toBe(false);
  });
});

describe("captureCors", () => {
  const app = express();
  app.use(captureCors);
  app.post("/api/capture", (_req, res) => { res.json({ ok: true }); });

  it("answers preflight for any origin without allowing credentials", async () => {
    const response = await request(app).options("/api/capture").set("Origin", "chrome-extension://abcdefghijklmnop")
      .set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", "authorization,content-type").expect(204);
    expect(response.headers).toMatchObject({
      "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type",
    });
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("adds the headers to the actual request and passes it on", async () => {
    const response = await request(app).post("/api/capture").set("Origin", "https://news.site.com").expect(200);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("captureNoteText", () => {
  it("returns nothing without a selection or note", () => {
    expect(captureNoteText({ title: "A page" })).toBeNull();
    expect(captureNoteText({ title: "A page", selection: "  ", note: "" })).toBeNull();
  });

  it("formats the selection, the note, or both", () => {
    expect(captureNoteText({ title: "Retail media in 2026", selection: "Ad spend\n  grew 20%.", note: "Use in Friday post" }))
      .toBe("From Retail media in 2026: “Ad spend grew 20%.” — Use in Friday post");
    expect(captureNoteText({ title: "Retail media", selection: "Quote only" })).toBe("From Retail media: “Quote only”");
    expect(captureNoteText({ title: "Retail media", note: "Just my thought" })).toBe("From Retail media: Just my thought");
  });

  it("stays within the note limit, keeping the user's note whole and shortening the quote", () => {
    const note = "n".repeat(700);
    const text = captureNoteText({ title: "t".repeat(400), selection: "s".repeat(2000), note })!;
    expect(text.length).toBeLessThanOrEqual(CAPTURE_NOTE_LIMIT);
    expect(text.endsWith(` — ${note}`)).toBe(true);
    expect(text).toMatch(/^From t{119}…: “s+…” — /);
  });

  it("shortens even a maximum-length note so the result is always storable", () => {
    expect(captureNoteText({ title: "Page", selection: "s".repeat(2000), note: "n".repeat(1000) })!.length).toBeLessThanOrEqual(CAPTURE_NOTE_LIMIT);
    expect(captureNoteText({ title: "Page", note: "n".repeat(1000) })!.length).toBeLessThanOrEqual(CAPTURE_NOTE_LIMIT);
  });
});
