# TheSocialPundit — Enterprise Architecture

**Date:** 2026-08-28
**Status:** Proposed — awaiting review
**Scope:** Target architecture for 10M registered users, with super-admin, subscriber and corporate surfaces
**Supersedes for scale concerns:** `2026-08-28-replit-decoupling-and-stabilisation-design.md` (which remains valid as the near-term remediation plan; its phases 1–4 are complete)

---

## 1. Executive summary

### Verdict

Re-architecture is **required**, confined to three areas. The presentation and API tiers are sound and are retained.

| Area | Verdict | Rationale |
|---|---|---|
| Web/API tier (React, wouter, TanStack Query, Express, Drizzle) | **Retain** | Stateless, horizontally scalable, no layer fighting another |
| Content discovery pipeline | **Re-architect** | AI cost and work scale with *users*; must scale with *articles*. 375× token reduction available |
| Tenancy, authorization, entitlements | **Build** | Do not exist at all. Prerequisite for all three dashboards |
| Async/event layer | **Build** | Does not exist. Expensive work runs inside HTTP requests |
| Data architecture | **Re-architect** | No partitioning, no pagination, no retention, single-column indexes only |

### The decisive finding

Discovery AI work is currently `O(users)`. Inverting it to `O(articles)` reduces discovery input tokens by **375×** (6.00B/day → 16M/day). This is simultaneously the largest scaling fix, the largest margin fix, and the largest operational-load fix in this document. It is not an optimisation; the current shape cannot reach 10M at any price.

### Non-goals

Explicitly rejected as cargo-cult at this scale:

- Microservice-per-domain decomposition. A modular monolith with enforced boundaries plus **one** extracted pipeline service is the correct decomposition (§4).
- Event sourcing / CQRS as a global pattern. Applied narrowly to analytics read models only.
- Kubernetes. Managed platforms deliver the same SLOs at a fraction of the operational surface.
- GraphQL or tRPC migration. REST with typed contracts is sufficient and already in place.
- Multi-region active-active. Deferred behind an explicit trigger (§16).

---

## 2. Requirements, assumptions and SLOs

### Capacity model

All figures derive from 10M registered users with stated engagement assumptions. **These assumptions are the most important thing to validate with real data**, because every sizing decision below is downstream of them.

| Input | Value |
|---|---|
| Registered | 10,000,000 |
| MAU / registered | 30% → 3.0M MAU |
| DAU / MAU | 20% → **600k DAU** |
| Sessions per DAU per day | 1.5 |
| API requests per session | 25 |

| Derived | Value |
|---|---|
| Requests/day | 22.5M |
| Average | 260 rps |
| Peak (×4, timezone clustering) | 1,042 rps |
| **Design target (×3 headroom)** | **3,125 rps** |

### Service level objectives

| SLI | SLO | Measurement |
|---|---|---|
| API availability (read paths) | 99.95% monthly | Successful non-5xx / total, excluding client errors |
| API availability (write paths) | 99.9% monthly | As above |
| API latency p95 (read) | < 300 ms | Server-side, excluding LLM paths |
| API latency p99 (read) | < 800 ms | As above |
| Post generation p95 | < 8 s | End-to-end, user-perceived |
| Instant Review p95 | < 15 s | Streamed; first token < 3 s |
| Inbox freshness | 95% of tenants see articles < 4 h old | Ingestion lag percentile |
| Error budget | 0.05%/month ≈ 21 min | Gates feature releases when exhausted |

LLM-dependent paths get separate SLOs because they depend on a third party. They must **never** be on the critical path for page render (§9.4).

---

## 3. Reference architecture

### 3.1 System context

```
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │Subscriber│   │  Corp.   │   │  Super   │
   │          │   │  Admin   │   │  Admin   │
   └────┬─────┘   └────┬─────┘   └────┬─────┘
        └──────────────┼──────────────┘
                       ▼
              ┌─────────────────┐      ┌──────────────┐
              │ TheSocialPundit │◄────►│ Clerk (IdP)  │
              │                 │      ├──────────────┤
              │                 │◄────►│ Stripe       │
              │                 │◄────►│ Gemini       │
              │                 │◄────►│ Resend       │
              │                 │◄────►│ LinkedIn API │
              └─────────────────┘      └──────────────┘
                       ▲
                       │ RSS / publisher feeds
              ┌────────┴────────┐
              │ Content sources │
              └─────────────────┘
```

### 3.2 Container view

```
 ┌─ EDGE ─────────────────────────────────────────────────────────┐
 │  CDN + WAF + rate limiting (platform)                          │
 │  Static SPA assets, immutable, long-cache                      │
 └────────────────────────┬───────────────────────────────────────┘
                          ▼
 ┌─ APPLICATION (stateless, autoscaled) ──────────────────────────┐
 │  API service — modular monolith                                │
 │  ┌──────────┬──────────┬──────────┬──────────┬──────────────┐  │
 │  │ identity │ content  │ authoring│ analytics│ billing      │  │
 │  │ &tenancy │ discovery│          │          │ &entitlement │  │
 │  └──────────┴──────────┴──────────┴──────────┴──────────────┘  │
 │  admin (cross-cutting, elevated) · platform (audit, flags)      │
 └───────┬───────────────┬───────────────┬────────────────────────┘
         │               │               │
         ▼               ▼               ▼
 ┌─ DATA ────────┐ ┌─ CACHE/STATE ─┐ ┌─ EVENTS ──────────────────┐
 │ Postgres      │ │ Redis         │ │ Durable queue + scheduler │
 │  primary      │ │  cache        │ │  (retries, DLQ, replay)   │
 │  + replicas   │ │  rate limits  │ └────────────┬──────────────┘
 │  + pgvector   │ │  quota counters│              ▼
 │ Object storage│ │  idempotency  │ ┌─ PIPELINE SERVICE ────────┐
 │  (archive)    │ └───────────────┘ │ crawl · extract · embed   │
 │ Warehouse     │                   │ match · rollup · sync     │
 └───────────────┘                   └───────────────────────────┘
```

