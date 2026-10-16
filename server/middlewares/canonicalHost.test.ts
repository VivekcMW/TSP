import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { canonicalHostRedirect } from "./canonicalHost";

const app = express();
app.use(canonicalHostRedirect);
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
    expect(res.headers.location).toBe("https://www.thesocialpundit.com//evil.example/path");
  });

  it("leaves the www host, other hosts, API calls, probes and non-GET requests alone", async () => {
    expect((await request(app).get("/pricing").set("Host", "www.thesocialpundit.com")).status).toBe(200);
    expect((await request(app).get("/pricing").set("Host", "tsp-app-abc.a.run.app")).status).toBe(200);
    expect((await request(app).get("/api/health").set("Host", "thesocialpundit.com")).status).toBe(200);
    expect((await request(app).get("/readyz").set("Host", "thesocialpundit.com")).status).toBe(200);
    expect((await request(app).post("/pricing").set("Host", "thesocialpundit.com")).status).toBe(200);
  });
});
