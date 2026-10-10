# Production generation reliability — 2026-09-30

Status: **P0 implemented and isolated-tested locally on 2026-10-01; production
rollout blocked on the drain gate below. Not a deployed or benchmarked fix.**
The original 2026-09-30 audit used read-only production logs/configuration/metrics, Redis INFO,
local source/SDK inspection, and public documentation. No paid generation,
publication, migration, secret rotation, or infrastructure change was performed.
The incident evidence and source-line references below describe that audit's
snapshot, not the subsequently changed local source.

## Production evidence

- Live revision: `tsp-app-r260930-ffba2a064ee6`, 100% traffic, `asia-south1`.
- Direct `gemini-3.1-pro-preview`; `AI_FALLBACK_PROVIDER` is blank. The earlier
  private key audit verified production and both local key aliases match the
  paid TSPAI key, with project billing enabled. No key values were logged.
- Two `/api/instant-review/selected` requests were accepted with HTTP 202:

| Request start (UTC) | Admission latency | Nearby provider failure (UTC) | Outcome |
| --- | --- | --- | --- |
| 16:58:00.533 | 1.660s | 16:58:22.173 | Gemini Pro, upstream 504, `ai_timeout` |
| 17:01:36.625 | 1.263s | 17:01:57.889 | Gemini Pro, upstream 504, `ai_timeout` |

The intervals from admission response to failure are approximately 19.98s
and 20.00s. These are request/provider-event timing correlations, not measured
provider span durations: current provider logs lack job correlation IDs.
They cannot conclusively associate either attempt with the screenshot's article.

- Job polling continued to return HTTP 200, generally around 0.33s per request.
- `/readyz` returned 200: database OK, queue reachable and queues ready.
- In the 16:55–17:05 UTC window, 143 matching revision log entries contained
  no ERROR-or-higher entries or matched OOM, worker/queue failure, or shutdown
  messages. This does not imply the AI calls succeeded: those failures use
  application-level diagnostic logs and failed job states.
- One-minute CPU utilization distribution means ranged from approximately
  0.9% to 37.7%; memory means from 15.8% to 19.1%. These samples do not establish
  instantaneous peaks, but provide no evidence of resource exhaustion here.

## Best-supported cause

The model was changed to Pro, but Create still uses a **20-second provider
operation budget**. This is too short for the observed attempts. Paid billing
does not remove latency or request deadlines.

- `server/services/openRouter.ts:15,329,435`: 20s default, passed to both the
  Gemini SDK and the application's AbortController.
- `server/services/punditBrain.ts:792`: the writer supplies no timeout override.
- Installed `@google/genai` 1.52.0, `dist/node/index.mjs:13160–13181,13334–13346`:
  the SDK creates a client abort timer **and sends `X-Server-Timeout: 20`**.
  Thus Google can return 504 before the application's abort timer fires.
- Pro already uses LOW thinking and an 8192 combined reasoning/output token cap.
  Reducing thinking from its default HIGH is therefore not an unimplemented fix.
- The independent editorial deadline is 300s; the browser monitors for 310s.
  Neither extends the inner 20s allowance. Cloud Run's request timeout is also
  300s, but admission already returned 202: increasing ingress timeout alone
  will not fix these failures.

The screenshot's remaining cards were not necessarily attempted. In
`client/src/components/dashboard/use-create-post-composer.ts:145–179`, the browser
submits one platform at a time and stops on the first unsuccessful result.
Four cards are four jobs, not one shared five-minute generation.

The PPC Land article was accessible during the public-page check. This alone
does not prove the app's crawler behavior at incident time. An observed Gemini
504 identifies a later provider-stage failure rather than a crawler rejection.

## Priority 0 — coordinated deadline fix

1. Add a trusted editorial-specific provider budget. Benchmark **60–90 seconds**
   as a starting range, not a latency promise. Constrain each operation and
   bounded repair by the remaining writer/job deadline, with cleanup headroom.
   Pass the effective budget to both the SDK and application controller.
2. Fix the shared AI lease together with that change. Its current **30s expiry
   has no renewal** (`server/services/aiProviderLimiter.ts`). Longer valid calls
   would otherwise outlive their shared concurrency reservations. Coordinate
   renewal/expiry, fail closed on uncertain admission/renewal, retain local slots
   until transport settles, and never shorten another live lease's key TTL.
