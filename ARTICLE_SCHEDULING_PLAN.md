# Article Publishing Scheduler - Implementation Plan

## Overview
Implement a comprehensive article scheduling system that allows users to:
- Publish articles immediately
- Schedule individual articles for future publication
- Bulk schedule multiple articles at once
- View/edit/cancel scheduled publications
- Receive notifications when articles are published

## Phase 1: Database Schema Enhancement

### New Tables Required

#### `draft_schedules`
```sql
CREATE TABLE IF NOT EXISTS "draft_schedules" (
  "tenant_id" varchar NOT NULL,
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" varchar NOT NULL UNIQUE,
  "scheduled_publish_at" timestamp NOT NULL,
  "published_at" timestamp,
  "status" varchar DEFAULT 'scheduled' NOT NULL, -- 'scheduled', 'published', 'cancelled'
  "retry_count" integer DEFAULT 0,
  "max_retries" integer DEFAULT 3,
  "last_error" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX "idx_draft_schedules_tenant" ON "draft_schedules"("tenant_id");
CREATE INDEX "idx_draft_schedules_status" ON "draft_schedules"("status");
CREATE INDEX "idx_draft_schedules_publish_at" ON "draft_schedules"("scheduled_publish_at");
CREATE INDEX "idx_draft_schedules_draft_id" ON "draft_schedules"("draft_id");
```

#### Schema Changes to `drafts` Table
```sql
ALTER TABLE "drafts" ADD COLUMN "scheduled_at" timestamp;
ALTER TABLE "drafts" ADD COLUMN "published_at" timestamp;
ALTER TABLE "drafts" ADD COLUMN "publish_status" varchar DEFAULT 'draft'; 
-- 'draft', 'scheduled', 'published', 'failed'

CREATE INDEX "idx_drafts_scheduled" ON "drafts"("scheduled_at");
CREATE INDEX "idx_drafts_publish_status" ON "drafts"("publish_status");
```

#### `publish_job_logs` (for audit trail)
```sql
CREATE TABLE IF NOT EXISTS "publish_job_logs" (
  "tenant_id" varchar NOT NULL,
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" varchar NOT NULL,
  "platform" varchar NOT NULL,
  "status" varchar NOT NULL, -- 'success', 'failed', 'pending'
  "published_post_id" varchar,
  "error_message" text,
  "attempt" integer DEFAULT 1,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX "idx_publish_logs_tenant" ON "publish_job_logs"("tenant_id");
CREATE INDEX "idx_publish_logs_draft" ON "publish_job_logs"("draft_id");
CREATE INDEX "idx_publish_logs_status" ON "publish_job_logs"("status");
```

---

## Phase 2: Backend Infrastructure

### 2.1 Job Queue Extension

#### New Job Handler: `server/jobs/handlers/publish-draft.ts`
```typescript
// Processes a single draft publication job
// - Validates draft exists and is in correct state
// - Calls platform-specific publish APIs (LinkedIn, Twitter, etc.)
// - Updates draft status and publish logs
// - Handles retries with exponential backoff
// - Updates published_at timestamp on success
```

#### Job Configuration in `server/jobs/queue.ts`
```typescript
interface PublishDraftJobConfig {
  tenantId: string;
  userId: string;
  draftId: string;
  platform: string;
  publishAt: Date; // When this should be published
  scheduledPublishId?: string; // Reference to draft_schedules record
}
```

### 2.2 Storage/Repository Methods

Add to `server/storage.ts`:
```typescript
interface IStorage {
  // Draft scheduling
  scheduleDraftPublish(scope: TenantScope, draftId: string, publishAt: Date): Promise<DraftSchedule>;
  getScheduledDrafts(scope: TenantScope, pagination?: Pagination): Promise<DraftSchedule[]>;
  getDraftSchedule(scope: TenantScope, draftId: string): Promise<DraftSchedule | undefined>;
  cancelDraftSchedule(scope: TenantScope, draftId: string): Promise<void>;
  updateDraftScheduleStatus(scope: TenantScope, scheduleId: string, status: string): Promise<DraftSchedule | undefined>;
  
  // Publish logs
  createPublishLog(scope: TenantScope, log: Scoped<InsertPublishJobLog>): Promise<PublishJobLog>;
  getPublishLogs(scope: TenantScope, draftId: string): Promise<PublishJobLog[]>;
}
```

### 2.3 API Endpoints

#### `server/routes/drafts.ts` - New Endpoints