### 3.3 Why the pipeline is the only extracted service

Extraction is justified when the runtime profile genuinely differs. It does here, on four axes:

1. **Duration** — crawls and embedding batches run for minutes; API requests must return in milliseconds.
2. **Scaling signal** — pipeline scales with *source count and article volume*; API scales with *user traffic*. Coupling them means over-provisioning one to serve the other.
3. **Failure semantics** — pipeline work is retryable and idempotent; API requests are interactive and must fail fast.
4. **Resource shape** — embedding batches are memory- and network-bound, not request-bound.

Every other domain shares the API's runtime profile and stays in the monolith, behind enforced module boundaries so extraction later is mechanical rather than archaeological.

### 3.4 Enforcing module boundaries

A modular monolith degrades without enforcement. Three mechanisms:

- **Directory-per-module** under `server/modules/<domain>/` with `index.ts` as the sole public surface.
- **Lint rule** (`eslint-plugin-boundaries` or equivalent) forbidding deep imports across modules — `modules/authoring/service.ts` may not import `modules/billing/internal/*`.
- **No cross-module database access.** A module reads only its own tables; cross-domain reads go through the owning module's public interface. This is the rule that makes extraction possible.

---

## 4. Domain decomposition (bounded contexts)

| Module | Owns | Key tables |
|---|---|---|
| **identity-tenancy** | Tenants, memberships, roles, tenant lifecycle | `tenants`, `tenant_members`, `users` |
| **content-discovery** | Sources, articles, embeddings, tenant matching, inbox | `sources`, `articles`, `article_embeddings`, `inbox_items` |
| **authoring** | Drafts, generation, tonality, Instant Review | `drafts`, `generation_jobs` |
| **distribution** | Social connections, publishing, scheduling | `social_accounts`, `publications` |
| **analytics** | Metrics ingestion, rollups, reporting read models | `social_analytics`, `analytics_daily`, `analytics_monthly` |
| **billing-entitlement** | Plans, subscriptions, usage metering, quotas | `plans`, `subscriptions`, `entitlements`, `usage_counters` |
| **platform** | Audit log, feature flags, notifications, jobs | `audit_log`, `feature_flags`, `job_runs` |
| **admin** | Cross-domain read + privileged operations | (no tables; composes others) |

`admin` deliberately owns no tables. It is a composition layer over the other modules' public interfaces, which prevents the classic failure where an admin surface grows its own divergent copy of business logic.

---

## 5. Multi-tenancy and isolation

### 5.1 Model: shared schema, row-level tenant scoping

Three options were considered:

| Option | Isolation | Operability at 10M | Verdict |
|---|---|---|---|
| Database per tenant | Strongest | 10M databases — untenable | Rejected |
| Schema per tenant | Strong | Thousands of schemas, migration nightmare | Rejected |
| **Shared schema + `tenant_id`** | Enforced in software + RLS | One schema, partitionable | **Selected** |

### 5.2 The tenant as the universal scope

Every domain row carries `tenant_id`. A tenant is created for **every** user at signup — a personal tenant of one. A corporate account is simply a tenant with more than one member.

This is the single most consequential decision in this document, and it must be made before launch. Retrofitting `tenant_id` across ~1B `inbox_items` and 7.3B `social_analytics` rows is a multi-week, high-risk migration. Introducing it now, at zero rows, costs a schema definition.

```sql
CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('personal','corporate')),
  name          text NOT NULL,
  clerk_org_id  text UNIQUE,              -- null for personal tenants
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_members (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','admin','manager','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX ON tenant_members (user_id);
```

### 5.3 Defence in depth

Software scoping alone is one `WHERE` clause away from a cross-tenant data leak — the highest-severity bug class in a multi-tenant system. Three independent layers:

1. **Repository layer** — every query goes through a repository that takes a `TenantContext` and injects `tenant_id`. Raw `db.select()` in a module is a lint error.
2. **Postgres Row-Level Security** as a backstop, with `app.tenant_id` set per transaction. Defends against bugs in layer 1.
3. **Contract tests** — an automated suite that, for every list/read endpoint, provisions two tenants and asserts tenant A cannot observe tenant B's rows. This runs in CI and gates deploys.

Layer 3 is what makes layers 1 and 2 trustworthy over time.

---

## 6. Identity, authentication, authorization

### 6.1 Authentication

