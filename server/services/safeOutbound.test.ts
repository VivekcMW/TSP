import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Response, type RequestInit } from "node-fetch";
import { Readable } from "node:stream";
import type { Agent } from "node:http";
import type { LookupFunction } from "node:net";
const { network, lookup } = vi.hoisted(() => ({ network: vi.fn(), lookup: vi.fn() }));
vi.mock("node-fetch", async original => ({ ...await original<typeof import("node-fetch")>(), default: network }));
vi.mock("node:dns/promises", () => ({ default: { lookup } }));
import { safeOutboundJson } from "./safeOutbound";
const origin = "https://instance.test";
const options = { origin, headers: { Authorization: "Bearer test-only" }, method: "POST" as const, body: '{"status":"test"}' };
beforeEach(() => {
  vi.resetAllMocks();
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  network.mockImplementation(async () => new Response('{"id":"ok"}'));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unpinned fetch forbidden"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("authenticated public transport", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "2130706433", "0x7f000001", "[::1]", "[fc00::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "[64:ff9b::7f00:1]"])("blocks literal %s without dispatch", async host => {
    const url = new URL(`https://${host}/api`);
    await expect(safeOutboundJson(url.href, { ...options, origin: url.origin })).rejects.toMatchObject({ code: "blocked" });
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["https://different.test/api", "http://instance.test/api", "https://user:password@instance.test/api", "file:///etc/passwd"])("rejects origin/scheme/userinfo violation %s", async url => {
    await expect(safeOutboundJson(url, options)).rejects.toMatchObject({ code: "blocked" });
    expect(network).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled();
  });
  it.each([[], [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }], [{ address: "2606:4700:4700::1111", family: 6 }, { address: "::1", family: 6 }]].map(records => ({ records })))("fails closed for empty or mixed DNS $records", async ({ records }) => {
    lookup.mockResolvedValue(records);
    await expect(safeOutboundJson(`${origin}/api`, options)).rejects.toMatchObject({ code: "blocked" });
    expect(network).not.toHaveBeenCalled();
  });
  it("fails closed on DNS errors", async () => {
    lookup.mockRejectedValue(new Error("DNS down"));
    await expect(safeOutboundJson(`${origin}/api`, options)).rejects.toMatchObject({ code: "blocked" });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([{ address: "93.184.216.34", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }])("pins public IPv$family and rejects agent hostname reuse", async record => {
    lookup.mockResolvedValueOnce([record]).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    let destroy!: ReturnType<typeof vi.spyOn>;
    network.mockImplementation(async (url: URL, init: RequestInit) => {
      expect(url.hostname).toBe("instance.test");
      const agent = init.agent as Agent & { options: { lookup: LookupFunction; rejectUnauthorized?: boolean } };
      expect(agent.options.rejectUnauthorized).not.toBe(false);
      destroy = vi.spyOn(agent, "destroy");
      const callback = vi.fn();
      agent.options.lookup(url.hostname, {}, callback);
      expect(callback).toHaveBeenLastCalledWith(null, record.address, record.family);
      agent.options.lookup(url.hostname, { all: true }, callback);
      expect(callback).toHaveBeenLastCalledWith(null, [record]);
      agent.options.lookup("other.test", {}, callback);
      expect(callback.mock.lastCall![0]).toBeInstanceOf(Error);
      return new Response('{"id":"ok"}');
    });
    expect(await safeOutboundJson(`${origin}/api`, options)).toEqual({ ok: true, status: 200, data: { id: "ok" } });
    expect(lookup).toHaveBeenCalledTimes(1); expect(destroy).toHaveBeenCalled();
  });
  it.each([301, 302, 303, 307, 308])("rejects redirect %s and destroys the body without forwarding credentials", async status => {
    const body = new Readable({ read() {} });
    network.mockResolvedValue(new Response(body, { status, headers: { location: "https://different.test/steal" } }));
    await expect(safeOutboundJson(`${origin}/api`, options)).rejects.toMatchObject({ code: "redirect" });
    expect(network).toHaveBeenCalledTimes(1); expect(body.destroyed).toBe(true);
  });
  it("bounds declared and decompressed response sizes", async () => {
    const body = new Readable({ read() {} });
    network.mockResolvedValueOnce(new Response(body, { headers: { "content-length": "2000" } }));
    await expect(safeOutboundJson(`${origin}/api`, { ...options, maxBytes: 1000 })).rejects.toMatchObject({ code: "size" });
    expect(body.destroyed).toBe(true);
    network.mockImplementationOnce(async (_url: URL, init: RequestInit) => new Response(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), { size: init.size } as ConstructorParameters<typeof Response>[1]));
    await expect(safeOutboundJson(`${origin}/api`, { ...options, maxBytes: 1000 })).rejects.toMatchObject({ code: "size" });
  });
  it("includes DNS in its deadline and never dispatches a late lookup", async () => {
    vi.useFakeTimers(); let finish!: (records: unknown) => void;
    lookup.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const task = expect(safeOutboundJson(`${origin}/api`, { ...options, timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(20); await task;
    finish([{ address: "93.184.216.34", family: 4 }]); await vi.advanceTimersByTimeAsync(1);
    expect(network).not.toHaveBeenCalled();
  });
  it("bounds stalled bodies and releases their socket", async () => {
    vi.useFakeTimers(); const body = new Readable({ read() {} });
    network.mockResolvedValue(new Response(body));
    const task = expect(safeOutboundJson(`${origin}/api`, { ...options, timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(20); await task; expect(body.destroyed).toBe(true);
  });
  it("honors pre-cancellation without DNS or dispatch", async () => {
    await expect(safeOutboundJson(`${origin}/api`, { ...options, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "timeout" });
    expect(lookup).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
});