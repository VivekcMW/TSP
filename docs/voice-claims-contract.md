# Optional approved voice and honest claim-support review

## Scope and implementation status

Implements roadmap items 16/17 as an opt-in sample store and conservative source-comparison/review layer. This is **not independent factual verification, a semantic entailment engine, an impersonation feature, or a durable review approval workflow**. No main roadmap tracker was changed. Limits below are intentional and must not be described as completed verification capabilities.

The existing evidence/citation pipeline remains authoritative for source identity, UTF-16 offsets, citation IDs, literal quotes, mapping validation, four tones, platform/format compatibility, cancellation and bounded writer repair. `server/services/editorialEvidence.ts`, engine/storage-quality code, old onboarding, and migrations 0023–0029 were not edited for this implementation. Pre-existing unrelated work in this working tree was preserved.

### Implementation boundaries

- `shared/editorial-voice.ts`: strict input/state schemas and untrusted style-only prompt projection.
- `server/repositories/editorialVoice.ts`: dedicated PostgreSQL repository; no addition to the general storage API or shared Drizzle schema.
- `migrations/0030_editorial_voice.sql`: two new tables, bounds, ownership keys, grants and forced RLS. Necessary to persist explicitly approved samples and reversible removal without inferring private history.
- `server/routes/editorial-voice.ts`: authenticated GET/PATCH, registered in the existing route index.
- `server/routes/editorial-context.ts`, `server/services/editorial-request.ts`: authenticated user/tenant reference, not an approved-sample snapshot.
- `server/services/punditBrain.ts`: fresh sample reads before scoped writer calls and claim diagnostics after existing output/citation validation.
- `server/jobs/editorial.ts`: pipeline identity bump only, to `grounded-editorial-v2-voice-claims`; queued jobs from a different pipeline identity fail closed rather than execute changed prompts.
- Isolated Settings voice component, explicit approved-edit component and claim-review component; minimal Settings shell, instant-review panel and editorial-details injections.

## Voice consent, CRUD and retention

Voice starts **disabled**, revision 0, with no samples. Opening Settings alone does not fetch voice data; “Manage optional voice” performs a read only. No draft history, private messages, prior generations or inferred writing history are imported. Existing saved profile tone/focus guidance remains unchanged; it is not repurposed as approved sample history.

GET and PATCH `/api/editorial/voice` require authentication and `profile:write:own`, including GET (no support-user read privilege is introduced). Responses are `Cache-Control: no-store`. Scope comes exclusively from authenticated middleware. Body-supplied ownership or unknown mutation fields are rejected; query parameters do not override ownership.

Every mutation carries the current integer `revision`. Strict operations:

| Action | Additional input | Effect |
| --- | --- | --- |
| `enable` | `enabled`, `consent: true` | Explicitly enable/disable guidance; never approves new text |
| `add` | `text`, `origin`, `consent: true` | Retain an explicitly approved sample; does not enable voice |
| `edit` | sample `id`, `text`, `consent: true` | Replace an active sample and renew approval timestamp |
| `delete` | sample `id` | Remove active sample from future prompt projections; retain reversible copy |
| `restore` | sample `id`, `consent: true` | Explicitly reapprove a removed sample |
| `forget` | sample `id`, `confirm: true` | Permanently delete an already removed sample from this store |

- Text is trimmed and limited to 20–1,000 JavaScript UTF-16 code units by the API. Maximum **five samples total, including removed samples**. Removed samples occupy slots until forgotten.
- Origins are only `explicit-sample` and `approved-edit`. Each retained sample has a UUID, approval timestamp and nullable removal timestamp. The server assigns identity/timestamps; the client cannot submit them.
- Settings requires a retention/permission checkbox for new or changed text. Editing text or changing its origin resets consent. Restoration is a separate explicitly labelled approval. Hard forgetting has a confirmation dialog.
- Editing, saving, copying or opening a generated draft **does not retain a sample**. Edited drafts expose a separate “Approve an edit as a voice sample…” form. Opening/cancelling it is local only; retaining requires choosing bounded text, explicit consent and a separate submit. Samples do not auto-enable guidance.
- API failures/conflicts preserve the local text and do not claim success or silently retry. Reload is explicit. Unrelated enable/remove actions do not erase another unsaved sample. Settings drafts participate in the existing unsaved-navigation guard.
- Application account boundaries and tenant-keyed authenticated layout remount local state. Browser coverage additionally exercises account remount without cross-account sample retention/review acknowledgement.
- A missing approval timestamp is rejected in storage; consent is enforced by route/repository schemas. These timestamps are **not an immutable consent/audit ledger** or proof of the identity behind a UI click.
- Permanent forgetting deletes the sample row, not database backups, pre-existing generated drafts, provider-side retention or already dispatched requests. Soft removal explicitly retains a reversible copy; it is not represented as erasure.