Clerk remains the IdP. Session tokens carry `sub` (native user id) only; the application resolves tenancy and roles from its **own** database rather than from token claims. This is deliberate — the existing codebase already failed once by depending on a custom `sessionClaims.userId` claim that was never configured.

Corporate tenants map to **Clerk Organizations**, which supplies invitations, membership management and role assignment UI. `tenants.clerk_org_id` is the join. Clerk is the source of truth for *membership*; the local database is the source of truth for *entitlements and data scoping*, reconciled by webhook with a periodic drift-detection job.

Enterprise SSO (SAML/OIDC) is available through Clerk when corporate tiers demand it — no architectural change required.

### 6.2 Authorization: RBAC with attribute conditions

Roles grant permissions; a small set of attribute conditions handles ownership.

```
Permission := <resource>:<action>[:scope]
scope ∈ { own, tenant, all }
```

| Role | Scope | Notes |
|---|---|---|
| `member` | Own content within tenant | Default for corporate employees and all personal tenants |
| `manager` | Tenant content, read + approve | Reviews and approves member drafts |
| `admin` | Tenant configuration, members, billing | Corporate tenant administrator |
| `owner` | All of tenant + delete tenant | Exactly one per tenant |
| `platform_support` | Cross-tenant **read**, time-boxed | Super admin, least privilege |
| `platform_admin` | Cross-tenant read + privileged ops | Super admin, break-glass |

### 6.3 Permission matrix

| Permission | member | manager | admin | owner | support | plat.admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `inbox:read:own` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `draft:write:own` | ✓ | ✓ | ✓ | ✓ | — | — |
| `draft:read:tenant` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `draft:approve:tenant` | — | ✓ | ✓ | ✓ | — | — |
| `analytics:read:tenant` | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `brand:write:tenant` | — | — | ✓ | ✓ | — | — |
| `member:invite:tenant` | — | — | ✓ | ✓ | — | — |
| `billing:manage:tenant` | — | — | ✓ | ✓ | — | — |
| `tenant:delete` | — | — | — | ✓ | — | ✓ |
| `tenant:read:all` | — | — | — | — | ✓ | ✓ |
| `flag:write:all` | — | — | — | — | — | ✓ |
| `impersonate:all` | — | — | — | — | — | ✓ |
| `quota:override:all` | — | — | — | — | — | ✓ |

### 6.4 Privileged access controls

Super-admin capability is a liability as much as a feature. Required controls:

- **Every** cross-tenant read and privileged action writes an `audit_log` entry with actor, target tenant, justification and correlation id — non-optional, enforced in the permission middleware rather than left to callers.
- Impersonation is time-boxed (default 30 min), requires a stated reason, is visibly banner-flagged in the UI, and notifies the tenant owner.
- `platform_admin` requires step-up MFA re-authentication.
- Support access is granted per-incident and expires; standing cross-tenant access is `platform_support` read-only.

---

## 7. The three product surfaces

### 7.1 Subscriber dashboard

Existing surface, hardened. Additions required by this architecture:

- Quota and usage display (posts generated / remaining, plan tier)
- Upgrade prompts at quota boundaries
- Explicit error and empty states distinguished from one another — the current pages render a failed query as "empty"
- Pagination on inbox, drafts and published lists
- Streamed generation with progress, replacing blocking waits

### 7.2 Corporate dashboard

Tenant-scoped, gated on `admin`/`manager` roles.

| Capability | Detail |
|---|---|
| Member management | Invite, remove, change role (via Clerk Organizations) |
| Brand guidelines | Tone, banned terms, required disclosures — injected into generation prompts |
| Approval workflow | `draft → pending_review → approved → published`, with manager queue |
| Aggregate analytics | Tenant rollups, per-member contribution, engagement trends |
| Seat and billing | Seat count, plan, invoices, usage against tenant quota |
| Audit trail | Tenant-scoped view of its own audit events |

### 7.3 Super admin dashboard

Platform-wide, `platform_support` / `platform_admin`.

| Capability | Detail |
|---|---|
| Tenant explorer | Search, status, plan, usage, health |
| User explorer | Lookup, session state, entitlement resolution trace |
| **AI cost observatory** | Spend by tenant / model / feature; anomaly alerting |
| Quota administration | Inspect, override, reset — audited |
| Feature flags | Per-tenant, per-cohort, percentage rollout, kill switches |
| Pipeline operations | Source health, ingestion lag, DLQ inspection and replay |
| Impersonation | Time-boxed, audited, notified |
| Revenue and churn | Subscription state, MRR, conversion funnel |

Feature flags and pipeline operations are the two highest-leverage items: the first makes every subsequent rollout reversible, the second makes the pipeline debuggable in production.

---

## 8. Data architecture

### 8.1 Volume at target

| Table | Rows | Size | Strategy |
|---|---|---|---|
| `social_analytics` | **7.30B/yr** | ~3.65 TB | Partition monthly; retain 3 months raw; roll up to `analytics_daily`/`analytics_monthly`; archive to object storage |
| `inbox_items` | **1.00B** | ~1.00 TB | Partition by hash(`tenant_id`); retain 100/tenant; TTL job |
| `drafts` | 0.20B | ~400 GB | Partition by hash(`tenant_id`) |
| `audit_log` | 0.20B/yr | ~80 GB | Partition monthly; archive after 13 months (retain per compliance) |
| `articles` | ~7M/yr | ~35 GB | **Global, not per-tenant** — the inversion's payoff |
| `article_embeddings` | ~7M/yr | ~45 GB | pgvector, HNSW index |

