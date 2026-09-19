import net from "node:net";
import tls from "node:tls";
import { afterAll, vi } from "vitest";
import { installSupertestTransport } from "../supertest-transport";

// No root test/setup.ts: it intentionally configures real database test URLs.
vi.mock("../../server/db", () => { throw new Error("Database imports forbidden in workflow budgets"); });
vi.mock("pg", () => { throw new Error("Postgres forbidden in workflow budgets"); });
vi.mock("../../server/repositories/editorialVoice", () => ({ editorialVoiceRepository: {
  get: () => { throw new Error("Unexpected voice repository access in workflow budgets"); },
} }));

// Install directly, not as vi spies: existing tests call restoreAllMocks/resetModules.
// Only TCP listeners created by this test process and our private Redis sockets
// are reachable. This does NOT permit arbitrary localhost DB/Redis services.
const listeners = new Set<net.Server>();
const emit = net.Server.prototype.emit;
net.Server.prototype.emit = function (event: string | symbol, ...args: any[]) {
  if (event === "listening") listeners.add(this);
  if (event === "close") listeners.delete(this);
  return Reflect.apply(emit, this, [event, ...args]);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: any[]) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  let socket: unknown;
  if (typeof options === "object") socket = options.path;
  else if (typeof options === "string" && !/^\d+$/.test(options)) socket = options;
  const host = typeof options === "object" ? options.host : args[1];
  const port = Number(typeof options === "object" ? options.port : options);
  const ownSocket = typeof socket === "string" && /^\/tmp\/tsp-budget-redis-[\w-]+\/redis\.sock$/.test(socket);
  const ownHttp = ["127.0.0.1", "::1", "localhost"].includes(host) && [...listeners].some(server => {
    const address = server.address();
    return address && typeof address === "object" && address.port === port;
  });
  if (!ownSocket && !ownHttp) throw new Error("Unowned network connection forbidden in workflow budgets");
  return Reflect.apply(connect, this, args);
} as typeof connect;
const tlsConnect = tls.connect;
tls.connect = (() => { throw new Error("TLS network forbidden in workflow budgets"); }) as typeof tls.connect;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unmocked fetch forbidden in workflow budgets"); };
const restoreTransport = installSupertestTransport();
afterAll(async () => {
  await restoreTransport();
  net.Server.prototype.emit = emit; net.Socket.prototype.connect = connect; tls.connect = tlsConnect;
  globalThis.fetch = originalFetch;
});