### Tenant/user isolation and concurrency

`editorial_voices` has composite primary key `(tenant_id, user_id)`. Samples reference that same pair with cascade deletion. Both tables have **ENABLE and FORCE RLS**, and both policy `USING` and `WITH CHECK` require the transaction's `app.tenant_id` **and** `app.user_id`. Tenant-only access is insufficient.

The repository uses a checked-out connection, transaction-local scope settings, scoped SQL predicates and `COMMIT`/`ROLLBACK` before releasing the connection. A single-statement read prevents mixed enabled/sample snapshots. Mutations lock the profile row and compare the expected revision before applying changes. Concurrent/stale updates return conflict rather than resurrecting removed samples. Missing/foreign/wrong-state samples return 404 without revealing another owner.

Storage also enforces five unique slots (1–5) per owner, trimmed character length 20–1,000, byte length <=4,000, allowed origins, non-null approval time, ownership foreign keys and nonnegative revisions. The application's stricter UTF-16 bound still applies to supplementary Unicode text.

## Prompt trust and revocation

Samples are projected only as a JSON user-prompt field: `approvedVoiceSamples = { trust: "UNTRUSTED", purpose: "optional-style-only", samples: [{ text }] }`. No sample is interpolated into a trusted system role, source evidence, attribution record or provider metadata. Ownership, IDs, approval timestamps and removed text are not included in that projection.

Static system guidance states that these samples are optional tone guidance, never fact authority or instructions; embedded commands must be ignored. They do not establish identity, biography, credentials, quotes or personal experience and do not authorize impersonation. Existing source/format/four-tone rules take precedence. This role separation and the existing output validators are tested with hostile sample text; **no prompt-injection immunity or live-model behavior is claimed**.

Queued prepared requests carry only authenticated `voiceScope` plus the pre-existing profile tone/focus fields. They do not capture newly approved sample text. Each scoped writer, including a bounded repair, reads current voice state immediately before provider dispatch. Disabled/removed samples are excluded; malformed/unavailable stored state fails closed with a safe unavailable error. Cancellation is checked again after the read.

Revocation is not retroactive or atomic with a remote provider call: removal committed before a subsequent scoped read is observed; a request already read/dispatched cannot be recalled. Existing generated output and repair feedback may retain earlier model wording. Queue result replay for the same request intent remains existing behavior, not a new generation with current voice settings. Pool/query waits are not made cancellable by this addition; cancellation prevents provider dispatch once the read finishes.

## Claim support: actual comparisons, not factual verification

After existing structural/citation validation succeeds, `shared/editorial-claims.ts` produces a report from the output and its selected source excerpts. A valid citation ID or structural/lexical match alone does **not** create a factual-verification result. The original validation object remains:

- `structural: "passed"`
- `attributionMapping: "passed"`
- `factualVerification: "not-performed"`
- `requiresHumanReview: true`

Every new report independently states `method: "conservative-source-comparison-v1"`, `status: "needs-review"`, `factualVerification: "not-performed"`, and `requiresHumanReview: true`. `claimSupport` is optional for backward compatibility with older persisted results; absence is displayed honestly.

| Claim status | Meaning in this implementation |
| --- | --- |
| `supported` | The entire output sentence equals an actual cited source sentence, case-sensitive with whitespace normalization. This is textual support **only**, not source truth or independent corroboration. |
| `contradictory` | Narrow numeric/unit/sign or negation disagreement where the remainder of the cited sentence matches the comparison pattern. Takes precedence even if another cited sentence is exact. A comparison warning, not a general contradiction proof. |
| `unsupported` | Missing covering citation, or detected capitalized-name substitution with otherwise identical sentence structure. |
| `unknown` | Meaning not established (including paraphrase, generalization, case-only variants), unavailable valid source span, or unknown citation ID. |