3. Preserve direct paid Gemini only, LOW thinking, output validation, literal
   source attribution, and human review. Do not silently restore OpenRouter.
4. Keep retries bounded. Retry permitted transient failures with backoff/jitter;
   do not automatically replay an uncertain paid timeout or crashed worker.
   Cancellation cannot prove that remote compute or billing stopped.
5. Log allowlisted correlation, stage, elapsed time, effective budget and timeout
   origin, including local aborts. Current provider diagnostics skip an already
   aborted signal. Never log prompts, article text, credentials or raw SDK errors.

## Local P0 implementation checkpoint — 2026-10-01

| Item | Local implementation / acceptance |
| --- | --- |
| Coordinated deadlines | Trusted job UUID/deadline propagated from persisted enqueue time through source loading and writer work. Job ceiling remains 300s; writer ceiling 240s, with direct writer default 60s. Each provider operation is capped at a **provisional 90s**, shrinks against remaining writer/job time, and reserves **5s cleanup headroom**. Admission, repair, retry and fallback do not reset the clock. Generic non-editorial default remains 20s. |
| Shared lease safety | Operation budget +30s initial lease; renewal every TTL/3 while transport remains held. Redis TIME and longest-member key expiry; renewal cannot resurrect expired/released membership. Bounded uncertain Redis operations fail closed. Cancellation does not release the local slot/lease until transport settles. |
| Paid replay policy | Only an explicit HTTP 503 gets one automatic retry with 1000–1250ms backoff. Network errors, 500/502/529, 408/504, local deadline/cancel and lease loss do not retry or fall back. Explicit configured fallback remains supported for rejected credential/quota/rate-limit requests and exhausted explicit-503 retries; production fallback remains blank. No worker replay added. |
| Completion/cancellation | Time checks cover late provider responses, claim validation and final progress callbacks, independently of timer scheduling. A per-attempt signal facade blocks the installed Gemini SDK's already-aborted-listener race during preprocessing, without changing global fetch. |
| Private diagnostics | Operation/job UUID, stage, elapsed/effective budget, attempt and constrained timeout origin; immediate local abort diagnostics, no duplicate late log. No prompt, article/output/reasoning, tenant identity, keys, URLs or raw SDK body. |

Reproduce with `node test/generation-reliability/run.mjs`: **681/681 tests,
18 files, zero failures/skips**. Verified report:
`/tmp/tsp-generation-reliability-dXTaZx/tests.json`. The runner disables root
Vitest configuration and dotenv loading, sanitizes inherited environment, blocks
DB/unowned network, uses mocked providers and owned disposable Unix-socket Redis.
It includes real Gemini SDK serialization, responses beyond 35s, renewable
multi-client leases, ignored aborts, delayed timers, repairs, quota, ownership,
and real Bull/scoped Redis job-state regressions. Full TypeScript check passed.
Counts are one suite, not a sum of overlapping earlier checkpoints.

Final cross-checks: the ten-file budget runner passed 180/180 with ten metrics
(`/tmp/tsp-workflow-budgets-blrHdB/`); production client/server compilation and
asset compression passed into `/tmp/tsp-reliability-build-w38ieC/`, without
loading dotenv or replacing the existing `dist`. `design:check` and scoped
whitespace checks passed. Existing nonblocking PostCSS `from`, deprecated Idea
`execCommand`, cosmetic sidebar randomness and writer loop/complexity warnings
are not resolved by this milestone; do not describe these checks as a clean
whole-project lint run.

The signal workaround is specific to `@google/genai` 1.52.0 and must be retested
on SDK upgrades. It fences abort-listener registration, not every internal SDK
await: ordinary subsequent cancellation propagates to fetch, but it is not a
universal immediately-before-network wall-clock guarantee under event-loop stalls.
Remote compute/billing may continue after local abort, lease expiry or worker loss.
Neither mocks nor successful TypeScript checks establish production latency/SLOs.

### Mandatory release gate: drained cutover, not overlapping revisions