**POST /api/drafts/:id/schedule**
```typescript
// Request body:
{
  "publishAt": "2026-09-15T14:30:00Z"
}

// Response:
{
  "id": "schedule_uuid",
  "draftId": "draft_uuid",
  "scheduledPublishAt": "2026-09-15T14:30:00Z",
  "status": "scheduled"
}
```

**POST /api/drafts/bulk-schedule**
```typescript
// Request body:
{
  "draftIds": ["draft_1", "draft_2", "draft_3"],
  "publishAt": "2026-09-15T14:30:00Z" // Same time for all
  // OR
  "schedule": { // Individual times
    "draft_1": "2026-09-15T14:00:00Z",
    "draft_2": "2026-09-15T14:30:00Z",
    "draft_3": "2026-09-15T15:00:00Z"
  }
}

// Response:
{
  "scheduled": ["draft_1", "draft_2"],
  "failed": [],
  "message": "2 drafts scheduled successfully"
}
```

**GET /api/drafts/scheduled**
```typescript
// Query params: ?status=scheduled&limit=20&offset=0
// Response: Array of DraftSchedule with draft details

{
  "items": [
    {
      "id": "schedule_uuid",
      "draftId": "draft_uuid",
      "platform": "linkedin",
      "content": "...",
      "scheduledPublishAt": "2026-09-15T14:30:00Z",
      "status": "scheduled",
      "createdAt": "..."
    }
  ],
  "total": 15
}
```

**DELETE /api/drafts/:id/schedule**
```typescript
// Cancel a scheduled publication
// Response: { message: "Schedule cancelled" }
```

**PUT /api/drafts/:id/schedule**
```typescript
// Reschedule a draft
// Request body: { "publishAt": "2026-09-16T10:00:00Z" }
// Response: Updated DraftSchedule
```

**POST /api/drafts/:id/publish-now**
```typescript
// Publish immediately (skip scheduled time)
// Creates a job with priority: "high"
// Response: { jobId, status: "publishing" }
```

---

## Phase 3: Scheduler Integration

### 3.1 Extend `server/jobs/scheduler.ts`

Add new scheduler function:
```typescript
export function schedulePublishRefresh(intervalMinutes: number = 1): string {
  // Every N minutes, query draft_schedules table for:
  // - status = 'scheduled'
  // - scheduled_publish_at <= NOW()
  // 
  // For each matching draft:
  // - Enqueue PublishDraftJob
  // - Update status to 'queued' (transient state)
  // - Log to publish_job_logs
  //
  // Rate limit: 10 jobs per query (prevent overload)
}
```

Initialize in `server/index.ts` startup:
```typescript
// In the (async () => { ... }) block:
await initializeScheduler(); // Existing inbox refresh
schedulePublishRefresh(1); // New: Check for scheduled publications every minute
```

---

## Phase 4: Frontend Components

### 4.1 React Hooks

#### `client/src/hooks/use-publish-schedule.ts`
```typescript
interface UsePublishScheduleOptions {
  onScheduled?: (scheduleId: string) => void;
  onPublished?: (draftId: string) => void;
  onError?: (error: string) => void;
}

export function usePublishSchedule(options: UsePublishScheduleOptions = {}) {
  return {
    scheduleDraft: (draftId: string, publishAt: Date) => Promise<DraftSchedule>;
    bulkSchedule: (draftIds: string[], publishAt: Date | Record<string, Date>) => Promise<BulkScheduleResult>;
    cancelSchedule: (draftId: string) => Promise<void>;
    reschedule: (draftId: string, newPublishAt: Date) => Promise<DraftSchedule>;
    publishNow: (draftId: string) => Promise<{ jobId: string }>;
    getScheduledDrafts: () => Promise<DraftSchedule[]>;
    loading: boolean;
    error: string | null;
  };
}
```

#### `client/src/hooks/use-publish-status.ts`
```typescript
// Poll publish job status (similar to useInboxRefresh)
export function usePublishStatus(draftId: string) {
  return {
    status: "publishing" | "published" | "failed" | null;
    publishedAt: Date | null;
    error: string | null;
    isLoading: boolean;
  };
}
```

### 4.2 UI Components

#### `client/src/components/dashboard/schedule-article-modal.tsx`
```typescript
// Modal for scheduling single or bulk articles
// Features:
// - Date/time picker (React Calendar or date-fns)
// - Timezone support
// - Preview of content
// - Multi-article selection with individual time configuration
// - Recurring schedules (optional: daily, weekly, monthly)
```

