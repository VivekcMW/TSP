import express from "express";
import request from "supertest";
import { toNodeHandler } from "better-auth/node";
import { getIP } from "@better-auth/core/utils/ip";
import { describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER, configureProxy, trustedProxyAddresses } from "./proxy";

function boundary(peer: string | undefined, proxies = "") {
  const app = express();
  app.use((req, _res, next) => {
    // Simulate topology at the socket, not by trusting a test HTTP header.
    Object.defineProperty(req.socket, "remoteAddress", { configurable: true, value: peer });
    next();
  });
  configureProxy(app, proxies);
  const handler = toNodeHandler(async (req: globalThis.Request) => Response.json({
    canonical: req.headers.get(CLIENT_IP_HEADER),
    ip: getIP(req, { advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } } }),
    protocol: new URL(req.url).protocol,
  }));
  app.all("*", (req, res, next) => { void handler(req, res).catch(next); });
  return app;
}

const forged = {
  "X-Tsp-Client-IP": "6.6.6.6",
  "X-Forwarded-For": "1.1.1.1, 2.2.2.2",
  "X-Real-IP": "3.3.3.3",
  "CF-Connecting-IP": "4.4.4.4",
  "Forwarded": "for=5.5.5.5;proto=https",
  "X-Forwarded-Proto": "https",
};

describe("proxy boundary", () => {
  it("defaults to direct socket despite every spoofed forwarding header", async () => {
    const res = await request(boundary("198.51.100.20")).get("/").set(forged);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ canonical: "198.51.100.20", ip: "198.51.100.20", protocol: "http:" });
  });
  it("ignores XFF on an alternate direct route even with trusted proxies configured", async () => {
    const res = await request(boundary("198.51.100.20", "192.0.2.0/24")).get("/").set(forged);
    expect(res.body.ip).toBe("198.51.100.20");
  });
  it("walks trusted hops from the socket and stops before a forged leftmost address", async () => {
    const res = await request(boundary("192.0.2.10", "192.0.2.10/32,192.0.2.11/32"))
      .get("/").set(forged).set("X-Forwarded-For", "6.6.6.6, 198.51.100.20, 192.0.2.11");
    expect(res.body).toEqual({ canonical: "198.51.100.20", ip: "198.51.100.20", protocol: "https:" });
  });
  it("uses the shorter trusted route without blind hop-count assumptions", async () => {
    const res = await request(boundary("192.0.2.10", "192.0.2.10,192.0.2.11"))
      .get("/").set("X-Forwarded-For", "6.6.6.6, 198.51.100.21");
    expect(res.body.ip).toBe("198.51.100.21");
  });
  it("does not skip an unknown intermediary", async () => {
    const res = await request(boundary("192.0.2.10", "192.0.2.10"))
      .get("/").set("X-Forwarded-For", "198.51.100.20, 203.0.113.10");
    expect(res.body.ip).toBe("203.0.113.10");
  });
  it.each([undefined, "invalid", "198.51.100.20, invalid"])("falls back to socket for missing/malformed XFF: %s", async (xff) => {
    let req = request(boundary("192.0.2.10", "192.0.2.10")).get("/");
    if (xff) req = req.set("X-Forwarded-For", xff);
    expect((await req).body.ip).toBe("192.0.2.10");
  });
  it("normalizes mapped IPv4 and groups IPv6 at Better Auth's default /64", async () => {
    expect((await request(boundary("::ffff:198.51.100.20")).get("/")).body.ip).toBe("198.51.100.20");
    const a = await request(boundary("2001:db8:abcd:1234::1")).get("/");
    const b = await request(boundary("2001:db8:abcd:1234::2")).get("/");
    expect(a.body.ip).toBe(b.body.ip);
    expect(a.body.canonical).not.toBe(b.body.canonical);
  });
  it("accepts IPv6 and mapped IPv4 trusted socket addresses", async () => {
    for (const peer of ["2001:db8::10", "::ffff:192.0.2.10"]) {
      const res = await request(boundary(peer, "2001:db8::/64,192.0.2.10"))
        .get("/").set("X-Forwarded-For", "198.51.100.20");
      expect(res.body.ip).toBe("198.51.100.20");
    }
  });
  it("rejects a request with no valid socket or derived address", async () => {
    expect((await request(boundary(undefined)).get("/").set(forged)).status).toBe(503);
  });
  it("replaces duplicate canonical headers and invalid adapter protocol", async () => {
    const res = await request(boundary("198.51.100.20")).get("/")
      .set({ [CLIENT_IP_HEADER]: ["6.6.6.6", "7.7.7.7"] }).set("X-Forwarded-Proto", "invalid://");
    expect(res.body.ip).toBe("198.51.100.20");
    expect(res.body.protocol).toBe("http:");
  });
  it.each(["true", "1", "loopback", "uniquelocal", "*", "0.0.0.0/0", "::/0", "192.0.2.1/33", "::1/129", "192.0.2.1/8x", "192.0.2.1,", "192.0.2.1/24/1"])
    ("rejects unsafe or malformed proxy configuration: %s", (value) => {
      expect(() => trustedProxyAddresses(value)).toThrow("TRUSTED_PROXY_CIDRS");
    });
});