`social_analytics` dominates and is the clearest partitioning requirement. Raw daily snapshots have no analytical value after a few months; rollups do.

### 8.2 Indexing

Current state is single-column `user_id` indexes only. Required:

```sql
-- inbox is always filtered by status within a tenant
CREATE INDEX ON inbox_items (tenant_id, status, created_at DESC);
-- dedupe check on ingest
CREATE UNIQUE INDEX ON inbox_items (tenant_id, article_id);
-- draft lists
CREATE INDEX ON drafts (tenant_id, status, updated_at DESC);
-- analytics time-range queries
CREATE INDEX ON social_analytics (tenant_id, provider, snapshot_date DESC);
-- vector similarity
CREATE INDEX ON article_embeddings USING hnsw (embedding vector_cosine_ops);
```

Every list endpoint uses **keyset pagination** (`WHERE (created_at, id) < (:cursor)`), not `OFFSET`. Offset pagination degrades linearly and is unusable at these row counts.

### 8.3 Read/write topology

- **Primary** for all writes and read-after-write paths.
- **2+ read replicas** for analytics, admin explorers and reporting. Replica lag is tolerable for these and must be surfaced in the UI where it matters.
- **Transaction-mode connection pooler** in front of Postgres, mandatory for serverless callers. Application pool size pinned to 1 per instance.
- **Warehouse** (managed columnar) fed by CDC for product analytics and cohort work. Never query the OLTP primary for business intelligence.

### 8.4 Migration discipline

Versioned, forward-only, reviewed SQL — `drizzle-kit generate` committed, `drizzle-kit migrate` on deploy. `push` is a local-development tool only. Every migration touching a large table must be online (`CREATE INDEX CONCURRENTLY`, additive-then-backfill-then-constrain), never a blocking `ALTER`.

---

## 9. Content and AI pipeline — the inversion

### 9.1 Current shape and why it fails

`POST /api/inbox/refresh` → `engine.processForUser(userId, profile)` → fetch RSS → Gemini `scoreArticles` for that user → write inbox. Per user. Inside the request.

At 600k DAU that is 600k scoring calls/day over largely **the same global article set**, plus 600k redundant crawl cycles, plus an outbound `validateUrl()` network call per article in a loop, plus N+1 inserts.

### 9.2 Target shape

```
 Scheduler (cron, per source cadence)
        │
        ▼
 ┌─ CRAWL ──────────┐   fetch feed, ETag/If-Modified-Since, robots-aware
 │  per source      │   → emit ArticleDiscovered
 └────────┬─────────┘
          ▼
 ┌─ EXTRACT ────────┐   readability extraction, canonical URL, dedupe by
 │  content + meta  │   (canonical_url, content_hash) → ArticleIngested
 └────────┬─────────┘
          ▼
 ┌─ EMBED ──────────┐   ONE embedding per article, batched
 │  → pgvector      │   → ArticleEmbedded
 └────────┬─────────┘
          ▼
 ┌─ MATCH ──────────┐   per-tenant interest vector (from onboarding +
 │  vector ANN      │   behavioural feedback) → top-k articles
 └────────┬─────────┘   → InboxItemsCreated (bulk insert)
          ▼
    inbox_items
```

### 9.3 The payoff, quantified

| | Discovery calls/day | Discovery input tokens/day |
|---|---|---|
| Current, `O(users)` | 600k scoring | **6.00B** |
| Inverted, `O(articles)` | 20k embeddings | **16M** |
| Reduction | 30× | **375×** |

Beyond cost: crawl load on publishers drops by the same order, inbox latency becomes a database read rather than a multi-second AI call, and article freshness becomes a pipeline SLO instead of a function of whether a user happened to click refresh.

**LLM ranking is not eliminated — it is repositioned.** Vector similarity does cheap wide recall; an optional LLM re-rank runs over the top ~20 candidates *per tenant per day* if quality demands it, which is bounded and tier-gateable. That is a deliberate quality/cost dial, not an accident.

### 9.4 Generation paths

Post generation stays per-user — it *is* the product. It becomes a **job**, not a request:

- Client requests generation → job enqueued → `202` with job id → result streamed over SSE.
- Instant Review's 8-call fanout becomes 8 parallel steps in one durable job, with per-`(article, platform, tonality)` caching. A second user reviewing the same article pays nothing.
- Every LLM call is wrapped by a metering interceptor recording tenant, feature, model, tokens in/out and cost, written to `usage_counters` (§10.2). **No LLM call may bypass it.**
- Prompts are versioned artifacts with recorded template ids, so output changes are attributable and A/B testable.

### 9.5 AI cost governance

| Control | Mechanism |
|---|---|
| Pre-flight quota check | Redis counter, atomic decrement; reject over-quota before the call |
| Per-tenant spend ceiling | Hard cap with configurable soft-alert threshold |
| Model tiering | Cheap model for scoring/classification; capable model only for user-visible generation |
| Semantic caching | Cache by `(prompt_template_version, normalised_input_hash)` |
| Platform circuit breaker | Global daily spend ceiling with automatic degradation to cached/queued mode |
| Cost attribution | Every call tagged; surfaced per tenant and per feature in the admin observatory |

