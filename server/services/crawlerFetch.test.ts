import { Readable } from "node:stream";
import type { Agent } from "node:http";
import type { LookupFunction } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Response, type RequestInit } from "node-fetch";

const { network, lookup } = vi.hoisted(() => ({ network: vi.fn(), lookup: vi.fn() }));
vi.mock("node-fetch", async (original) => ({ ...await original<typeof import("node-fetch")>(), default: network }));
vi.mock("node:dns/promises", () => ({ default: { lookup } }));
import { fetchPublicText } from "./crawlerFetch";
import { assertPublicHttpUrl, isPrivateIp, validateUrl } from "./urlValidator";

beforeEach(() => {
  vi.resetAllMocks();
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  network.mockImplementation(async () => new Response("hello"));
});
afterEach(() => vi.useRealTimers());

describe("public crawler transport", () => {
  it.each([
    "http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://0177.0.0.1",
    "http://10.0.0.1", "http://172.16.0.1", "http://192.168.0.1", "http://169.254.169.254",
    "http://100.64.0.1", "http://0.0.0.0", "http://224.0.0.1", "http://255.255.255.255",
    "http://198.18.0.1", "http://192.0.2.1", "http://[::1]", "http://[::ffff:127.0.0.1]",
    "http://[::ffff:7f00:1]", "http://[fc00::1]", "http://[febf::1]", "http://[ff02::1]",
    "http://[64:ff9b::7f00:1]", "http://[2002:7f00:1::]", "http://localhost.",
    "http://anything.localhost", "http://host.internal", "file:///etc/passwd",
    "https://user:password@public.test/",
  ])("blocks %s before sending a request", async (url) => {
    await expect(fetchPublicText(url)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });

  it("allows public IPv4/IPv6 and rejects mixed public/private DNS answers", async () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    expect((await assertPublicHttpUrl("https://mixed.test")).ok).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });

  it("validates EVERY redirect, not just the original and final destination", async () => {
    network.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://hop.test/next" } }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "http://169.254.169.254/latest" } }));
    await expect(fetchPublicText("https://start.test/")).rejects.toMatchObject({ code: "blocked" });
    expect(network).toHaveBeenCalledTimes(2);
    expect(lookup.mock.calls.map(([host]) => host)).toEqual(["start.test", "hop.test"]);
    expect(network.mock.calls.every(([, options]) => options.redirect === "manual")).toBe(true);
  });

  it("pins the validated address without a second DNS query at connection time", async () => {
    lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    network.mockImplementation(async (url: URL, options: RequestInit) => {
      expect(url.hostname).toBe("rebind.test");
      const agent = options.agent as Agent & { options: { lookup: LookupFunction } };
      const callback = vi.fn();
      agent.options.lookup("rebind.test", {}, callback);
      expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
      agent.options.lookup("rebind.test", { all: true }, callback);
      expect(callback).toHaveBeenLastCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
      return new Response("safe");
    });
    expect((await fetchPublicText("https://rebind.test/")).text).toBe("safe");
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("revalidates same-host redirects when DNS changes", async () => {
    lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    network.mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/next" } }));
    await expect(fetchPublicText("https://rebind.test/")).rejects.toMatchObject({ code: "blocked" });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("resolves relative redirects and returns the canonical final URL", async () => {
    network.mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: "../article#section" } }))
      .mockResolvedValueOnce(new Response("article"));
    expect((await fetchPublicText("https://news.test/blog/index")).url).toBe("https://news.test/article");
  });

  it("destroys redirect bodies and caps redirect chains", async () => {
    const streams: Readable[] = [];
    network.mockImplementation(async (_url: URL) => {
      const body = new Readable({ read() {} }); streams.push(body);
      return new Response(body, { status: 302, headers: { location: `/hop-${streams.length}` } });
    });
    await expect(fetchPublicText("https://news.test/")).rejects.toMatchObject({ code: "redirect" });
    expect(network).toHaveBeenCalledTimes(6);
    expect(streams.every((stream) => stream.destroyed)).toBe(true);
  });

  it("rejects redirect loops", async () => {
    network.mockResolvedValue(new Response(null, { status: 302, headers: { location: "/" } }));
    await expect(fetchPublicText("https://news.test/")).rejects.toMatchObject({ code: "redirect" });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("charges redirect hops to the shared request budget", async () => {
    let calls = 0;
    network.mockImplementation(async () => new Response(null, { status: 302, headers: { location: `/hop-${++calls}` } }));
    await expect(fetchPublicText("https://news.test/", { budget: { requests: 2, bytes: 1000 } })).rejects.toMatchObject({ code: "budget" });
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("bounds aggregate bytes across requests sharing a discovery budget", async () => {
    const budget = { requests: 10, bytes: 5 };
    await fetchPublicText("https://news.test/one", { budget });
    await expect(fetchPublicText("https://news.test/two", { budget })).rejects.toMatchObject({ code: "budget" });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized content-length before reading the body", async () => {
    const body = new Readable({ read() {} });
    network.mockResolvedValue(new Response(body, { headers: { "content-length": "9999999" } }));
    await expect(fetchPublicText("https://news.test/")).rejects.toMatchObject({ code: "size" });
    expect(body.destroyed).toBe(true);
  });

  it("enforces the decompressed/chunked stream byte limit through node-fetch's body reader", async () => {
    network.mockImplementation(async (_url: URL, options: RequestInit) => new Response(
      Readable.from([Buffer.alloc(600), Buffer.alloc(600)]),
      { size: options.size } as ConstructorParameters<typeof Response>[1],
    ));
    await expect(fetchPublicText("https://news.test/", { maxBytes: 1000 })).rejects.toMatchObject({ code: "size" });
  });

  it("includes DNS in the timeout and never sends a late request", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    lookup.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const task = expect(fetchPublicText("https://slow.test/", { timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(20); await task;
    finish([{ address: "93.184.216.34", family: 4 }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(network).not.toHaveBeenCalled();
  });

  it("times out a stalled body, not just response headers", async () => {
    vi.useFakeTimers();
    const body = new Readable({ read() {} });
    network.mockImplementation(async (_url: URL, options: RequestInit) => {
      options.signal!.addEventListener("abort", () => body.destroy(new Error("cancelled")));
      return new Response(body);
    });
    const task = expect(fetchPublicText("https://slow.test/", { timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(20); await task;
    expect(body.destroyed).toBe(true);
  });

  it("bounds global/per-host parallelism and rejects excess queued work", async () => {
    vi.useFakeTimers();
    let active = 0; let maximum = 0;
    const hosts = new Map<string, number>(); let hostMaximum = 0;
    network.mockImplementation(async (url: URL) => {
      active++; maximum = Math.max(maximum, active);
      hosts.set(url.host, (hosts.get(url.host) ?? 0) + 1);
      hostMaximum = Math.max(hostMaximum, hosts.get(url.host)!);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--; hosts.set(url.host, hosts.get(url.host)! - 1);
      return new Response("ok");
    });
    const tasks = Promise.allSettled(Array.from({ length: 60 }, (_, index) => fetchPublicText(`https://host-${index % 6}.test/${index}`)));
    await vi.advanceTimersByTimeAsync(1000);
    const results = await tasks;
    expect(maximum).toBeLessThanOrEqual(8); expect(hostMaximum).toBeLessThanOrEqual(2);
    expect(results.some((result) => result.status === "rejected" && result.reason.code === "busy")).toBe(true);
  });

  it("cancels queued work before DNS/network and recovers capacity", async () => {
    vi.useFakeTimers();
    network.mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); return new Response("ok"); });
    const activeTasks = [fetchPublicText("https://same.test/a"), fetchPublicText("https://same.test/b")];
    const controller = new AbortController();
    const queued = expect(fetchPublicText("https://same.test/c", { signal: controller.signal })).rejects.toThrow();
    controller.abort(); await queued;
    await vi.advanceTimersByTimeAsync(50); await Promise.all(activeTasks);
    expect(network).toHaveBeenCalledTimes(2); expect(lookup).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 429, 500])("does not report HTTP %s as reachable", async (status) => {
    network.mockResolvedValue(new Response(null, { status }));
    expect((await validateUrl("https://news.test/a", true)).isValid).toBe(false);
  });
  it("does not leak raw transport errors or URLs", async () => {
    network.mockRejectedValue(new Error("private credentials and raw URL"));
    await expect(fetchPublicText("https://news.test/a?token=private")).rejects.toMatchObject({ code: "network" });
  });
});