# Inbox article quality contract

This is an implementation contract for dates, bounded concept matching, diverse
membership, personal trends and excerpts. It is not a roadmap completion tracker.
Existing refresh locking, capacity, snapshot/version fencing and receipt semantics
remain defined in `inbox-refresh-contract.md`.

## Dates and ranking (`quality-v1`, `balanced-v1`)

- `publishedAt` is nullable. Only explicit RSS `pubDate`, Atom `published`, JSON
  Feed `date_published`, publication meta tags, or matching Article JSON-LD
  `datePublished` supply publication evidence. `updated`, `dateModified`, now and
  database creation time are never publication substitutes.
- The application-owned `PublicationFeedParser` removes Atom dates before calling
  rss-parser's content adapter, then validates raw `published`. No dependency files
  are patched. Tests exercise actual XML parsing, including updated-only entries.
- Date strings are bounded to 100 characters. Accepted instants are timezone-explicit
  ISO or bounded RFC dates (GMT/UT/numeric offset); impossible calendar dates and
  invalid clocks are rejected. Ambiguous formats stay unknown. Future instants have
  zero grace allowance. A valid `YYYY-MM-DD` is retained as day precision, **not** a
  fabricated midnight publication instant; it receives the unknown-age multiplier.
- HTML is parsed with the existing `htmlparser2` dependency before script removal:
  comments and JavaScript string lookalikes are not metadata elements; inert
  template/fallback/raw-text subtrees are excluded. All `meta` candidates whose
  `name`, `property` or `itemprop` is `article:published_time` or `datePublished`
  (trimmed, case-normalized) are collected, with parser-decoded attribute values.
  JSON-LD must be an actual script with a case-normalized `application/ld+json` type.
  Bounds: first 2,000,000 characters, at most
  eight JSON-LD scripts of 64,000 characters, 100 visited nodes, depth six and 30
  array members per level. Article-family nodes must identify the current canonical
  URL via `url`, `@id` or `mainEntityOfPage`. Anonymous nodes and nested related-story
  lists are not guessed. Arrays and `@graph` are supported; relative identities are
  conservatively not resolved. No script executes.
- Contradictory valid publication candidates yield `conflicting` and null. Day-only
  candidates compare UTC calendar days; instant candidates must agree exactly.
  Invalid/future candidates do not override later valid evidence. Within the
  bounded candidate set, selection is order-independent: instant precision wins,
  then meta provenance over JSON-LD; invalid-only diagnostics use lexical
  quality/source order. Candidates beyond traversal bounds are not examined, so
  reordering across a bound can change the available evidence. Source, precision and
  quality are persisted, not a probability or factual-verification score.
- `discoveredAt` is assigned by PostgreSQL `clock_timestamp()` on admission, after
  history exclusion; client/candidate values cannot override it. Legacy rows stay
  null. UI uses Published only with valid provenance, Discovered for admission, and
  **Added** for legacy creation dates. Missing dates never become “Today.”
- Eligibility is positive relevance first. Ranking is relevance multiplied by
  freshness at one evaluation instant: floor(elapsed UTC days) 0–7 → 1, 8–30 → .85,
  older/unknown → .6. Relevant old articles remain eligible; no automatic evergreen
  label. Relevance and ranking are separate persisted values. SQL orders numeric
  `coalesce(ranking_score, relevance_score)` before pagination. Ranking is a refresh
  snapshot, not silently recomputed as the row ages. Independent internal rescoring
  clears the old ranking/quality snapshot.

## Bounded matching (`concept-v1`)

The existing scorer remains the sole relevance implementation, with an `exact`
baseline mode and a default bounded concept mode. Eight curated English domain
concepts are defined in `articleConcepts.ts`; this is **not embedding similarity**.
Expansion is one hop and at most four alternative surfaces. Short expanded acronyms
require independent domain-text corroboration. Company/person interests retain only
their configured lexical phrase: no inferred corporate or personal aliases.

NFKC/case/whitespace-normalized complete phrases match title or body, never a phrase
bridging both. Evidence records configured label, type, weight, match kind, concept,
matched original surface, field and exact UTF-16 span into the retained input.
Inputs remain bounded (title 2,000; body 100,000; 100 signals/type; 100 chars/term).
Terms cut at the input boundary do not create matches. Repetition and aliases count
a concept once. Explicit interests precede derived focus concepts; first-seen
duplicate keyword weights, including zero, are preserved. A disabled concept surface
blocks automatic expansion/focus, but does not erase a separately configured positive
literal company or keyword interest. Explicitly configured acronyms keep the lexical
baseline's ambiguity; these are not entity-disambiguated.