- Only citations whose attributed output text covers that particular sentence occurrence are used. Non-cited evidence cannot silently lend support. Uncited output is surfaced, not skipped because it lacks attribution. Standalone URL lines are excluded.
- Output claims and compared source sentences have actual UTF-16 start/end offsets. Source spans include original excerpt IDs and source text. Malformed offset/length metadata and oversized source fragments are not used as support. Empty attributions are ignored safely.
- Numeric checking retains decimals, signs and selected scale/unit tokens (`%`, percent, thousand, million, billion). Negation and capitalized-entity checks are intentionally narrow. No keyword-overlap threshold earns support.
- There is no extra model call, invented citation, auto-correction, or new retry for a diagnostic. Invented IDs still fail the original mapping validation. The existing writer has at most two attempts (initial plus one format repair), not unbounded claim repair.
- Processing bounds: 5,000 output code units; 64 candidate claims; 32 attributions; 128 IDs per attribution; 128 excerpts of at most 1,200 code units; up to eight displayed comparison spans per claim. Complete claim records are retained only while the report fits **12,000 serialized UTF-8 bytes**, with `truncated` signalling omitted/bounded data. Consequently fewer than 64 claims can be displayed. At most 16 generated platform/tone reports add <=192,000 bytes; the existing overall 512,000-byte queue result ceiling still applies and is not bypassed.
- The UI labels spans as **comparison spans, not necessarily supporting the claim**, and calls out report limits. Full retained source evidence remains in the existing evidence panel.

### Human review and known gaps

The review UI asks the user to check wording, source context, numbers, names and uncertainty. Acknowledgement is **local-session and exact-text-bound**, resets when text changes/remounts, and is not saved or sent to any API. Edited text hides its stale generated report and asks for a fresh human review; it is not automatically rechecked. If a legacy caller cannot provide current edited content, no acknowledgement is offered for that stale text. Source changes remount the review component.

This does **not** add a persisted reviewer identity/time, an audit trail, or an approval/publishing gate. It must not be presented as publication approval. It does not establish external truth, source credibility, all contextual entailment, uncertainty preservation, causality, or contradictions across uncited sources. Sentence/name/negation heuristics are primarily English-oriented; paraphrases and many real contradictions remain `unknown`. Exact sentence copying can still omit wider article context. Human review remains required even when every reported sentence is textually supported, and truncated reports are incomplete by definition.

## Verification performed (isolated local environment only)

No `.env` contents were read. All test/migration invocations used an isolated environment with these explicit values:

- `DATABASE_URL` and `TEST_DATABASE_URL`: `postgresql://tsp_app:tsp_app_local@localhost:5433/thesocialpundit_test`
- `OWNER_DATABASE_URL` and `OWNER_TEST_DATABASE_URL`: `postgresql://vivekanandchoudhari@localhost:5433/thesocialpundit_test`
- `NODE_ENV=test`, `REDIS_URL=''`, `DEV_AUTH_BYPASS=''`; only `PATH`, `HOME`, `TMPDIR` preserved through `env -i`.

For each invocation below, the exact environment prefix was:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
  DATABASE_URL='postgresql://tsp_app:tsp_app_local@localhost:5433/thesocialpundit_test' \
  TEST_DATABASE_URL='postgresql://tsp_app:tsp_app_local@localhost:5433/thesocialpundit_test' \
  OWNER_DATABASE_URL='postgresql://vivekanandchoudhari@localhost:5433/thesocialpundit_test' \
  OWNER_TEST_DATABASE_URL='postgresql://vivekanandchoudhari@localhost:5433/thesocialpundit_test' \
  NODE_ENV=test REDIS_URL='' DEV_AUTH_BYPASS=''
