import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { sitemapEntries } from "../public-seo";
import { canonicalHostRedirect, canonicalPathFor, canonicalPathRedirect, cloudRunHostNoindex } from "./canonicalHost";

const app = express();
app.use(canonicalHostRedirect);
app.use(canonicalPathRedirect);
app.use(cloudRunHostNoindex);
app.all("*", (_req, res) => res.send("served"));

describe("canonicalHostRedirect", () => {
  it("permanently moves pages on the bare domain to www, keeping path and query", async () => {
    const res = await request(app).get("/pricing?utm_source=x").set("Host", "thesocialpundit.com");
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("https://www.thesocialpundit.com/pricing?utm_source=x");
  });

  it("redirects the homepage and HEAD requests", async () => {
    expect((await request(app).get("/").set("Host", "TheSocialPundit.com")).headers.location).toBe("https://www.thesocialpundit.com/");
    expect((await request(app).head("/").set("Host", "thesocialpundit.com")).status).toBe(301);
  });

  it("cannot be steered to another origin", async () => {
    const res = await request(app).get("//evil.example/path").set("Host", "thesocialpundit.com");
    expect(res.headers.location).toBe("https://www.thesocialpundit.com/evil.example/path");
  });

  it("leaves the www host, other hosts, API calls, probes and non-GET requests alone", async () => {
    expect((await request(app).get("/pricing").set("Host", "www.thesocialpundit.com")).status).toBe(200);
    expect((await request(app).get("/pricing").set("Host", "tsp-app-abc.a.run.app")).status).toBe(200);
    expect((await request(app).get("/api/health").set("Host", "thesocialpundit.com")).status).toBe(200);
    expect((await request(app).get("/readyz").set("Host", "thesocialpundit.com")).status).toBe(200);
    expect((await request(app).post("/pricing").set("Host", "thesocialpundit.com")).status).toBe(200);
  });
});

describe("canonical path in the apex redirect", () => {
  it("cleans the path in the same hop", async () => {
    const res = await request(app).get("/Pricing/?utm_source=x").set("Host", "thesocialpundit.com");
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("https://www.thesocialpundit.com/pricing?utm_source=x");
  });
});

describe("canonicalPathFor", () => {
  it("treats every sitemap URL as already canonical, so none of them redirect", () => {
    for (const { loc } of sitemapEntries()) {
      expect(canonicalPathFor(new URL(loc).pathname), loc).toBeUndefined();
    }
  });

  it("returns undefined for paths that are already canonical", () => {
    for (const path of ["/", "/pricing", "/blog/one-voice-ten-platforms", "/dashboard", "/Unknown-Page"]) {
      expect(canonicalPathFor(path)).toBeUndefined();
    }
  });

  it("strips trailing slashes, collapses duplicate slashes and lowercases known pages", () => {
    expect(canonicalPathFor("/pricing/")).toBe("/pricing");
    expect(canonicalPathFor("/pricing//")).toBe("/pricing");
    expect(canonicalPathFor("//pricing")).toBe("/pricing");
    expect(canonicalPathFor("/use-cases//")).toBe("/use-cases");
    expect(canonicalPathFor("//")).toBe("/");
    expect(canonicalPathFor("/PRICING")).toBe("/pricing");
    expect(canonicalPathFor("/Blog/One-Voice-Ten-Platforms/")).toBe("/blog/one-voice-ten-platforms");
  });

  it("does not lowercase paths that are not public pages", () => {
    expect(canonicalPathFor("/Invite/AbC123")).toBeUndefined();
    expect(canonicalPathFor("/Invite/AbC123/")).toBe("/Invite/AbC123");
  });
});

describe("canonicalPathRedirect", () => {
  const host = "www.thesocialpundit.com";

  it("moves trailing-slash, double-slash and wrong-case page URLs permanently, keeping the query", async () => {
    const cases: Array<[string, string]> = [
      ["/pricing/", "/pricing"],
      ["/pricing/?utm_source=x&a=1", "/pricing?utm_source=x&a=1"],
      ["//pricing", "/pricing"],
      ["/Pricing", "/pricing"],
      ["/tools/linkedin-post-generator/", "/tools/linkedin-post-generator"],
      ["/dashboard/", "/dashboard"],
    ];
    for (const [from, to] of cases) {
      const res = await request(app).get(from).set("Host", host);
      expect(res.status, from).toBe(301);
      expect(res.headers.location, from).toBe(to);
    }
    expect((await request(app).head("/pricing/").set("Host", host)).status).toBe(301);
  });

  it("never produces a protocol-relative redirect", async () => {
    const res = await request(app).get("//evil.example/").set("Host", host);
    expect(res.headers.location).toBe("/evil.example");
  });

  it("leaves canonical pages, files, APIs, OAuth callbacks, probes and non-GET requests alone", async () => {
    for (const path of ["/", "/pricing", "/robots.txt", "/assets/app.js", "/api/health/", "/auth/reddit/callback/", "/readyz"]) {
      expect((await request(app).get(path).set("Host", host)).status, path).toBe(200);
    }
    expect((await request(app).post("/pricing/").set("Host", host)).status).toBe(200);
  });
});

describe("cloudRunHostNoindex", () => {
  it("keeps the Cloud Run address reachable but out of search results", async () => {
    const res = await request(app).get("/pricing").set("Host", "tsp-app-abc-el.a.run.app");
    expect(res.status).toBe(200);
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("does not add noindex on the public host", async () => {
    const res = await request(app).get("/pricing").set("Host", "www.thesocialpundit.com");
    expect(res.headers["x-robots-tag"]).toBeUndefined();
  });
});