Focus uses at most six canonical informative concepts found in 2,000 characters,
requires two matched concepts when focus is the only evidence, and contributes at
most .3 raw weight. Common-word prose creates no signals. Focus does not add search
queries: **focus-only profiles without sources do not magically retrieve content**.
Source-only selection remains .1 with trusted active-source provenance and no
positive textual interests; unmatched interests never fall back to irrelevant filler.

### Held-out synthetic evaluation

`articleConcepts.test.ts` freezes 18 labeled examples authored after the vocabulary,
without tuning aliases from their results. There are 11 positives and seven negatives.
These are small synthetic regression examples, **not independently collected real
user labels or a representative external benchmark**. Ranking metric is pooled
average precision over positive-score selections, deterministic fixture-order ties;
it is not per-query nDCG or measured inbox satisfaction.

| Mode | TP / FP | Precision | Recall | Pooled AP | Ambiguity false positives |
|---|---:|---:|---:|---:|---:|
| Exact baseline | 6 / 2 | 75.00% | 54.55% | 52.27% | 2 |
| Concept-v1 | 11 / 2 | 84.62% | 100.00% | 98.60% | 2 |

Both retain explicitly configured `AI` matching the name “Ai”, and `Meta` matching
the ordinary word “meta”. Guarded expansions reject the fixture's enterprise-value,
millilitre and unrelated-name acronym senses. No broader precision/recall improvement
is claimed without a larger independently labeled corpus.

`articleConcepts.challenges.test.ts` is a separate review-regression set, **not**
additional held-out labels. It covers unsupported aliases, zero-weight precedence,
six-concept focus discovery and the .3 raw focus cap. Context checks are lexical:
“Ai is a fashion model”, millilitres in a training manual, enterprise value for a
battery maker, and a rowing club mentioning patients can still produce unrelated
acronym matches. These known contextual false positives are explicitly tested, not
reported as relevant successes. No vocabulary or frozen evaluation labels were
tuned during this review.

## Diverse membership after history exclusion

The engine precomputes bounded pure title tokens, figures, normalized topics, body
fingerprint and source origin. Storage invokes selection **after** scoped canonical
history exclusion and under the existing writer lock. No network/scoring/model calls
occur under that lock. The bounded 600-candidate pool and ten-active capacity remain.

Google provider origins come from raw `<source url>`, retained separately because
rss-parser flattens its display name. A missing origin remains unknown; a Google News
wrapper is not a publisher. Direct source articles use their article URL origin.
Origins are URL provenance, not proof of independent publisher ownership.

Greedy selection applies soft .2 same-source and .1 overlapping-topic penalties,
then deterministic rank/URL ties. Single-source pools can still fill capacity and no
zero-relevance filler enters. Generic legacy callers without quality metadata retain
their pre-ranked input tie order. Story grouping is deliberately conservative:
exact ordered normalized title keys, equal figures and equal bounded normalized
body fingerprints (including the legacy absent-fingerprint case). An unordered
token set is never story identity: “Acme buys Beta” and “Beta buys Acme” remain
distinct even with identical empty/boilerplate bodies. Changed body figures or
developments remain separate.
This may miss paraphrased duplicates; it does not claim semantic clustering. Selected
rows return in persisted ranking order: diversity promises **membership**, not visual
source interleaving.

## Personalized discovery trends

`getInboxDiscoveryWindow` is a new SQL query scoped to both tenant and user, including
every status. It selects `[now−14d, now)` on **discoveredAt**, positive relevance and
nonempty structured textual evidence. It does not read the ordinary newest-200 inbox
page. Manual unscored, legacy unprovenanced and source-only rows are excluded.

The pure aggregator canonical-deduplicates the returned window (earliest admission
wins across both windows), normalizes each label and counts it once per article.
Current `[now−7d, now)` is compared with previous `[now−14d, now−7d)`. Two distinct
current articles are required. Response retains `topic/count/articles` and adds
windows, counts/delta, source counts, time basis and coverage. Previous zero produces
null velocity and “new”, never an infinite percentage. Known origins are distinct;
unknownSourceCount counts current articles without a known origin.

SQL reads the first 5,001 eligible rows in chronological order; aggregation uses at
most 5,000 and marks partial coverage if the sentinel is present. Canonical dedup is
within that bounded sample, not an unbounded database aggregation. Representative
links prefer distinct known origins. A maximum of 20 topics is supported (UI requests
five). There is no hidden newest-200 truncation. Preserving the array response means
an empty array has no coverage envelope; the UI always discloses the 5,000-row bound,
even when empty. These are **personal admitted-content trends**, biased by refreshes,
interests and inbox capacity, not market trends or total crawl volume.

The authenticated Discover panel fetches only when opened, has loading/error/empty
states and a bounded scroll area, and uses existing semantic design tokens.

