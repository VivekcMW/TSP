import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type Redis from "ioredis";
import { createRedisClient, redisOptions } from "./redis-options";

// Real ioredis and TCP, but no configured Redis, DB, provider, or redis-server
// binary. Only the RESP commands needed by these tests are implemented here.
class LoopbackRedis {
  sockets = new Set<Socket>();
  silent = new Set<Socket>();
  received: Array<{ socket: Socket; args: string[] }> = [];
  connections = 0;
  holdSubscriptions = false;
  silenceFirstConnection = false;
  increments = 0;
  port = 0;
  server = createServer(socket => {
    this.connections++;
    this.sockets.add(socket);
    if (this.silenceFirstConnection && this.connections === 1) this.silent.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => this.sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on("data", data => {
      pending = Buffer.concat([pending, data]);
      while (pending.length) {
        const parsed = readCommand(pending);
        if (!parsed) return;
        pending = pending.subarray(parsed.bytes);
        const args = parsed.args;
        this.received.push({ socket, args });
        const command = args[0].toLowerCase();
        if (command === "incr") this.increments++;
        if (this.silent.has(socket)) continue;
        switch (command) {
          // Exercise ioredis 6's normal RESP3 -> RESP2 handshake fallback.
          case "hello": socket.write("-ERR unknown command 'HELLO'\r\n"); break;
          case "info": socket.write(bulk("redis_version:7.0.0\r\nloading:0\r\n")); break;
          case "ping": socket.write("+PONG\r\n"); break;
          case "incr": socket.write(`:${this.increments}\r\n`); break;
          case "brpoplpush": break; // Wait until the test supplies a job.
          case "subscribe":
            if (!this.holdSubscriptions) socket.write(subscription(args[1]));
            break;
          case "auth": case "select": case "client": socket.write("+OK\r\n"); break;
          default: socket.write("-ERR unsupported test command\r\n");
        }
      }
    });
  });

  async start(port = 0) {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
    this.port = (this.server.address() as { port: number }).port;
    return this;
  }

  get url() { return `redis://127.0.0.1:${this.port}/2`; }

  async stop() {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (this.server.listening) {
      await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    }
  }
}

function bulk(value: string) { return `$${Buffer.byteLength(value)}\r\n${value}\r\n`; }
function subscription(channel: string) { return `*3\r\n${bulk("subscribe")}${bulk(channel)}:1\r\n`; }

// ioredis writes arrays of bulk strings; retain partial TCP frames between data
// events so tests do not depend on packet boundaries or command coalescing.
function readCommand(buffer: Buffer): { args: string[]; bytes: number } | undefined {
  const header = buffer.indexOf("\r\n");
  if (header < 0) return;
  const count = Number(buffer.subarray(1, header).toString());
  let offset = header + 2;
  const args: string[] = [];
  for (let i = 0; i < count; i++) {
    const end = buffer.indexOf("\r\n", offset);
    if (end < 0) return;
    const length = Number(buffer.subarray(offset + 1, end).toString());
    offset = end + 2;
    if (buffer.length < offset + length + 2) return;
    args.push(buffer.subarray(offset, offset + length).toString());
    offset += length + 2;
  }
  return { args, bytes: offset };
}

const servers: LoopbackRedis[] = [];
const clients: Redis[] = [];
async function server() {
  const instance = new LoopbackRedis();
  servers.push(instance);
  return instance.start();
}
function client(url: string, blocking = false) {
  const instance = createRedisClient(url, blocking);
  instance.on("error", () => undefined); // Expected during deliberately injected outages.
  clients.push(instance);
  return instance;
}

afterEach(async () => {
  for (const instance of clients.splice(0)) instance.disconnect();
  for (const instance of servers.splice(0)) await instance.stop();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Redis lifecycle policy", () => {
  it.each([false, true])("protects every lifecycle key against repeated/encoded URL overrides (blocking=%s)", blocking => {
    const query = new URLSearchParams();
    for (const key of Object.keys(redisOptions(blocking))) {
      query.append(key, "0"); query.append(key, "false");
    }
    const instance = client(`rediss://test%40user:test%3Apassword@127.0.0.1:1/7?${query}&%72etryStrategy=stop&connectionName=loopback-test&family=4`, blocking);
    const policy = redisOptions(blocking);
    for (const key of Object.keys(policy) as Array<keyof typeof policy>) {
      if (typeof policy[key] !== "function") expect(instance.options[key], key).toEqual(policy[key]);
    }
    expect(instance.options.retryStrategy!(100)).toBe(3000);
    expect(instance.options.reconnectOnError!(new Error("READONLY replica"))).toBe(true);
    expect(instance.options.reconnectOnError!(new Error("ERR other"))).toBe(false);
    expect(instance.options).toMatchObject({ host: "127.0.0.1", port: 1, username: "test@user", password: "test:password",
      db: 7, tls: true, connectionName: "loopback-test", family: 4 });
    // Disconnect synchronously, before ioredis's deferred connector opens a socket.
    instance.disconnect();
  });

  it("preserves query-based database and password-only authentication", () => {
    const instance = client("redis://:test%3Fpassword@[::1]:1/?db=9&retryStrategy=stop");
    expect(instance.options).toMatchObject({ host: "::1", port: 1, username: "", password: "test?password", db: 9 });
    expect(instance.options.tls).toBeUndefined();
    expect(typeof instance.options.retryStrategy).toBe("function");
    instance.disconnect();
  });
});

