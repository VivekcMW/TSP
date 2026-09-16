# Background Job/Queue Implementation Plan

## Overview
Replace synchronous RSS+scoring in request handlers with an async queue system for better UX and scalability. Currently:
- `/api/inbox/refresh` blocks the user until `engine.processForUser()` completes (5-15s typical)
- Pre-warming the inbox via cron is not possible
- Multiple concurrent users hitting the same RSS feeds cause redundant fetches

**Goal**: Queue refresh jobs, return immediately to client, process in background with real-time updates via WebSocket/polling.

---

## Architecture Decision: Bull/BullMQ + Redis

### Why Bull/BullMQ?
- ✅ Already have Redis (`ioredis` + `rate-limit-redis` in dependencies)
- ✅ Proven in production (used by thousands of projects)
- ✅ Built on top of ioredis, same connection pool
- ✅ Job persistence, retry logic, rate limiting out-of-box
- ✅ Minimal dependencies, small bundle size
- ✅ Excellent TypeScript support
- ✅ Works locally without external services (dev workflow unaffected)

### Alternative Considered & Rejected
- **pg-boss**: Database-native queue (Postgres), no external dependency. Rejected because Redis already in stack; adds complexity.
- **node-cron**: Simple scheduler. Rejected because needs distributed locking for multi-instance; Bull handles this automatically.
- **Temporal/durable-dev**: Enterprise orchestration. Overkill for current scale.

---

## Implementation Phases

### Phase 0: Setup
**Goal**: Job infrastructure ready, backward compatible (manual triggers still work)

#### 0a. Dependencies
```bash
npm install bull
npm install -D @types/bull
```

#### 0b. Create Queue Infrastructure
**File**: `server/jobs/queue.ts`
- Export `inboxRefreshQueue` singleton initialized from `REDIS_URL` or undefined (local dev)
- Export `JobConfig` interface: `{ tenantId, userId, manual, priority }`
- Export async `enqueueInboxRefresh(config)` helper

**File**: `server/jobs/handlers/inbox-refresh.ts`
- Port the entire `engine.processForUser()` logic here
- Move the `createEngineRunLog` call here
- Error handling: retry 3x with exponential backoff (max 24h total)
- On success: `emit('article:created')` for each inbox item (for WebSocket later)

**File**: `server/jobs/index.ts`
- Register all job handlers on app startup
- Log job lifecycle (started, completed, failed)

#### 0c. Wire Into Request Handler (Non-Breaking)
**File**: `server/routes/inbox.ts` — `/api/inbox/refresh` handler
- If queue available: enqueue job, return `{ jobId, status: 'queued' }`
- If queue unavailable (local dev, no Redis): fall back to sync processing (current behavior)
- This maintains compatibility; developers still see immediate results locally

---

### Phase 1: UI Integration - Job Status
**Goal**: Client can poll for refresh progress without blocking

#### 1a. New API Route
**File**: `server/routes/inbox.ts` — `GET /api/inbox/refresh/:jobId`
- Query the job from queue: `await queue.getJob(jobId)`
- Return: `{ status: 'active'|'completed'|'failed', progress: { articlesProcessed, articlesMatched }, error: string? }`
- Clients poll this to show progress bar

#### 1b. Frontend Hook
**File**: `client/src/hooks/use-inbox-refresh.ts`
- `useInboxRefresh()`: accepts `onJobQueued(jobId)` callback
- On submit: calls `/api/inbox/refresh`, stores jobId
- Polls `/api/inbox/refresh/:jobId` every 500ms until complete
- Updates state: `status`, `progress`, `error`
- Called from `post-generator-modal.tsx` (Refresh Articles button)

#### 1c. UI Feedback
**File**: `client/src/components/dashboard/inbox-refresh-progress.tsx`
- Show progress bar + count: "Fetching articles (4/120)..."
- Keep page usable while refreshing (not a modal lock)

---