## Excerpts (`contiguous-v1`)

The deterministic extractor uses at most the first 100,000 input characters and the
contiguous opening complete sentences (at most three and 700 characters). It never
stitches distant claims, invents transitions, or cuts a sentence to fit. Minimum 60
characters/eight whitespace-separated words; insufficient or incomplete text yields
null/unavailable. Quoted ellipses are not completed claims, including ASCII `...`
or Unicode `…` followed by closing quotes/brackets and terminal punctuation.
Tests exercise real `Intl.Segmenter`, including a later complete sentence which
must not replace an incomplete opening. Original attribution,
negation, qualifications and numeric values inside the passage are preserved.

Metadata stores method, input kind, SHA-256 hash of the **retained bounded input**,
retained length, exact UTF-16 span and warnings. Feed/provider snippets are always
`source_excerpt`, even if they look complete; page body can be `extractive`. Sentence
segmentation is heuristic; extraction cannot establish truth or guarantee that later
source context is unnecessary. Whitespace-word minimum is conservative for languages
without spaces. UI says excerpt/not independently verified. Legacy excerpt provenance
is explicitly unavailable. Instant-review Generate still fetches the full source;
the inbox passage remains only its preview.

## Migration, compatibility and verification

`0029_inbox_article_quality.sql` adds only nullable publication/discovery/ranking/
JSON metadata, checks and the scoped discovery index. No historical dates or quality
are invented. Apply it before running new code that selects these columns. New
receipt timestamps hydrate to Date; old receipts without the fields replay unchanged.

- SHA-256: `159898b15d9b96284c02d7cf319c337ffaa8dadf0b951525b45c14e0bc0e9f02`
- Ledger checksum: `159898b15d9b9628`
- Applied **only** to `localhost:5433/thesocialpundit_test`, using the existing
  migrator with `--no-dotenv --only=0029_inbox_article_quality.sql`.
- Historical migrations `0023`–`0028` retained their original hashes.
- No production migration, deployment, commit, live provider call, email/payment
  operation or `.env` read was performed. Existing uncommitted work was preserved.
- Full suite intentionally not run; the supplied 97-file/2,652-test baseline was
  not re-certified. Focused final verification is recorded below.

### Prior implementation verification (not re-certified by this review)

Final run: **16 files, 314 tests passed**, exit 0. TypeScript
`tsc --noEmit --incremental false` and `git diff --check` both exited 0.
The isolated database ledger was read back and confirmed filename
`0029_inbox_article_quality.sql`, checksum `159898b15d9b9628`.
Counts describe the final batch, not the sum of repeated runs.

Explicit files in that batch:

- `server/services/articleQuality.test.ts`
- `server/services/articleConcepts.test.ts`
- `server/services/articleRelevance.test.ts`
- `server/services/keywordSearch.test.ts`
- `server/services/engines/baseEngine.relevance.test.ts`
- `server/services/engines/baseEngine.search.test.ts`
- `server/services/engines/baseEngine.crawler.test.ts`
- `server/routes/inbox.relevance.test.ts`
- `server/services/engines/articleCache.test.ts`
- `server/services/webpageScraper.test.ts`
- `server/services/urlFetcher.evidence.test.ts`
- `server/storage.inbox-refresh.test.ts`
- `server/storage.inbox-relevance.test.ts`
- `client/src/components/dashboard/inbox-detail.relevance.browser.test.ts`
- `client/src/pages/inbox-quality.browser.test.ts`
- `client/src/lib/article-date-label.test.ts`

The DB fixture asserts the isolated database name, exact app/owner connections and
restricted app role before exercising writes, and cleans up only generated tenants.
Browser fixtures bundle real components and block outbound requests. Coverage includes
receipt compatibility, capacity/concurrency/rollback, numeric ranking before paging,
post-history grouping, scoped all-status discovery windows beyond 620 rows, bounded
partial trends, actual Atom/RSS parsing, public cache metadata, sync/worker parity,
Unicode spans, unavailable excerpts, and authenticated/on-demand trend states.

### Quality-review blocker verification — 2026-09-19

This review changed only dates, diversity, summary, engine trend types, their
tests and this contract, plus the direct parser dependency declarations. No
schema/storage/engine implementation, migration, frozen held-out vocabulary or
evaluation fixture was edited. `IIndustryEngine.getHotTrends` now exposes the
existing implementation's `PersonalTrend[]` return contract.

Before the helper fixes, the two new review files reported **1 failed / 1 passed
file; 28 failed / 23 passed tests (51 total)**, exit 1. After the fixes, the final
explicit pure/mocked batch reported:

- `Test Files  11 passed (11)`
- `Tests  243 passed (243)`
- Vitest exit **0**; `tsc --noEmit --incremental false` exit **0**.
- Scoped `git diff --check` over the ten review-owned files exited **0**.
  The repository-wide check exited **2** for an unrelated new blank line at EOF
  in `server/routes/billing.ts:131`; that file was deliberately left untouched.
- Editor diagnostics retain the pre-existing cognitive-complexity warning in
  the unchanged `publicationDate` validator; no TypeScript errors remain.

| Explicit test file | Tests |
|---|---:|
| `server/services/articleQuality.review.test.ts` | 40 |
| `server/services/articleConcepts.challenges.test.ts` | 11 |
| `server/storage.discovery-window.mock.test.ts` | 4 |
| `server/services/articleQuality.test.ts` | 42 |
| `server/services/articleConcepts.test.ts` | 6 |
| `server/services/articleRelevance.test.ts` | 50 |
| `server/services/keywordSearch.test.ts` | 40 |
| `server/services/engines/baseEngine.relevance.test.ts` | 7 |
| `server/services/engines/articleCache.test.ts` | 20 |
| `server/services/webpageScraper.test.ts` | 17 |
| `server/services/urlFetcher.evidence.test.ts` | 6 |

Reproduction (from the repository root; exact file list, no parent-directory
filter): `env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin HOME=/tmp NODE_ENV=test node --input-type=module -e 'import {startVitest} from "vitest/node"; const files=["server/services/articleQuality.review.test.ts","server/services/articleConcepts.challenges.test.ts","server/storage.discovery-window.mock.test.ts","server/services/articleQuality.test.ts","server/services/articleConcepts.test.ts","server/services/articleRelevance.test.ts","server/services/keywordSearch.test.ts","server/services/engines/baseEngine.relevance.test.ts","server/services/engines/articleCache.test.ts","server/services/webpageScraper.test.ts","server/services/urlFetcher.evidence.test.ts"]; const ctx=await startVitest("test",files,{config:false,root:process.cwd(),run:true,include:files,setupFiles:[],fileParallelism:false},{envFile:false,envDir:false,resolve:{alias:{"@shared":process.cwd()+"/shared","@":process.cwd()+"/client/src"}}}); if(!ctx) process.exitCode=1; else {await ctx.close();}'`.

Typecheck used the same isolated `env -i` prefix with
`node node_modules/typescript/bin/tsc --noEmit --incremental false`.
Repository setup and environment-file loading were disabled for these runs.

The new tests verify DOM comment/script-string decoys, every supported meta
candidate, case/entity decoding, conflict/order behavior, exact feed instants and
now+1ms rejection across RSS/Atom/JSON Feed and metadata, current-article JSON-LD
identity and all traversal bounds, action/actor order with empty and boilerplate
bodies, and real sentence segmentation for quoted ellipses. The isolated storage
test mocks `./db` and the driver while compiling the real Drizzle query: tenant
and user predicates, `[now−14d, now)`, positive relevance/nonempty evidence,
all-status chronology and **LIMIT 5001** are asserted. Mocked 5,000/5,001-row
results verify the coverage sentinel reaches aggregation. This is query/driver
contract evidence, **not** fresh PostgreSQL/RLS/integration evidence.

Frozen held-out stdout remained unchanged (18 examples): baseline precision
`0.75`, recall `0.5454545454545454`, AP `0.5227272727272727`, ambiguity FP `2`;
concept precision `0.8461538461538461`, recall `1`, AP `0.986013986013986`,
ambiguity FP `2`. The 11 challenge tests are separate and are not pooled into
those metrics. SHA-256 checks across final verification matched for protected
`server/storage.ts`, `shared/schema.ts`, `server/services/engines/baseEngine.ts`
and `server/services/articleConcepts.test.ts`.

`htmlparser2` 8.0.2 was already installed and locked, including its runtime
dependency closure. It is now explicitly declared as `^8.0.2` in both manifest
and root lock entry (one line each). Offline lock reconciliation was attempted
with scripts disabled but npm reported `ENOTCACHED` for unrelated
`@tailwindcss/oxide-wasm32-wasi@4.3.3`; no online retry occurred. The existing
lock entries were preserved and the root declaration synchronized directly.
A fresh dependency installation/build was not re-certified.

No `.env` reads, live providers, databases, migrations, production operations,
deployment, commits or full-suite runs occurred in this review. Existing work by
other contributors was preserved.

### Remaining limits

No external relevance benchmark, live publisher compatibility sweep, production
performance measurement or market-trend inference. Metadata parsing is bounded and
conservative; undated/anonymous/ambiguous evidence remains unknown. Source origin is
not verified corporate identity. Empty trend arrays cannot convey dynamic coverage
without an API envelope change. Existing unrelated editor quality warnings are not
silently refactored as part of this work.