The circuit breaker matters: without a global ceiling, a bug or abuse pattern can generate unbounded spend in hours.

### 9.6 LLM cost model

Structural formula; **rates must be verified against current provider pricing before any pricing commitment.**

```
daily_cost = (input_tokens/1e6 × rate_in) + (output_tokens/1e6 × rate_out)
           = (1200 × rate_in) + (300 × rate_out)          [at 600k calls/day]
```

At illustrative Gemini 2.5 Flash rates of $0.30/1M in and $2.50/1M out, that is roughly **$1.1k/day ≈ $33k/month ≈ $0.055 per DAU per month** — comfortably coverable by a subscription, and dominated by output tokens, which is where optimisation effort belongs.

I attempted to measure real per-call token counts from the prompt templates and the results were unreliable, because prompts are assembled from multiple sources including large per-industry configuration blocks. **Instrument actual token telemetry before setting prices.** Treat the figure above as a shape, not a number.

---

## 10. Event and async architecture

### 10.1 Design rules

- **Durable queue with retries, exponential backoff, and a dead-letter queue.** DLQ inspection and replay is a first-class admin capability, not a database console task.
- **Every consumer is idempotent**, keyed on an explicit idempotency key. At-least-once delivery is assumed.
- **Events are versioned, additive-only contracts.** Consumers ignore unknown fields.
- **The outbox pattern** for state changes that must produce events: write row and outbox entry in one transaction, publish asynchronously. This removes the dual-write failure mode.
- **Payloads carry ids, not entity snapshots** — consumers re-read. Avoids stale-data bugs and unbounded payload growth.

### 10.2 Core event catalogue

| Event | Producer | Consumers |
|---|---|---|
| `TenantCreated` | identity | billing (trial), platform (audit) |
| `ArticleIngested` | pipeline | embed step |
| `ArticleEmbedded` | pipeline | match step |
| `InboxItemsCreated` | pipeline | notifications |
| `GenerationRequested` | authoring | generation worker |
| `GenerationCompleted` | worker | client SSE, usage metering |
| `LlmCallRecorded` | metering interceptor | usage counters, cost observatory |
| `QuotaExceeded` | entitlement | notifications, upgrade prompt |
| `SubscriptionChanged` | billing (Stripe webhook) | entitlement recompute |
| `PublicationRequested` | distribution | publish worker |

### 10.3 Scheduled work

| Job | Cadence | Notes |
|---|---|---|
| Source crawl | Per-source (5 min – 6 h) | Tiered by publisher velocity |
| Embedding backfill | Continuous | Batched |
| Tenant match refresh | Hourly | Only tenants with changed interest vectors |
| Analytics rollup | Daily | Feeds `analytics_daily` |
| Analytics provider sync | Daily per account | Rate-limit aware, jittered |
| Retention/TTL enforcement | Daily | Inbox trim, partition drop, archive |
| Entitlement reconciliation | Hourly | Stripe drift detection |
| Clerk membership drift check | Daily | Org membership reconciliation |

---

## 11. API architecture

- **Versioned at the path** (`/api/v1/`). v1 is frozen on first external commitment; breaking changes go to v2 with a published deprecation window.
- **Consistent envelope.** Errors carry `{ code, message, details?, correlation_id }`. Codes are stable, machine-readable strings — clients never parse prose.
- **Status discipline**, extending the contract already established in the remediation work: `401` unauthenticated · `403` authenticated but unauthorized · `404` not found or not visible to tenant · `409` conflict · `422` semantically invalid · `429` quota/rate limited with `Retry-After` · `5xx` server fault.
- **Tenant-not-found returns 404, never 403** — a 403 confirms existence and leaks the tenant namespace.
- **Idempotency keys** required on all non-idempotent mutations.
- **Keyset pagination** with opaque cursors on every list endpoint. Hard `max_page_size`.
- **OpenAPI generated from Zod schemas**, published, and used to generate the typed client. One source of truth for request/response shapes.

---

## 12. Caching and performance

| Layer | Contents | Invalidation |
|---|---|---|
| CDN | SPA assets, marketing pages | Immutable hashed filenames; purge on deploy |
| Redis (shared) | Article/source data, tenant interest vectors, engine config | TTL + event-driven |
| Redis | Rate limit and quota counters | Sliding window |
| Redis | Idempotency records | TTL 24 h |
| Postgres | Materialised analytics rollups | Scheduled refresh |
| In-process | Nothing tenant- or user-scoped | — |

**In-process caching of shared state is prohibited.** The existing `articleCache.ts` module-scope `Map` is the exact anti-pattern: correct in one long-lived process, silently useless across autoscaled instances, and a source of inconsistent behaviour that is very hard to diagnose. Same for in-memory rate limiting, which currently guards the most expensive AI paths and would be effectively unenforced.

---

## 13. Security and compliance

### 13.1 Controls