### Phase 2: Pre-warming via Cron
**Goal**: Background jobs refresh inbox before user opens the app

#### 2a. Cron Service
**File**: `server/jobs/scheduler.ts`
- Check ENVIRONMENT == 'production' (run only one instance)
- On app startup: schedule cron jobs using `node-cron`

#### 2b. Two Cron Triggers
1. **Every 6 hours**: Refresh all active users' inboxes
   ```
   SELECT DISTINCT tenant_id FROM inbox_items WHERE createdAt > now() - '30 days'
   FOR EACH tenant: enqueueInboxRefresh({ tenantId, priority: 'low', cron: true })
   ```
   
2. **Every 30 minutes**: Refresh top-engagement users (first-quartile by articles saved/drafted)
   ```
   TOP 25% of users by inbox engagement -> enqueueInboxRefresh({ priority: 'high' })
   ```

#### 2c. Configuration
**File**: `.env.example`
```
BACKGROUND_JOBS_ENABLED=true
CRON_REFRESH_INTERVAL=360  # minutes (6h)
CRON_REFRESH_TOPUSERS_INTERVAL=30  # minutes
```

#### 2d. Job Priorities
- `high`: Manual user refresh, top-engagement users → process immediately
- `normal`: General pre-warming → process after high
- `low`: Full user base pre-warming → process last (rate limited to 1/minute)

---

### Phase 3: Database Schema for Job Tracking
**Goal**: Audit trail for ops/support; optional but useful

**File**: `migrations/0006_background_jobs.sql`
```sql
CREATE TABLE IF NOT EXISTS job_history (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  user_id varchar,
  job_type varchar NOT NULL,  -- 'inbox_refresh', etc.
  status varchar NOT NULL,    -- 'queued', 'active', 'completed', 'failed'
  job_id varchar,             -- Bull job UUID
  articles_processed integer DEFAULT 0,
  articles_matched integer DEFAULT 0,
  error_message text,
  duration_ms integer,
  triggered_by varchar,       -- 'manual', 'cron', 'api'
  started_at timestamp DEFAULT now(),
  completed_at timestamp,
  
  INDEX idx_job_history_tenant (tenant_id),
  INDEX idx_job_history_user (user_id),
  INDEX idx_job_history_status (status, completed_at)
);
```

**Why opt-in**: The `engine_run_logs` table is already tracking engine execution. `job_history` is only needed if you want fine-grained queue lifecycle tracking (optional for Phase 3).

---

### Phase 4: Real-Time Updates via WebSocket (Optional, Future)
**Goal**: Inbox items appear in real-time as articles are scored

#### 4a. Server
- When job emits `article:created`, broadcast via WebSocket to all clients in that tenant
- Clients receive live feed of new articles without polling

#### 4b. Client
- `useInboxWebSocket()` hook to subscribe to tenant's article stream
- Auto-append new items to the list

**Status**: Deferred — Phase 1-3 provide solid UX with polling. WebSocket is a future perf enhancement.

---

## Migration Strategy

### Backward Compatibility
- **Week 1**: Deploy Phase 0 with fallback to sync (no breaking changes)
- **Week 2**: Deploy Phase 1 UI + job status polling
- **Week 3**: Deploy Phase 2 cron pre-warming
- **Week 4**: Optional Phase 4 (WebSocket) or move to next feature

### Local Development
- `REDIS_URL` not set → queue=undefined → sync processing (current behavior)
- Developers don't need Redis running locally (no friction)
- Optional: `npm run redis:local` to spin up Docker container for testing

### Deployment Checklist
- [ ] `REDIS_URL` environment variable set (probably already there for rate-limit-redis)
- [ ] `BACKGROUND_JOBS_ENABLED=true` in production .env
- [ ] `CRON_REFRESH_INTERVAL=360` (sensible default, tune based on user count)
- [ ] One instance marked as `CRON_SCHEDULER=true` (for cron-only, not worker)
- [ ] Monitor Redis memory usage (job history + queued jobs)

