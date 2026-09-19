# Roadmap 27 — local budget acceptance

## Scope and reproduction

Run `node test/workflow-budgets/run.mjs` from the repository. No new dependencies.
The runner selects ten exact files (both filters and `include`), runs serially in
isolated forks, disables the normal DB-oriented setup and Vite environment-file
loading, and starts its child with an allowlisted environment. It does not read
`.env`, inherit provider credentials/database URLs/Redis URLs, contact live AI,
run migrations, deploy, or commit. Do not substitute an unrestricted `pnpm test`
when reproducing this **no-DB** acceptance run.

`test/workflow-budgets/setup.ts` rejects DB imports, unmocked fetch/TLS and network
connections except this process's HTTP test listeners and private fixture Redis
sockets. HTTP upload tests exercise real Express/Multer parsing with mocked auth,
authorization, locking and persistence. Generation tests exercise the real writer,
validation, provider adapter and local admission code with mocked HTTP responses.

`test/disposable-redis.ts` extracts the existing rate-limit test fixture into a
shared helper, now used by that original suite and the new AI acceptance case.
It starts its own `redis-server`, with TCP disabled, a random private Unix socket,
and persistence disabled. Two independent ioredis clients and separately loaded
AI limiter modules issue 20 admission commands each. Teardown disconnects clients,
terminates only the owned child, awaits exit, and removes its temporary directory.
No existing Redis service is used or flushed. If `redis-server` is absent, normal
test discovery explicitly skips its integration cases; the acceptance runner
rejects skips/missing metrics rather than claiming a complete pass.

The normal `vitest.config.ts` already includes
`{client,server,shared,test}/**/*.test.ts`; no broader inclusion/config change was
needed. New cases live in `test/workflow-budgets/*.test.ts`. Existing focused cache,
generation, quota, limiter and media tests are reused. The duplicate-intent burst
was added to `generation-quota.test.ts` to reuse its transactional double rather
than invent another quota implementation. It is **not PostgreSQL/RLS/lock proof**.

## Original local results — 2026-09-19 (before upload admission)

Machine/runtime: macOS arm64, Node v22.14.0; local Redis v8.10.1.
Final runtime run: **10 files, 126 tests passed, 0 failed, 0 skipped**.
Artifacts: `/tmp/tsp-workflow-budgets-FCFdcs/`:

- `summary.json`: exact counts, runtime, success and certification disclaimer.
- `tests.json`: per-file/per-test results.
- `metrics.json`: ten named acceptance measurements.
- `run.log`: full test output and diagnostics.

Each rerun gets a new directory and requires every named metric exactly once.
These are local regression checks, **not production-scale certification**.

| Scenario | Observed acceptance result |
| --- | --- |
| Maximum cache payload | 64 half-MiB churn fetches; last 16 entries hit within the configured 8 MiB serialized-byte budget; oldest entry refetched |
| Cache saturation | Exactly **8 fetches**, not 8 plus a leader; 128 total consumers; 1,000 excess requests rejected; no bypass fetches; capacity recovers |
| Real shared Redis admission | 40 requests across two clients: 4 admitted / 36 busy; budget remains 4, not 40. After release: 2 admitted / 2 budget-denied, reaching budget 6 |
| Redis recovery | Idempotent releases leave zero leases; expired lease removed; disconnected admission fails closed; reconnect preserves spent budget; explicit fixture expiry opens a fresh window |
| Four platforms × four tones, every post repaired | 16 posts; 32 transport calls; peak concurrency 2; 65,536 summed requested output-token ceilings; 224 mock-reported output tokens |
| Same repair case with explicit fallback | 64 transports (32 failed primary + 32 fallback); peak 2; 131,072 summed requested output-token ceilings; 224 mock-reported output tokens; failed primary usage unknown |
| Duplicate platforms | Four selections containing two unique platforms produce 8 calls/posts, not 16; 56 mock-reported output tokens |
| Overall generation deadline | Synthetic 19-second calls stop at the 60-second fake-clock deadline: 8 started, 6 completed, 2 aborted; no partial success or later calls/repairs; 42 mock-reported output tokens |
| Provider quota | 2 started calls, no further queued work; immediate repeat during cooldown starts 0 additional transports |
| Missing provider usage | 4 calls; usage stays `null`, never promoted to verified zero |
| Duplicate operation intents | 24 submissions for 3 intents: 3 mock provider-work calls, 21 duplicate rejections, 3 consumed rows; another new intent rejected by quota without work |
| Upload buffering (historical) | Two simultaneous 50 MiB aggregate requests accepted; 100 MiB passed to mocked storage in 4 calls; aggregate admission was missing, now addressed below |

