# LinkedIn Inbox (Gmail-style workspace)

The LinkedIn-first workspace: find a story, draft your take, post in one click. It sits behind the
`linkedin_inbox_ui` feature flag; the classic layout stays available and is the default.

## Rollout

1. Apply migrations `0059`–`0064` (the Cloud Run release workflow runs `pnpm db:migrate` before shifting
   traffic; every one of them is additive, so the previous revision keeps working).
2. Deploy. With the flag off nothing changes for customers, except that Settings → Integrations offers
   LinkedIn only (`all_integrations_ui` off; other integrations stay implemented and connected accounts stay
   visible so they can be disconnected).
3. Turn on `linkedin_inbox_ui` for an internal tenant (Admin → Feature flags, tenant list), then for
   everyone. A person can switch back with **Switch to classic layout** in the account menu (per browser).
4. Optional services, each off until configured:

| Feature | Configuration | Notes |
|---|---|---|
| Newsletter forwarding | `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_SECRET`, MX record, provider webhook | [external-inputs.md](./external-inputs.md) |
| Save from any page | none (extension store link: `VITE_CAPTURE_EXTENSION_URL`, build time) | [external-inputs.md](./external-inputs.md) |
| Monday plan and weekly top picks emails | `EMAIL_PLANNING_ENABLED=true` + production scheduler, Redis, email provider | per-person preferences in Settings → Notifications |
| Watchlist alert emails | `EMAIL_WATCH_ALERTS_ENABLED=true` (same requirements) | in-app alerts work without it |
| News search cache | `REDIS_URL` | searches still work without Redis |

## What the workspace does

| Area | Where | Server |
|---|---|---|
| For you, Shortlist, Snoozed, Not relevant; mark unread; snooze | story folders (`/dashboard?folder=…`) | `/api/inbox*` (0059) |
| Drafts, Scheduled, Posted, Outbox | post folders, filed from the Content page's status groups; unconfirmed deliveries never count as Posted | `/api/drafts*` |
| Composer: Draft my take, Compose, one-click Post with an undo window, Schedule | inline and floating windows | approve exact revision → publish-now / schedule |
| Keyword news search with operators, followed searches | search bar → News; "Searches" nav | `/api/search/news`, `/api/searches` (0060) |
| Ideas, 30-day plan, content strategy, weekly check-in | Ideas folder; Plan panel | `/api/strategy`, `/api/ideas`, `/api/plan`, `/api/checkins/current` (0061) |
| "Why?" on Not relevant, Tune your feed, Quick settings | story folders; gear button | `/api/inbox/:id/feedback`, `/api/inbox/calibration`, `/api/feed-preferences` (0062) |
| Industry moments, watchlist alerts, planning emails | Plan panel, Watchlist panel, Admin → Industry moments | `/api/moments`, `/api/watchlist`, `/api/watch-alerts` (0063) |
| Newsletter forwarding, save from any page | More connectors panel; `extension/` | `/api/inputs*`, `/api/inbound/email`, `/api/capture` (0064) |
| Notes | Notes panel | `/api/notes` (0059) |

Safety rules that the code and tests enforce:

- Nothing posts automatically. Post holds the exact saved revision client-side for the undo window; an
  ambiguous publish result is reported as "Delivery not confirmed", never as posted, and never reopened
  for a second attempt.
- The 30-day plan and topic ideas only suggest; they never schedule or change drafts.
- Learned feed preferences change future refreshes only and are undoable (compare-and-set).
- External inputs land in the Shortlist (never For you's capacity) and never fetch the pages they link to.

## Data

Every new tenant table has forced row-level security with the `tenant_isolation` policy, and every query also
filters by user (`server/rls.test.ts` lists them). `industry_moments` is global: readable by the app,
writable only inside the audited admin transaction. Capture keys and forwarding tokens are stored as SHA-256
hashes; token lookups before a tenant is known use SELECT-only policies keyed on that hash.

## Funnel metrics

Consent-gated GA4 events from `client/src/lib/inbox-analytics.ts` (no-ops without analytics consent;
parameters never contain text, names or URLs):

`inbox_story_opened` → `inbox_compose_opened` → `inbox_draft_saved` → `inbox_post_queued` →
`inbox_post_result` (`outcome`: published, simulated, queued, failed, unknown), plus `inbox_post_undone`,
`inbox_post_scheduled`, `inbox_news_searched`, `inbox_search_followed`, `inbox_idea_drafted`,
`inbox_feedback_given`, `inbox_feed_tuned` and `inbox_input_set_up`.

## Tests

- Unit, route and browser tests run in `pnpm test`.
- Opt-in database suites (run against the local test database after migrating it):
  `INBOX_SNOOZE_NOTES_DB_TESTS`, `NEWS_SEARCH_DB_TESTS`, `TOPIC_DISCOVERY_DB_TESTS`,
  `INBOX_FEEDBACK_DB_TESTS`, `PHASE5_DB_TESTS`, `INPUTS_DB_TESTS` — e.g.
  `env -u DATABASE_URL -u OWNER_DATABASE_URL NEWS_SEARCH_DB_TESTS=true pnpm exec vitest run server/services/newsSearch.db.test.ts`.
- Accessibility: axe-core WCAG 2.1 A/AA scans (`test/axe.ts`) run in the Inbox, Ideas, news search,
  inputs panel and admin moments browser suites ("… accessibility (axe, WCAG 2.1 AA)").
