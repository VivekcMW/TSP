import net from "node:net";
import { afterAll, beforeAll, vi } from "vitest";

/** Fail closed if a mock is accidentally removed. Loopback is only for Supertest. */
export function guardNotificationsMediaNetwork() {
  let restore: () => void;
  beforeAll(() => {
    const connect = net.Socket.prototype.connect;
    const spy = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function(this: net.Socket, ...args: any[]) {
      const options = Array.isArray(args[0]) ? args[0][0] : args[0];
      const host = typeof options === "object" ? options.host : args[1];
      if (!["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("External network forbidden in notification/media tests");
      return connect.apply(this, args as any);
    });
    restore = () => spy.mockRestore();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External fetch forbidden in notification/media tests"); }));
  });
  afterAll(() => { restore?.(); vi.unstubAllGlobals(); });
}