**Fresh local regression checkpoint, 2026-10-01:** after integrated UI changes,
the reliability runner again passed **681/681 in 18 files** at
`/tmp/tsp-generation-reliability-oJvKnk/tests.json`; budgets again passed
**180/180 in 10 files** at `/tmp/tsp-workflow-budgets-lp5Qfq/tests.json`.
The separate UX suite passed 1,150/1,150; counts overlap and must not be summed.
Type/token checks and temporary client/server compilation with 25 compressed
assets passed at `/tmp/tsp-ux-release-build-OlN05J/summary.json`. See the
[current handoff](UI_UX_RELEASE_HANDOFF_2026-10-01.md) for source/artifact hashes
and scope. These are not live-provider SLO/cost or deployment evidence; the gate
below is unchanged.

**Do not roll this directly alongside the previous workers.** Both revisions
use `tsp:{ai-generation}:leases`; old admission Lua resets the entire key TTL to
30s. A new 120s lease first renews at 40s. An old admission can therefore expire
all reservations before that renewal and break the shared concurrency bound.
Queue partitioning and 0% web traffic do not stop old always-CPU workers.

Selected rollout strategy for this milestone is an **authorized maintenance/drain
cutover**, not a claim that the new Lua is backward-compatible:

1. Gate every AI admission path (including onboarding/background work); stop
  producers/worker pickup and let active transport work settle. Preserve scoped
  job/intent outcomes. Treat started-but-unknown work as uncertain, never replay.
2. Stop all old consumers/processes, including no-traffic revisions and any
  separate workers. Verify none can execute old lease Lua. Do not assume
  Cloud Run's 10s shutdown grace is enough to drain a long provider call.
3. Confirm old work has settled/been fenced and reservations have expired or
  released normally. **Never flush Redis or delete live lease/dedupe keys.**
4. Activate only the new revision, verify queue/lease health and Gemini-only
  configuration, then reopen admission. No concurrency/instance increase here.
5. Rollback also requires draining new work before old lease code returns.
  The historic Flash/OpenRouter rollback is not a Pro-only equivalent; prepare
  and verify an appropriate rollback artifact/configuration first.

If that controlled cutover cannot be guaranteed, block deployment and ship a
separately reviewed **compatibility bridge retaining the short provider budget**
first. Do not bypass the shared cap with a new Redis key or merely shorten the
renewal interval. No rollout, drain or production setting change has been run.

## Priority 1 — recoverable user experience

The async queue already exists; adding another queue is not the immediate fix.

- Show real server stages: queued, reading source, generating, validating, ready.
  Show “taking longer” only while the job is genuinely active; do not disguise
  a terminal failure as continued background work. Keep Cancel available.
- Keep errors local to the affected card. Offer retry of that card and an
  explicit continue-remaining action; never regenerate completed cards silently.
  Pause the whole batch on shared quota/provider outages rather than multiplying
  failed requests. Preserve the requested one-at-a-time generation order.
- Persist the creation session and each validated result under tenant ownership,
  with retention/deletion limits and edit versioning. Existing sessionStorage
  holds only one acknowledged job/intent pointer, not the source, remaining batch,
  or delivered unsaved cards. Redis terminal results expire after five minutes.
  A durable batch coordinator can continue acknowledged work after navigation;
  browser-driven sequencing currently cannot submit remaining cards after exit.
- Reconnect to the original job on network loss/reload. Repair the no-job-ID
  uncertain-admission edge case with owned intent-to-job reconciliation and a
  fresh monitoring window, not a new generation intent or paid replay.
- Preserve one bounded validation repair, duplicate-spend guards, cancellation
  fencing, and tenant isolation. Recovery/autosave must not schedule, approve,
  hand off, or publish content automatically.

## Priority 2 — safe global capacity

These are separate risks, not established causes of the two timeouts above.