#### `client/src/components/dashboard/scheduled-articles-list.tsx`
```typescript
// Display scheduled articles
// Features:
// - List/table view
// - Status badges (scheduled, publishing, published, failed)
// - Reschedule button
// - Cancel button
// - Retry failed publications
// - Publish now (jump queue)
```

#### `client/src/components/dashboard/publish-progress-card.tsx`
```typescript
// Real-time progress during publishing
// Features:
// - Show which platforms are currently publishing
// - Progress per platform
// - Errors and retry attempts
```

---

## Phase 5: Data Model Updates

### `shared/schema.ts` - Add Zod Schemas
```typescript
export const draftSchedules = pgTable("draft_schedules", {
  tenantId: varchar("tenant_id").notNull(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  draftId: varchar("draft_id").notNull().unique(),
  scheduledPublishAt: timestamp("scheduled_publish_at").notNull(),
  publishedAt: timestamp("published_at"),
  status: varchar("status").default("scheduled").notNull(),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDraftScheduleSchema = createInsertSchema(draftSchedules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  retryCount: true,
});

export type DraftSchedule = typeof draftSchedules.$inferSelect;
export type InsertDraftSchedule = z.infer<typeof insertDraftScheduleSchema>;
```

---

## Phase 6: Platform Integration

### Publishing to Each Platform

Each platform needs integration in `server/services/`:

#### `server/services/platformPublisher.ts`
```typescript
interface IPlatformPublisher {
  publish(draft: Draft, schedule: DraftSchedule): Promise<PublishResult>;
  // Returns: { postId, success, error? }
}

// Implementations:
// - linkedinPublisher.ts - Use LinkedIn Share API
// - twitterPublisher.ts - Use Twitter API v2
// - etc. for each enabled platform
```

---

## Implementation Phases Summary

| Phase | Components | Effort | Timeline |
|-------|-----------|--------|----------|
| **Phase 1** | Database migration (0007) | 2 hrs | 1 day |
| **Phase 2** | Backend job handler + storage | 6 hrs | 2 days |
| **Phase 3** | Scheduler integration | 3 hrs | 1 day |
| **Phase 4** | Frontend hooks + components | 8 hrs | 2-3 days |
| **Phase 5** | Schema + types | 2 hrs | 1 day |
| **Phase 6** | Platform publishers | 8-12 hrs | 3-4 days |
| **Testing** | Integration + E2E | 6 hrs | 2 days |

**Total: ~35-45 hours, ~2-3 weeks for full implementation**

---

## Quick Implementation Path (MVP)

If you want to start with a minimal viable product:

1. **Database** - Add `draft_schedules` table only
2. **API** - POST /api/drafts/:id/schedule, DELETE, GET endpoints
3. **Job Handler** - Basic publish handler with retry logic
4. **Scheduler** - Query draft_schedules every minute, enqueue jobs
5. **Frontend** - Simple date picker modal, scheduled list view

**MVP Timeline: ~1 week (20 hours)**

---

## Architecture Decisions

### ✅ Leverage Existing Infrastructure
- Reuse Bull queue from Phases 0-3
- Extend cron scheduler (node-cron already installed)
- Follow TenantScope pattern for multi-tenancy
- Use existing storage abstraction

### ✅ Resilience
- 3-retry exponential backoff per draft (like inbox refresh)
- Transactional updates (schedule → queued → published)
- Audit trail in publish_job_logs
- Error logging for debugging platform issues

### ✅ UX Considerations
- Timezone-aware scheduling UI
- Bulk scheduling with individual time overrides
- Publish now (skip schedule)
- Edit/reschedule before publish time
- Publishing progress notifications

### ⚠️ Known Challenges
- **Platform APIs**: Each social platform has different auth/rate limits
- **Timezone handling**: Store in UTC, convert in UI
- **Concurrent publishes**: May hit platform rate limits during bulk publishes
- **Failure recovery**: Partial bulk failures (some succeed, some fail)

---

## Dependencies to Add

```bash
npm install date-fns react-day-picker # Date picking UI
npm install react-hot-toast@latest   # Already used, extend for publish notifications
npm install zod # Already installed
```

---

## Recommendation

**Implement in this order:**
1. ✅ Phase 1 (Database) - Foundation
2. ✅ Phase 2 (Backend) - Core logic
3. ✅ Phase 3 (Scheduler) - Auto-publishing
4. ✅ Phase 4 (Frontend) - UX
5. 🔄 Phase 6 (Publishers) - Platform-specific (can iterate)

**Do you want me to proceed with implementation? I recommend starting with Phases 1-3 first (backend), then adding UI in Phase 4.**