| Domain | Control |
|---|---|
| Transport | TLS 1.3, HSTS, secure cookie attributes |
| At rest | Encrypted volumes; column-level encryption for OAuth tokens |
| Secrets | Managed secret store, rotation policy, no secrets in env files in production |
| Tenant isolation | Repository scoping + RLS + CI contract tests (§5.3) |
| Input validation | Zod at every boundary; strict output serialisation allowlists |
| SSRF | URL validation and egress allowlist on crawl and user-supplied URLs — the ingestion pipeline fetches attacker-influencable URLs by design |
| Rate limiting | Edge (IP) + application (tenant) + quota (plan) |
| Dependencies | Automated audit, pinned lockfile, SBOM |
| Access | SSO + MFA for staff; least privilege; time-boxed elevation |
| Audit | Append-only, tamper-evident, covers all privileged and cross-tenant actions |

SSRF deserves emphasis: a content pipeline that fetches URLs discovered from third-party feeds is a textbook SSRF vector into internal networks. The existing `urlValidator.ts` is the right instinct and must become a hard egress boundary.

### 13.2 Privacy and data lifecycle

- **Data classification** on every column: public / internal / personal / secret.
- **GDPR/CCPA**: export and erasure as first-class, tested workflows — including derived data (embeddings, rollups, warehouse copies), which is where naive implementations fail.
- **Data residency** as a tenant attribute, so an EU-resident deployment is a configuration rather than a re-architecture.
- **Retention** enforced by automated jobs, not policy documents.
- **Subprocessor register** for Clerk, Stripe, Gemini, Resend — required for enterprise procurement.

### 13.3 Compliance posture

SOC 2 Type II is the likely requirement for corporate customers. Architectural prerequisites, all of which are cheap now and expensive later: comprehensive audit logging, access reviews, change management through CI/CD with review gates, backup/restore testing, incident response runbooks, and vendor management. Building these in from the start avoids a retrofit under deal pressure.

---

## 14. Observability

### 14.1 Three pillars, one correlation id

A `correlation_id` is generated at the edge, propagated through every API call, event, job and LLM invocation, and returned in error envelopes. Without it, debugging an async pipeline is guesswork.

- **Structured logs** — JSON, no PII, `tenant_id` + `correlation_id` on every line, centralised with retention tiers.
- **Distributed tracing** — OpenTelemetry across API → queue → worker → external calls. Queue boundaries are exactly where traces usually break and where the hard bugs live.
- **Metrics** — RED (rate/errors/duration) per endpoint; USE for infrastructure; plus domain metrics.

### 14.2 Key domain metrics

| Metric | Why |
|---|---|
| Ingestion lag per source | Directly drives the inbox-freshness SLO |
| Embedding backlog depth | Leading indicator of inbox staleness |
| Match quality (save/dismiss ratio) | The product's core quality signal |
| LLM cost per tenant / feature / model | The binding business constraint |
| LLM error and timeout rate by model | Third-party dependency health |
| Quota rejection rate | Pricing/packaging signal |
| DLQ depth and age | Reliability early warning |
| Replica lag | Correctness of admin/analytics reads |

### 14.3 Alerting

Alert on **symptoms and SLO burn rate**, not causes. Multi-window burn-rate alerts (fast: 2% budget in 1 h; slow: 10% in 6 h). Every alert has a runbook; alerts without runbooks are deleted. Page only on user-impacting or spend-impacting conditions.

---

## 15. Reliability, DR and graceful degradation

### 15.1 Targets

| Objective | Target |
|---|---|
| RPO | ≤ 5 min (PITR + WAL archiving) |
| RTO | ≤ 1 h (primary region failure) |
| Backup restore test | Quarterly, and it must actually be performed |

### 15.2 Degradation ladder

The system must have defined, tested behaviour when dependencies fail — decided in advance, not improvised during an incident.

| Failure | Degradation |
|---|---|
| LLM provider down | Generation queues and retries; inbox and all reads unaffected; UI states the delay |
| LLM provider slow | Circuit breaker opens; queue depth grows; users see queued status |
| Redis down | Fail **closed** on quotas (protects spend), fall back to database for cache reads |
| Read replica lag | Route affected reads to primary, or show a staleness indicator |
| Pipeline stalled | Inbox serves existing items; freshness SLO breach alerts; no user-facing error |
| Stripe webhook outage | Entitlements hold last-known-good; reconciliation job repairs on recovery |
| Queue outage | API returns `503` with `Retry-After` on job-creating endpoints only; reads unaffected |

Note the deliberate asymmetry: Redis fails *closed* for quota (an unbounded spend risk) but *open* for caching (a latency risk). Failure modes should be chosen per-dependency against what is actually at stake.

### 15.3 Resilience practices

Health checks distinguishing liveness from readiness · dependency timeouts and bulkheads everywhere · retries with jittered exponential backoff and budgets · load shedding by request priority · progressive delivery (canary + flags) with automated rollback on SLO regression · quarterly game-day exercises against the ladder above.

---

## 16. Platform, environments and delivery

### 16.1 Platform split

| Tier | Placement | Rationale |
|---|---|---|
| SPA + marketing | Vercel CDN | Static, cacheable, global |
| API | Vercel Functions (Node) | Stateless, autoscaling; same-origin with the SPA preserves cookie auth |
| Pipeline workers | Long-running managed compute | Minute-scale jobs exceed function limits |
| Scheduler | Managed cron + durable job platform | Retries, observability, replay |
| Postgres | Managed, serverless-aware, pgvector, replicas, PITR | Neon recommended: resolves serverless pooling and pgvector in one choice |
| Redis | Managed, HTTP-accessible | Serverless-compatible connection model |
| Object storage | Managed | Archive, exports |
| Warehouse | Managed columnar | Analytics off the OLTP path |

