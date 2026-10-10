import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import Redis from "ioredis";

// Shared version of the socket-only fixture from rateLimitRedisStore.test.ts.
// Never consult REDIS_URL, bind TCP, persist data, or flush an existing service.
export const disposableRedisAvailable = spawnSync("redis-server", ["--version"], { stdio: "ignore" }).status === 0;

export async function startDisposableRedis() {
  const directory = await mkdtemp("/tmp/tsp-budget-redis-");
  const socket = `${directory}/redis.sock`;
  const server = spawn("redis-server", ["--port", "0", "--unixsocket", socket,
    "--unixsocketperm", "700", "--save", "", "--appendonly", "no", "--dir", directory],
  { stdio: ["ignore", "pipe", "pipe"] });
  const clients: Redis[] = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clients.forEach(client => client.disconnect());
    if (server.pid && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      const force = setTimeout(() => server.kill("SIGKILL"), 1000);
      try { await exited; } finally { clearTimeout(force); }
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        server.off("error", failed); server.off("exit", failed); server.stdout?.off("data", ready);
        error ? reject(error) : resolve();
      };
      const failed = () => finish(new Error("Isolated Redis startup failed"));
      const ready = (chunk: Buffer) => { if (/ready to accept connections/i.test(chunk.toString())) finish(); };
      const timeout = setTimeout(() => finish(new Error("Isolated Redis startup timed out")), 5000);
      server.once("error", failed); server.once("exit", failed); server.stdout?.on("data", ready);
    });
  } catch (error) { await stop(); throw error; }
  return {
    socket, stop,
    client() {
      const client = new Redis({ path: socket, lazyConnect: true, enableOfflineQueue: false,
        retryStrategy: () => null, maxRetriesPerRequest: 0, commandTimeout: 1000 });
      client.on("error", () => {});
      clients.push(client);
      return client;
    },
  };
}