### Sampled process memory

All figures below are **MiB deltas from scenario baseline**, sampled at workload
checkpoints, not continuous allocator peaks. Each memory column has its own peak
and may have peaked at a different instant. No forced GC or leak-free assertion.

| Workload | Heap used | External | RSS | Generous regression thresholds |
| --- | ---: | ---: | ---: | --- |
| Cache churn + 128 retained result copies | 77.81 | ~0 | 86.75 | heap <256; RSS <512 |
| Two 50 MiB uploads blocked before persistence | 1.77 | 195.94 | 223.81 | external <512; RSS <768 |

The cache has an 8 MiB **UTF-8 key + serialized payload** budget, not an 8 MiB heap
cap. Each admitted consumer receives its own parsed result; the saturated fixture
retains approximately 64 MiB of payload copies in addition to cache/transient work.
Existing tests also cover the 128-entry limit, per-key 32-consumer limit, TTL/LRU,
failure release, malformed/oversized results and no queued bypass work.

Upload samples include a 25 MiB in-process client fixture, HTTP/parser chunks,
concatenated output buffers and normal runtime allocations. Each request contains
two 25 MiB files (exactly 50 MiB aggregate); a single exactly-at-limit file has
Multer's separate file-size boundary behavior. The existing oversized aggregate
test also passes, returning 413 before storage work. Neither fixture exercises
real storage I/O or estimates server-only memory by subtracting an assumed cost.

## Upload aggregate-admission follow-up — 2026-09-19

Reproduce only this fix with `node test/workflow-budgets/run.mjs --media-only`.
This selects exactly five files with the same sanitized child environment, explicit
include/filter, no dotenv/config loading, and network/DB guards. Auth, permissions,
DB, locking and storage providers are mocked. Express/Multer and loopback sockets
are real; **no Redis (not even fixture Redis), database or live provider is used**.
The broader historical ten-file suite was not rerun for this fix.

Verified: **68 tests passed, five files, zero failures/skips**; full-project
`tsc --noEmit --incremental false` passed in a sanitized environment.
Verified artifact: `/tmp/tsp-workflow-budgets-jzQixc/` (Node v22.14.0, macOS arm64).
The media-only runner writes `summary.json`, `tests.json`, `metrics.json` and
`run.log` into its printed `/tmp/tsp-workflow-budgets-*` directory. The upload metric
now records `aggregateConcurrentCap: 2`, `aggregateReservedMiB: 100` and one denied
third request while both admitted 50 MiB batches remain blocked in persistence.
Historical ~196 MiB external-memory overhead above is **not** a 100 MiB RSS promise.
The follow-up sampled deltas were **192.90 MiB external, 220.63 MiB RSS, 1.92 MiB
heap used**, including the same 25 MiB client fixture; no server-only/GC-adjusted
memory claim is made.

The process-shared media admission runs after authentication/permission but before
Multer, with no waiting queue. Each upload reserves **50 MiB**, even for a tiny body,
unknown/chunked Content-Length, or a reduced per-file size. Defaults admit at most
**two active requests and 100 MiB of reserved payload**; either ceiling can reject.
Saturation returns fixed `503`, `Retry-After: 5`, `Cache-Control: no-store` without
invoking the parser or storage. Five seconds is a minimum retry suggestion, **not**
a capacity guarantee or an expiring lease. GET, DELETE and unrelated routes are
outside this admission pool; auth failures remain 401/403 even when saturated.

Configuration is process-start configuration, validated as bounded integers:

