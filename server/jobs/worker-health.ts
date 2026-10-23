import { randomUUID } from "node:crypto";
import { redis } from "../lib/redis";
import { queuePrefix } from "../lib/redis-options";

const instanceId = randomUUID();
let timer: ReturnType<typeof setInterval> | undefined;
const prefix = () => `${queuePrefix()}:workers:`;
const key = () => `${prefix()}${instanceId}`;
export async function startWorkerHeartbeat(queues: string[]) {
  if (!redis) return;
  const write = async () => {
    try { await redis!.set(key(), JSON.stringify({ queues, observedAt: Date.now() }), "EX", 60); }
    catch { console.error("[workers:health] Heartbeat write unavailable"); }
  };
  await write();
  if (!timer) { timer = setInterval(() => { void write(); }, 15_000); timer.unref(); }
}
export async function stopWorkerHeartbeat() {
  clearInterval(timer); timer = undefined;
  if (redis) {
    try { await redis.del(key()); }
    catch { console.error("[workers:health] Heartbeat cleanup unavailable; observation will expire"); }
  }
}
export async function readWorkerHealth() {
  if (!redis) return { available: false, inbox: null, publishing: null };
  let cursor = "0", inbox = 0, publishing = 0, scanned = 0;
  try {
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix()}*`, "COUNT", 100);
      cursor = next; scanned += keys.length;
      if (scanned > 1000) throw new Error("Worker observation limit exceeded");
      if (!keys.length) continue;
      const values = await redis.mget(...keys);
      for (const value of values) {
        if (!value) continue;
        const row: unknown = JSON.parse(value);
        if (!row || typeof row !== "object" || !("queues" in row) || !Array.isArray(row.queues)
          || !("observedAt" in row) || typeof row.observedAt !== "number") throw new Error("Invalid worker observation");
        if (Date.now() - row.observedAt > 60_000 || row.observedAt > Date.now() + 5000) continue;
        if (row.queues.includes("inbox")) inbox++;
        if (row.queues.includes("publishing")) publishing++;
      }
    } while (cursor !== "0");
    return { available: true, inbox, publishing };
  } catch {
    console.error("[workers:health] Heartbeat observations unavailable");
    return { available: false, inbox: null, publishing: null };
  }
}