describe("real ioredis loopback recovery", () => {
  it("recovers the shared singleton from a silent open socket after the command already timed out, without replaying its write", async () => {
    const endpoint = await server();
    vi.resetModules();
    vi.stubEnv("REDIS_URL", `${endpoint.url}?retryStrategy=stop&socketTimeout=0&commandTimeout=0&autoResendUnfulfilledCommands=true`);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { redis } = await import("./redis");
    expect(redis).toBeDefined();
    const shared = redis!;
    clients.push(shared);
    const errors: Error[] = [];
    shared.on("error", error => errors.push(error));
    await expect(shared.ping()).resolves.toBe("PONG");
    const original = [...endpoint.sockets][0];
    endpoint.silent.add(original);
    const started = Date.now();
    await expect(shared.incr("uncertain-write")).rejects.toThrow("Command timed out");
    expect(Date.now() - started).toBeLessThan(7_000);
    expect(original.destroyed).toBe(false); // Command deadline alone did not repair it.
    await vi.waitFor(() => expect(endpoint.connections).toBe(2), { timeout: 8_000 });
    await expect(shared.ping()).resolves.toBe("PONG");
    expect(Date.now() - started).toBeLessThan(14_000);
    expect(errors.some(error => error.message.includes("Socket timeout"))).toBe(true);
    expect(endpoint.increments).toBe(1); // The server applied the write but lost its reply.
    expect(shared.status).toBe("ready");
    const selections = endpoint.received.filter(entry => entry.args[0].toLowerCase() === "select");
    expect(new Set(selections.map(entry => entry.socket)).size).toBe(2);
    expect(selections.every(entry => entry.args[1] === "2")).toBe(true);
  }, 18_000);

  it("recovers when TCP connects but the initial handshake never receives a reply", async () => {
    const endpoint = await server();
    endpoint.silenceFirstConnection = true;
    const shared = client(`${endpoint.url}?retryStrategy=stop&connectTimeout=0&socketTimeout=0`);
    const reconnecting = vi.fn();
    shared.on("reconnecting", reconnecting);
    await expect(shared.ping()).rejects.toThrow("Command timed out");
    await vi.waitFor(() => expect(shared.status).toBe("ready"), { timeout: 8_000 });
    expect(reconnecting).toHaveBeenCalled();
    expect(endpoint.connections).toBe(2);
    await expect(shared.ping()).resolves.toBe("PONG");
  }, 16_000);

  it("keeps retrying through disconnect/refusal and recovers after a restart despite a retryStrategy query string", async () => {
    const endpoint = await server();
    const shared = client(`${endpoint.url}?retryStrategy=stop&maxRetriesPerRequest=0`);
    const reconnecting = vi.fn();
    shared.on("reconnecting", reconnecting);
    await expect(shared.ping()).resolves.toBe("PONG");
    await endpoint.stop();
    await vi.waitFor(() => expect(reconnecting).toHaveBeenCalled(), { timeout: 2_000 });
    // Per-request retries can be exhausted without ending the client lifecycle.
    await expect(shared.ping()).rejects.toThrow("maxRetriesPerRequest");
    expect(shared.status).not.toBe("end");
    await endpoint.start(endpoint.port);
    await vi.waitFor(() => expect(shared.status).toBe("ready"), { timeout: 4_000 });
    await expect(shared.ping()).resolves.toBe("PONG");
    expect(endpoint.connections).toBe(2);
    shared.disconnect();
    await vi.waitFor(() => expect(shared.status).toBe("end"));
    const attempts = reconnecting.mock.calls.length;
    await delay(400);
    expect(reconnecting).toHaveBeenCalledTimes(attempts);
    expect(endpoint.connections).toBe(2);
  }, 10_000);

  it("leaves healthy idle, BRPOPLPUSH and subscriber connections open beyond both command-client deadlines", async () => {
    const endpoint = await server();
    endpoint.holdSubscriptions = true;
    const url = `${endpoint.url}?commandTimeout=1&socketTimeout=1&blockingTimeout=1&enableReadyCheck=true&maxRetriesPerRequest=0`;
    const idle = client(url);
    const blocking = client(url, true);
    const subscriber = client(url, true);
    await Promise.all([idle.ping(), blocking.ping(), subscriber.ping()]);
    let blockedSettled = false;
    let subscribeSettled = false;
    const blocked = blocking.brpoplpush("waiting", "active", 0).then(value => { blockedSettled = true; return value; }, error => { blockedSettled = true; return error; });
    const subscribed = subscriber.subscribe("events").then(value => { subscribeSettled = true; return value; }, error => { subscribeSettled = true; return error; });
    await vi.waitFor(() => expect(endpoint.received.filter(entry => ["brpoplpush", "subscribe"].includes(entry.args[0].toLowerCase()))).toHaveLength(2));
    await delay(10_250); // Actual wall-clock wait, intentionally longer than 10s socketTimeout.
    expect(blockedSettled).toBe(false);
    expect(subscribeSettled).toBe(false);
    expect(endpoint.connections).toBe(3);
    expect(endpoint.sockets.size).toBe(3);
    const blockedSocket = endpoint.received.find(entry => entry.args[0].toLowerCase() === "brpoplpush")!.socket;
    const subscriberSocket = endpoint.received.find(entry => entry.args[0].toLowerCase() === "subscribe")!.socket;
    blockedSocket.write(bulk("job-1"));
    subscriberSocket.write(subscription("events"));
    await expect(blocked).resolves.toBe("job-1");
    await expect(subscribed).resolves.toBe(1);
    const message = vi.fn();
    subscriber.on("message", message);
    subscriberSocket.write(`*3\r\n${bulk("message")}${bulk("events")}${bulk("completed")}`);
    await vi.waitFor(() => expect(message).toHaveBeenCalledWith("events", "completed"));
    await expect(idle.ping()).resolves.toBe("PONG");
  }, 16_000);
});