| Setting | Default | Allowed range |
| --- | ---: | ---: |
| `MEDIA_UPLOAD_MAX_ACTIVE` | 2 | 1–8 |
| `MEDIA_UPLOAD_MAX_BYTES` | 104857600 (100 MiB) | 52428800–419430400 (50–400 MiB) |
| `MEDIA_UPLOAD_PARSE_TIMEOUT_MS` | 30000 | 1000–120000 |

Invalid configured values fail closed at initialization (no silent unlimited
fallback). Reservations stay 50 MiB each; a 75 MiB budget therefore admits one.
The parse deadline terminates stalled input (408 when writable, connection closed)
and waits for Multer to settle before final cleanup/release. Normal request `close`
after the body completes is not cancellation. Close/error/abort during DB/provider
work does **not** free the permit; awaited processing, compensation and transaction
settlement finish before `finally` discards buffers and releases exactly once.
There is no optimistic processing-timeout release. A stuck DB/provider operation
continues occupying a bounded slot until it settles or the process exits.

Tests cover 1,000 pool rejections without queued waiters, independent count/byte
ceilings, invalid configuration, 100 pre-parser middleware rejections, duplicate
release/callbacks, timeout/abort/error/finish ordering, listener/timer cleanup,
shared capacity across route registrations, authentication before parsing,
unrelated-route exemptions, real incomplete multipart abort/deadline recovery,
real socket close while providers still retain buffers, repeated parser/signature/
DB/provider/lock failures and permits retained through slow compensation.
Existing eight-file, per-file and aggregate-size restrictions remain unchanged.

## Remaining realistic load limits

- **No production-scale certification or safe user-count/RPS claim.** Thresholds
  are generous local regression alarms, not deployment/container memory budgets,
  sustained-load latency SLOs, throughput measurements or evidence of no leaks.
- **Upload admission is process-local, not a memory/global ingress cap.** Defaults
  bound admitted payload reservations to 100 MiB in two requests, not allocator/RSS
  usage. Parser/chunk/concat copies, SDK buffers, delayed GC, authenticated reads,
  pre-auth work, socket/kernel buffers and proxy buffering are outside that byte
  accounting. Replicas/workers each get their own pool. Keep ingress body, connection,
  rate/concurrency and timeout controls; size container memory for transient copies
  and other work, and add shared admission/streaming storage when needed. A proxy or
  serverless platform that buffers before Express is not protected by this middleware.
  Upstream JSON/form parsers skip multipart; their separate small non-multipart body
  budgets are not changed by this upload-specific fix.
- **Cache hits and consumer-owned copies are not a global memory budget.** The
  admission counters cover misses/in-flight consumers, not already-delivered results
  retained by callers or arbitrary concurrent hits. Fetchers must enforce their own
  response sizes/deadlines; an uncooperative fetch holds one bounded slot indefinitely.
  Cache and no-Redis budgets are process-local, not cross-instance guarantees.
- **Redis proof is atomic admission on one local server**, not HA/failover, network
  partitions, cluster deployment, multi-process throughput or multi-region scale.
  Two clients have real separate Redis connection IDs; they are in one Node process.
  Lease TTL is 30 seconds. Local provider concurrency defaults to 4 per process;
  configured shared Redis concurrency defaults to 4 across users/tenants. Operator
  settings and slow/non-cooperative providers require separate load/failure testing.
- **Tokens are not verified spend.** The reported output-token counts are deliberately
  synthetic fixture metadata. Requested ceilings are the sum of `max_tokens` sent,
  not actual generated tokens. Usage from failed primary attempts is unknown; input
  lengths, models/prices, internal billing and production fallback settings vary.
  Request budgets and consumed operation counts are not dollar caps.
- The 60-second deadline test uses a fake clock and cooperative mocked transport;
  it does not measure real provider latency or establish the same deadline for all
  callers (the writer supports server-selected budgets up to 240 seconds).
- No database queries, query plans, RLS concurrency, Bull worker soak, live object
  storage, real providers, container limits or production deployment were tested.
  Only upload admission/buffer cleanup changes production behavior in this follow-up;
  pre-existing unrelated work is preserved. No migrations, environment-file reads,
  deployments or commits were performed.