Deploying SPA and API as one Vercel project is a **load-bearing decision**: it keeps them same-origin, which is what makes cookie-based auth correct. Splitting them onto separate origins requires switching to bearer tokens.

### 16.2 Environments

`local` → `preview` (per pull request, seeded, isolated database branch) → `staging` (production-shaped, anonymised data, load-tested) → `production`. Infrastructure as code for all of them; no console-configured production resources.

### 16.3 CI/CD gates

Typecheck → lint (including module-boundary rules) → unit → integration → **tenant-isolation contract tests** → migration dry-run → build → preview deploy → E2E smoke → canary → progressive rollout with automated SLO-based rollback.

### 16.4 Scaling triggers

Nothing below is built before its trigger fires. Premature construction is the main cost risk in a plan of this size.

| Trigger | Action |
|---|---|
| Launch → 10k users | Single primary, no replicas, cron ingestion, Redis for quotas/limits |
| 10k | Partition `social_analytics`; retention jobs live |
| 50k | First read replica; warehouse + CDC |
| 100k | Queue-based match fanout; per-tenant rate limits; semantic caching |
| 500k | Second replica; partition `inbox_items`; regional CDN tuning |
| 1M | Evaluate sharding by `tenant_id`; read-local multi-region |
| 5M+ | Multi-region active-active if latency SLOs demand it |

---

## 17. Testing strategy

| Layer | Coverage |
|---|---|
| Unit | Domain logic, entitlement resolution, permission evaluation, gate state machine |
| Integration | Repository + real Postgres; queue consumers; webhook handlers |
| **Tenant isolation** | Every read/list endpoint, two-tenant cross-visibility assertions — **CI-gating** |
| Contract | OpenAPI conformance; event schema compatibility |
| E2E | Critical journeys per surface: signup → onboarding → generate → publish; corporate invite → approve; admin impersonate → audit |
| Load | Sustained 3,125 rps design target; soak; spike; pipeline throughput |
| Chaos | Degradation ladder (§15.2) verified per dependency |
| Security | SAST, dependency audit, periodic penetration test |

The permission matrix (§6.3) should be table-driven in both implementation and tests, so a row added to the matrix forces a test.

---

## 18. Cost model

Structural, at 600k DAU. Rates require verification; the purpose here is relative magnitude and sensitivity.

| Component | Driver | Relative magnitude |
|---|---|---|
| **LLM inference** | 600k calls/day, output-token dominated | **Largest single line** |
| Postgres | ~5 TB, primary + 2 replicas | Large |
| Warehouse + object storage | Analytics, archive | Moderate |
| Pipeline compute | Crawl/embed throughput | Moderate |
| API compute | 3,125 rps design peak | Moderate |
| Redis | Counters, cache | Small |
| CDN/egress | Static + API responses | Small |
| Clerk, Stripe, Resend | Per-MAU / per-transaction | Clerk scales with MAU — model it explicitly |

Two sensitivities worth designing around: LLM **output** tokens dominate inference cost, so response-length discipline and caching are the highest-leverage optimisations; and per-MAU vendor pricing (identity in particular) becomes a material line at 3M MAU and should be negotiated before it does.

---

## 19. Implementation roadmap

Each wave ends in a shippable, independently valuable state. Waves 0–2 are prerequisites for everything after them.

### Wave 0 — Deployment foundation
Vercel deployment; managed Postgres with pooling; versioned migrations; boot-time env validation; secrets management; observability baseline (structured logs, tracing, correlation ids, Sentry); CI gates.
**Exit:** production deploys are routine, observable and reversible.

### Wave 1 — Tenancy, authorization, isolation *(irreversible; do before launch)*
`tenants` / `tenant_members`; `tenant_id` on every domain table; repository scoping layer; RLS; permission model and middleware; audit log; tenant-isolation contract tests in CI; Clerk Organizations integration; module boundaries with lint enforcement.
**Exit:** every query is tenant-scoped and provably so; roles enforce the §6.3 matrix.

### Wave 2 — Platform primitives
Redis for cache, rate limits, quota counters and idempotency (removing the in-process `Map` and in-memory limiter); durable queue + scheduler with DLQ; outbox pattern; feature flags; keyset pagination on all list endpoints; composite indexes.
**Exit:** no shared state in process; no expensive work in the request path.

### Wave 3 — Pipeline inversion *(largest technical and margin win)*
Global source registry and crawler; extraction and canonical dedupe; embedding pipeline into pgvector; tenant interest vectors; ANN matching with bulk insert; optional bounded LLM re-rank; SSRF egress boundary; ingestion-lag SLO and source-health monitoring.
**Exit:** discovery AI cost is `O(articles)`; inbox freshness is a pipeline SLO.

### Wave 4 — Billing, entitlements, metering
Plans and tiers; Stripe integration with webhook reconciliation; LLM metering interceptor on every call; `usage_counters`; pre-flight quota enforcement; spend ceilings and platform circuit breaker; upgrade flows.
**Exit:** every LLM call is attributed and every plan boundary enforced.