| Verified current state | Recommended change |
| --- | --- |
| Cloud Run min/max 1 instance; 1 CPU/1GiB; HTTP concurrency 80; editorial worker concurrency 2 | Separate web/API, generation workers and singleton/fenced scheduling before raising instance counts. Scale against queue age, measured throughput and provider quotas, not HTTP concurrency alone. |
| Redis INFO: 30-client maximum, 10 connected during audit, `volatile-lru`, AOF disabled; runtime URL is non-TLS | Use a queue-appropriate managed Redis configuration: TLS, `noeviction`, adequate connections, persistence/HA with tested recovery. Verify snapshots/control-plane settings; AOF disabled alone does not prove all backups are absent. Consider separating evictable caches from queues. |
| About 10 Redis connections per combined app instance | Budget deployments and failover headroom. Three instances would approach the 30-client ceiling even before administrative connections. Do not blindly raise Cloud Run max instances. |
| Runtime database endpoint is in `ap-southeast-1`; compute is in `asia-south1` | Measure backend round trips and evaluate co-location. Do not migrate production data without backup/recovery and cutover planning. |
| Current process/shared AI concurrency caps both 20; plan limits disabled | Tune bounded admission and fair per-tenant budgets against the paid project's actual RPM/TPM limits and spend targets. Paid credit is not unlimited capacity. |

Reuse a validated public source snapshot across a creation batch where safe;
keep private voice/context and generated text tenant-scoped. Reduce repeated
work before adding parallel generation. Benchmark any faster supported paid
Gemini model separately for quality; a model change is not an automatic fallback.

For global users, serve public static assets at the edge and measure Asia,
Europe and North America latency. Never cache authenticated API responses
publicly. Add regional API capacity only after state ownership, data residency,
queue routing and disaster recovery are designed; multi-region compute alone
does not accelerate a slow model call.

Deployments must drain generation work and fence ownership. Cloud Run's SIGTERM
grace is 10s; the application's 30s shutdown budget is not a platform guarantee.
Started/unknown provider calls must not be blindly re-executed after a restart.

## Acceptance before calling this fixed

- Isolated tests: slow Gemini responses beyond 20s, SDK/header budget propagation,
  multi-client lease safety, late/abort-ignoring transports, bounded repair,
  uncertainty/reload reconciliation, cancellation and cross-tenant rejection.
- Mocked load/fault tests: concurrent users, Redis disconnect/restart, worker
  termination, result-delivery loss and deployment overlap. No paid load test.
- Bounded authenticated production acceptance using the reported source and
  LinkedIn/X/Threads/Bluesky, with explicit spend bounds and no publication.
  Verify completion, exact card content, failed-card-only retry and recovery.
- Monitor generation success/timeout rate, queue age, stage/provider p50/p95/p99,
  repair frequency, Redis connections and usage. HTTP 5xx/uptime alerts alone
  miss failed async jobs returned inside HTTP 200 polling responses.
- Establish SLOs after measuring a representative sample; two failures and healthy
  anonymous smoke checks do not certify global reliability or an uptime target.

No system using external APIs can guarantee zero timeouts. The goal is fewer
avoidable deadlines and safe, understandable recovery without lost work or
surprise repeated charges.

## Scope still outstanding

Only the local P0 checkpoint above is implemented here; no new release is included.
The representative paid benchmark, controlled cutover/rollback, broader process
termination/failover fault testing, durable recovery and capacity work remain open.
Authenticated production browser acceptance remains pending normal account sign-in
and explicit spend bounds. Separate P1 UX progress is tracked in
[the UI/UX task tracker](UI_UX_AUDIT_TASKS_2026-09-30.md), not certified by backend tests. The
previous audit also found a stale local port-4300 process with a Flash/OpenRouter
override; its restart is still pending despite correct saved `.env` settings.
Both local health endpoints responded, but that is not fresh AI-path acceptance.

## References checked

- [Gemini troubleshooting and thinking latency](https://ai.google.dev/gemini-api/docs/troubleshooting)
- [Gemini API errors and deadlines](https://ai.google.dev/gemini-api/docs/api-errors)
- [Gemini thinking configuration](https://ai.google.dev/gemini-api/docs/thinking)
- [Cloud Run request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)
- [Cloud Run lifecycle contract](https://docs.cloud.google.com/run/docs/container-contract)

Current public Gemini documentation includes Interactions API examples; the
application uses `generateContent`. Installed SDK inspection, not those examples,
establishes this application's exact deadline/header behavior.

An offline SDK check also verified that 20,000ms and 90,000ms configurations
serialize server deadline headers of 20 and 90 seconds respectively. Both used
mock HTTP with dummy credentials and made zero network/provider requests.