```

Append the respective command to that prefix (working directory is this repository). Vite's `.env` loading is explicitly disabled, not merely overridden by environment values.

### Focused mocked/pure/local-browser tests: 12 files, 298 passed

```sh
node --input-type=module -e 'import {startVitest} from "vitest/node"; const ctx=await startVitest("test",["shared/editorial-voice.test.ts","shared/editorial-claims.test.ts","server/services/editorial-voice-claims.test.ts","server/routes/editorial-voice.test.ts","server/services/punditBrain.evidence.test.ts","server/services/editorial-progress.test.ts","server/routes/ai.generation.test.ts","server/routes/drafts.generation.test.ts","server/routes/editorial-jobs.test.ts","client/src/components/settings/__tests__/voice-claims.browser.test.ts","client/src/components/settings/__tests__/settings.browser.test.ts","client/src/components/dashboard/editorial-generation.test.ts"],{run:true},{envFile:false,envDir:false}); await ctx?.close();'
```

| File | Passed |
| --- | ---: |
| `shared/editorial-voice.test.ts` | 15 |
| `shared/editorial-claims.test.ts` | 18 |
| `server/services/editorial-voice-claims.test.ts` | 12 |
| `server/routes/editorial-voice.test.ts` | 12 |
| `server/services/punditBrain.evidence.test.ts` | 107 |
| `server/services/editorial-progress.test.ts` | 3 |
| `server/routes/ai.generation.test.ts` | 27 |
| `server/routes/drafts.generation.test.ts` | 16 |
| `server/routes/editorial-jobs.test.ts` | 11 |
| `client/src/components/settings/__tests__/voice-claims.browser.test.ts` | 9 |
| `client/src/components/settings/__tests__/settings.browser.test.ts` | 42 |
| `client/src/components/dashboard/editorial-generation.test.ts` | 26 |

Coverage includes consent/bounds/malformed schemas; hostile sample role separation; deleted/disabled samples; removal between initial and repair calls; original four-tone/format/mapping behavior; unknown/invented citations; numeric/entity/negation warnings; no false factual verification; real UTF-16 spans; empty/malformed input bounds; report byte ceiling; authoritative queue scope and no approved-sample snapshot. Browser fixtures exercise explicit retention, CRUD/restore/forget, failure and stale revision recovery, consent reset, unsaved navigation and account/review remounts. Provider execution is mocked and browser APIs use local fixtures, not a running production app. Final focused log: `/tmp/tsp-voice-claims-verified.log` (ephemeral).

### Test-only migration and separate repository/RLS run

Migration applied with the same isolated prefix:

```sh
pnpm exec tsx script/migrate.ts --no-dotenv --only=0030_editorial_voice.sql
```

Only the following DB test file ran, **separately/sequentially from the focused run**, without another parent DB suite:

```sh
node --input-type=module -e 'import {startVitest} from "vitest/node"; const ctx=await startVitest("test",["server/repositories/editorialVoice.db.test.ts"],{run:true},{envFile:false,envDir:false}); await ctx?.close();'
```

Result: **1 file, 7 passed**, with unique fixture IDs and fixture-only cleanup (no shared truncation). Verified actual runtime `current_database() = thesocialpundit_test`, `current_user = tsp_app`, `rolsuper = false`, `rolbypassrls = false`; owner identity `vivekanandchoudhari` on that same database. Coverage includes lifecycle/reapproval/forget, cross-user and cross-tenant isolation, predicate-free SQL/RLS and ownership spoofing, transaction-scope cleanup, five-slot storage bounds, revision concurrency/stale resurrection, and ENABLE/FORCE policies. Log: `/tmp/tsp-voice-db.log` (ephemeral).

Migration checksum verified against the actual test `schema_migrations` row:

- File: `0030_editorial_voice.sql`
- Full SHA256: `1174e7427b8211a7d92712ca247b279a48c0b48c234644bd7ff0a4ffe37e2e98`
- Ledger checksum (SHA256 first 16): `1174e7427b8211a7`
- The runner validates existing migration history before applying the selected migration.

Earlier migration SHA256 prefixes were checked unchanged:

| Migration | First 16 SHA256 |
| --- | --- |
| 0023 | `5c0933147779f53e` |
| 0024 | `98830b70dca86d6e` |
| 0025 | `75bbe23cddb79c00` |
| 0026 | `53f4e1a1b8b9a3c1` |
| 0027 | `30f679c738c07871` |
| 0028 | `ecb77728db896159` |
| 0029 | `159898b15d9b9628` |

### Static checks and operations not performed

`node node_modules/typescript/bin/tsc --noEmit --incremental false` and `git diff --check` passed. Editor diagnostics retain an unrelated pre-existing redundant `IndustrySlug | string` union in `punditBrain.ts`; no change was made to that old industry API.

No full suite, live/paid AI/provider calls, external article fetch, email, social posting, production DB operation, deployment, or commit was performed. Only the isolated test DB has migration 0030 applied here. Other runtime environments require a separately authorized migration rollout before scoped generation/voice access; missing tables fail closed rather than silently dropping configured guidance. No `.env` was created or modified (the user confirmed one already exists).