---

## Code Structure Summary

```
server/
├── jobs/
│   ├── queue.ts                 # Queue singleton, enqueue helpers
│   ├── index.ts                 # Job handler registration
│   ├── scheduler.ts             # Cron tasks, user selection logic
│   └── handlers/
│       ├── inbox-refresh.ts     # Port engine.processForUser() logic
│       └── (future jobs: email, export, etc.)
│
├── routes/
│   └── inbox.ts                 # Modified /api/inbox/refresh + new GET /:jobId
│
└── (existing files unchanged)

client/src/
├── hooks/
│   └── use-inbox-refresh.ts     # Job polling logic
│
└── components/
    └── dashboard/
        └── inbox-refresh-progress.tsx  # UI feedback
```

---

## Testing Strategy

### Unit Tests
- **queue.ts**: Job enqueueing, config parsing
- **scheduler.ts**: Cron timing, user selection logic
- **inbox-refresh handler**: Full flow with mocked storage/engine

### Integration Tests
- Enqueue job → verify it appears in Bull queue
- Complete job → verify inbox_items created, engine_run_logs written
- Job retry on failure → verify exponential backoff
- Cron trigger → verify jobs enqueued for correct users

### Load Testing (Future)
- Simulate 100 concurrent `/api/inbox/refresh` calls
- Verify all become queued jobs, no timeouts
- Monitor Redis memory/throughput

---

## Monitoring & Observability

### Logs
- Job started: `[job] {id} inbox_refresh started for tenant {tenantId}`
- Article created: `[job] {id} matched article {headline} -> {inboxItemId}`
- Job completed: `[job] {id} completed in {durationMs}ms, {articlesMatched} articles`
- Job failed: `[job] {id} failed (attempt 3/3): {errorMessage}`

### Metrics (Optional)
- `queue.size` — jobs waiting
- `queue.active` — jobs in progress
- `queue.delayed` — jobs with retry backoff
- `job.duration_ms` — p50/p95 job latency
- `redis.memory_mb` — Redis memory usage

### Admin Panel Integration
**File**: `client/src/pages/admin/jobs.tsx` (Phase 3+)
- List recent jobs: status, duration, error
- Manual job rerun button (for failed jobs)
- Queue stats: depth, error rate

---

## Known Limitations & Tradeoffs

| Tradeoff | Decision | Why |
|----------|----------|-----|
| Job Persistence | Bull (in-memory) | Simpler than database; ok for "best effort" pre-warming. If Redis restarts, jobs are lost but cron regenerates them every 6h. |
| Distributed Locking | Cron on single scheduler-designated instance | Node-cron doesn't support built-in HA; acceptable for current scale. Future: use Bull's `scheduleJob` API or BullMQ's `RepeatableJob` feature. |
| Scaling to 1000s of users | Switch cron to `SCHEDULE_REFRESH_TOPUSERS_ONLY=true` | Skip full user-base refresh; pre-warm only active users. Keeps queue load bounded. |
| Multi-tenancy | Use `tenantId` as job namespace | Queue name: `inbox_refresh:${tenantId}`, keeps tenant data isolated per Bull queue. |

---

## Estimated Implementation Time
- Phase 0 (Queue setup): 2-3 hours
- Phase 1 (Job status UI): 2 hours
- Phase 2 (Cron scheduler): 1 hour
- Phase 3 (DB schema): 30 min
- Phase 4 (WebSocket): deferred (future sprint)

**Total for Phases 0-3**: ~6-7 hours

---

## Next Steps
1. Confirm Redis setup & connection string
2. Create `server/jobs/queue.ts` scaffold
3. Implement Phase 0 job infrastructure
4. Test locally with manual `/api/inbox/refresh` call
5. Deploy to staging, verify queue processing
6. Roll out Phase 1-2 incrementally