### Wave 5 — Generation as jobs
Generation and Instant Review as durable multi-step jobs; SSE streaming; per-`(article, platform, tonality)` caching; semantic cache; prompt versioning.
**Exit:** no LLM call blocks an HTTP request; Instant Review is cached across tenants.

### Wave 6 — Super admin dashboard
Tenant/user explorers; AI cost observatory; quota administration; feature flag management; pipeline operations and DLQ replay; audited time-boxed impersonation; revenue and churn views.
**Exit:** the platform is operable and its spend is visible without database access.

### Wave 7 — Subscriber dashboard hardening
Quota and usage UI; upgrade prompts; distinct error/empty states; pagination; streamed generation UX; the deferred client-side items from the remediation plan.

### Wave 8 — Corporate dashboard
Member management; brand guidelines injected into prompts; approval workflow; tenant aggregate analytics; seat billing; tenant-scoped audit view; SSO when required.

### Wave 9 — Scale-out (trigger-driven, §16.4)
Partitioning; replicas; warehouse and CDC; queue fanout; sharding evaluation; multi-region.

---

## 20. Ownership model

Ownership boundaries matter more than headcount; these are the seams along which work parallelises with minimal contention.

| Stream | Scope |
|---|---|
| Platform / infrastructure | Waves 0, 2, 9; observability, CI/CD, IaC, security controls |
| Core product | Waves 1, 7; subscriber surface, tenancy, authorization |
| Data / AI pipeline | Waves 3, 5; ingestion, embeddings, matching, generation, cost governance |
| Growth / monetisation | Waves 4, 6; billing, entitlements, admin, analytics |
| Enterprise | Wave 8; corporate surface, SSO, compliance |

---

## 21. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Delivery capacity** vs scope | **Critical** | Waves are independently shippable; 0–2 are non-negotiable prerequisites, 6–9 are deferrable. Staffing must match, or scope must shrink |
| 2 | Cross-tenant data leak | Critical | Triple defence (§5.3); CI-gating isolation tests |
| 3 | Unbounded LLM spend | Critical | Metering on every call; pre-flight quotas; per-tenant and global ceilings; circuit breaker |
| 4 | Engagement assumptions wrong | High | All sizing is downstream of §2; instrument early and re-derive |
| 5 | Match quality regresses vs per-user LLM scoring | High | Shadow-run inversion against current scoring; save/dismiss ratio as gate; bounded LLM re-rank as the quality dial |
| 6 | Growth target unmet, architecture over-built | High | Trigger-driven scale-out (§16.4); nothing built before its number |
| 7 | LLM provider dependency (pricing, availability, deprecation) | High | Provider-agnostic interface; model tiering; degradation ladder; evaluate a second provider |
| 8 | Vendor per-MAU costs at 3M MAU | Medium | Model explicitly; negotiate before the threshold |
| 9 | Compliance retrofit under deal pressure | Medium | Audit, access review and change management built in Wave 1 |
| 10 | Migration risk on large tables post-launch | Medium | Online migration discipline (§8.4); tenancy landed pre-launch at zero rows |
| 11 | SSRF via ingestion of third-party URLs | Medium | Hard egress allowlist boundary (§13.1) |
| 12 | Modular monolith erodes into a tangle | Medium | Lint-enforced boundaries; no cross-module DB access |

---

## 22. Architecture decision log

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| 1 | Modular monolith + one extracted pipeline service | Microservices per domain; single monolith | Only the pipeline has a genuinely different runtime profile (§3.3) |
| 2 | Shared schema with `tenant_id` + RLS | DB-per-tenant; schema-per-tenant | Only model that operates at 10M tenants |
| 3 | Tenant created for every user at signup | Add orgs later | Retrofitting `tenant_id` across billions of rows is untenable |
| 4 | Clerk as IdP; Clerk Organizations for corporate membership | Build auth and orgs | Large surface bought cheaply; SSO available on demand |
| 5 | Local DB authoritative for entitlements and scoping | Trust token claims | The codebase already failed once on an unconfigured custom claim |
| 6 | pgvector in Postgres | Dedicated vector database | One datastore, transactional with domain data, sufficient at this scale |
| 7 | Inverted `O(articles)` discovery | Keep per-user scoring | 375× token reduction; per-user shape cannot reach 10M at any price |
| 8 | Vector recall + optional bounded LLM re-rank | Pure vector; pure LLM | Quality dial with bounded, tier-gateable cost |
| 9 | REST + OpenAPI generated from Zod | GraphQL; tRPC | Sufficient, already in place, no migration cost |
| 10 | Keyset pagination everywhere | Offset pagination | Offset degrades linearly at these row counts |
| 11 | Durable queue + outbox | Direct calls; dual writes | Removes dual-write failure mode; enables retries and replay |
| 12 | Redis fails closed for quota, open for cache | Uniform policy | Failure mode chosen per dependency by what is at stake (§15.2) |
| 13 | SPA + API in one Vercel project | Separate origins | Preserves same-origin cookie auth |
| 14 | Trigger-driven scale-out | Build for 10M immediately | Avoids paying for 10M while serving 10k |
