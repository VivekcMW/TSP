import Redis, { type RedisOptions } from "ioredis";

/** Blocking/subscriber Bull connections must wait indefinitely; commands must not. */
export function redisOptions(blocking = false): RedisOptions {
  return {
    keepAlive: 10_000,
    connectTimeout: 5_000,
    retryStrategy: (attempt) => Math.min(100 * 2 ** Math.min(attempt, 5), 3_000),
    reconnectOnError: (error) => error.message.includes("READONLY"),
    maxRetriesPerRequest: blocking ? null : 2,
    enableReadyCheck: !blocking,
    lazyConnect: false,
    enableOfflineQueue: true,
    autoResubscribe: true,
    // A lost reply does not mean a write failed. Never replay uncertain command
    // writes on reconnect; Bull's blocking connection still needs its own replay.
    autoResendUnfulfilledCommands: blocking,
    commandTimeout: blocking ? undefined : 5_000,
    // ioredis 6 arms this only while expecting data, not while idle. Unlike
    // commandTimeout it destroys the silent socket and starts retryStrategy.
    // Keep it longer than the request deadline, including during the handshake.
    socketTimeout: blocking ? undefined : 10_000,
    blockingTimeout: undefined,
  };
}

/** Pure factory: importing options must never connect to the configured Redis. */
export function createRedisClient(redisUrl: string, blocking = false): Redis {
  const options = redisOptions(blocking);
  const url = new URL(redisUrl);
  // ioredis uses first-defined-wins, so new Redis(url, options) lets URL query
  // strings override even function-valued policies (retryStrategy becomes a
  // string and permanently stops reconnects). Remove all policy keys, including
  // undefined deadlines: 0 is NOT a disabled socket/command timeout in ioredis.
  // Leave auth, database, TLS scheme and non-lifecycle query options intact.
  for (const key of Object.keys(options)) url.searchParams.delete(key);
  return new Redis(url.toString(), options);
}