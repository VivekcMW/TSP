# Shared article index (Stage 1)

**Status:** approved by the founder on 2026-09-28 ("go ahead with the shared index and implement end to end").

## Problem

Every Discover refresh fetches the news live, per person: the person's 6 sources plus 8 search
queries against Google News and Bing. In production, Google throttles the requests that turn
Google News links into publisher links, refreshes hit their 20 s budget, and about 4 stories
survive per refresh. Generation then fetches the article page live when the person clicks
"Write a post", which is where paywalls, blocks and timeouts fail in front of the user.

## Decision

One shared index, fed by a scheduled crawler, read by every refresh and by generation.

- **Catalogue** (`publications`): every feed or page any person has picked as a source, shared
  across tenants. A row is registered when a source is created and when a refresh reads it.
- **Pool** (`pooled_articles`): every story the crawler sees, keyed by canonical URL, with its
  publisher, date and, once fetched, the article body and whether it was readable. 30-day
  retention. Full-text search column for candidate retrieval.
- **Crawler** (`pool-crawl` scheduler task, every 15 min under the existing advisory lock):
  polls due publications with conditional requests (ETag / Last-Modified), stores new stories,
  fetches a bounded number of article bodies (robots.txt honoured, one request per host at a
  time), prunes old rows.
- **Refresh:** the pool becomes a third candidate source next to the person's sources and the
  search providers. It never fails a refresh. Stories the refresh accepts are written to the
  pool as pending, and their bodies are fetched right after commit (best effort, bounded).
- **Generation:** if the pool holds a readable body for the story's URL, the AI reads it from
  the database; otherwise the live fetch runs as before.

Search providers stay as they are in Stage 1 (Stage 2 adds publisher discovery and can then
switch them off per industry).

## Data

```sql
publications (id, name, site_url, feed_url UNIQUE, source_type feed|webpage, added_via,
  is_active, last_crawled_at, last_crawl_status, last_crawl_error, consecutive_failures,
  etag, last_modified, created_at, updated_at)

pooled_articles (id, publication_id NULL, canonical_url UNIQUE, title, source, source_origin,
  content, input_kind page_body|feed_excerpt, readable NULL|bool, published_at, fetched_at,
  body_fetched_at, created_at, search tsvector GENERATED (english: title + first 20k chars),
  body_hash GENERATED (md5 of content))
```

Neither table is tenant-scoped (like `industry_sources` and `newsletter_subscribers`), so no
RLS policy; `tsp_app` gets SELECT/INSERT/UPDATE (and DELETE on the pool for retention).

## Behaviour and limits

- Conditional GET: `fetchPublicText` accepts request headers and returns status 304 without
  a body when the publisher says nothing changed.
- Politeness: crawler user agent identifies the app; robots.txt `Disallow` for `*` or our
  agent is honoured for article pages and feeds (cached per host for a day); the existing
  per-host limiter serialises requests.
- Budget per crawl cycle: at most 40 publications and 60 article bodies, 8 s per request,
  so a cycle stays well inside its 15-minute slot on one instance.
- Body text stored up to 40,000 characters. Readable means the extractor found at least 800
  characters of prose, the page did not redirect to the site's front page, and no earlier story
  from the same site has the same body (a site's boilerplate block extracted under many
  headlines is demoted after each cycle). The feed's headline is kept; page titles are often
  the site's name.
- Feeds that repeat their site address in every link ("https://a.test/https://a.test/story")
  are repaired before storing.
- Publications are registered both when a source is added and when a refresh reads them.
- A crawl cycle can be limited to given publication ids (`runPoolCrawlCycle(…, only)`).
- Retention: rows older than 30 days are deleted each cycle (bounded batch).
- Candidate query: last 30 days, every word of any of the person's keywords, companies or
  people (English stemming, so "prices of medical devices" matches "medical device pricing"),
  newest first, at most 150 rows. The existing lexical relevance scoring decides what
  matches; the index only narrows candidates.
- Failure isolation: pool read errors add a warning and yield no candidates; crawler errors
  are per publication (consecutive failures deactivate a publication after 10).

## Stage 2: discovery (built 2026-09-28/29)

- `discovered_sites`: every publisher domain behind a search result, an outbound link in a
  fetched article, or a GDELT record. Networks, search engines, aggregators and infrastructure
  hosts are never recorded. Each crawl cycle probes the 5 most-seen pending sites (search-seen
  ones, or link-seen ones seen at least twice) with `discoverFeed`; a feed or article page
  becomes a publication with `added_via = discovered`, a miss is recorded as `no-feed`.
- `watch_terms`: the topics, companies and people across all accounts, without the account,
  refreshed on every refresh. Used to pick stories out of GDELT.
- GDELT: each cycle downloads the newest 15-minute GKG file not seen yet (falling back one
  quarter-hour, since the listing runs ahead of the upload), keeps web records whose page title,
  organisations or people mention a watched term (whole words, at most 150 per file), stores
  them as pool stories with no body (the crawler reads them like any other) and notes their
  sites for discovery. `GDELT_ENABLED=false` switches it off. About 10–30 MB per cycle.
- Refresh: stories the crawler found unreadable are left out before scoring; with
  `INDEX_ONLY_THRESHOLD` (default 40) index candidates, the search engines are not asked.

## Stage 3: push and health (built 2026-09-29)

- WebSub: a feed naming a hub (`<link rel="hub">`) gets a 10-day lease requested with a
  per-publication secret; the hub verifies at `GET /api/websub/:id` (topic must be the feed)
  and delivers signed entries at `POST /api/websub/:id` (`X-Hub-Signature`, HMAC over the raw
  body; unsigned deliveries are acknowledged and ignored). Leases are renewed a day before
  they end. `WEBSUB_ENABLED=false` switches it off.
- `GET /api/admin/index` (pipeline operators): counts for publications, discovery, the pool,
  watch terms and the last crawl cycle's stats.

## Still out of scope

Embeddings for matching (they would admit stories that don't contain the person's own
terms, which the product promises not to do; word stemming covers variants), a separate
crawler service and regional workers (one instance still finishes every cycle in its slot).

## Testing

Unit: robots parser, conditional fetch, query builder. Storage (real test database):
publication registration, pool upsert and search, body marking, pruning. Job: a crawl cycle
against the test database with mocked network. Engine: pool candidates merged and failures
isolated (existing search tests stub the pool). Generation: pool hit skips the live fetch.
End to end locally: crawl cycle on the dev database, then a new account's refresh and a
generation that reads from the pool.
