# Create post: local end-to-end findings

## Current workflow: document editor and Pundit chat

Create is a paper-style, directly editable document with a persistent bottom
Pundit chat. The main document supports **saved rich-text formatting**: bold,
italic, underline, strikethrough, highlighting, headings, bulleted/numbered lists,
quotes, paragraph alignment, clear formatting, and undo/redo. It is not a
`.docx` importer/exporter. The document is limited to 5,000 plain-text characters;
oversized typing/pastes are rejected with an explicit message, not truncated.
Chat instructions are limited to 4,000 characters.

The workspace expands up to 1,280px on desktop. The formatting toolbar stays
within the document's scroll area and scrolls horizontally on narrow screens;
the bottom chat stays visible independently of document scrolling.

1. Write directly, or describe a draft/change in chat.
2. Attach multiple crawled articles using **Articles** or `/sources`. Up to six
   references are supported per suggestion, with a shared 24,000-character
   evidence budget and passage slots divided between sources, so a dense first
   source cannot crowd later sources out of the writer's evidence. Selection is scoped to the signed-in
   workspace and checked again when a queued request executes.
3. Pundit writes the completed draft **directly into the editable document**,
   preserving your chosen title. There is no second proposal editor.
   **Undo AI update** restores the previous document, formatting, and source
   review, including after reload. Undo cannot overwrite newer manual edits.
   If the document changed while a job was running, the result is held behind
   **Use generated draft** / **Discard** instead. Replacing newer edits requires
   confirmation and retains them for Undo. Older saved proposals remain recoverable.
4. Use **Adapt for platforms** or `/platforms`, choose up to four platforms, and
   generate their versions. No platforms are selected automatically.

Type `/` for keyboard-navigable commands: `/sources`, `/tone`, `/length`,
`/platforms`, `/versions`, `/link`, `/notes`, `/evidence`, and `/new`. Options open
in dialogs rather than permanent dropdowns. Enter sends; Shift+Enter inserts a
newline; Escape closes the command list. `/notes` retains source/media upload.
The conversation can be expanded without leaving the editor.

While a suggestion is pending, one compact writing status appears **inside the
document**, with elapsed time and cancellation. Existing text remains unchanged
until a complete, validated response arrives. This is not provider token streaming.
Reduced-motion preferences disable loading animations.
Cancellation or failure removes the writing state and preserves the document.
Failed source reads identify all unavailable articles together. No selected
article is silently skipped and no AI generation starts with partial evidence.
**Remove unavailable articles** is an explicit selection change, not an automatic
retry. The original message is restored, the remaining references are kept, and
the user presses Send to start a new attempt. **Add source notes** supports
supplying text instead. Publisher access restrictions are not bypassed.

Platform adaptation uses the exact reviewed main-draft title and text, with the
original source URL retained for provenance. It does not fetch the original
article again instead of using the user's edits. Each generation stage can
consume AI usage; no generation publishes or schedules a post.
Social versions remain plain text: rich formatting JSON/HTML is never sent as
platform content. Paragraphs use two newlines, soft breaks one newline; list text
is retained without its rich list markers.

One active creation per user and tenant is autosaved on the server, including
source inputs, document text and formatting, platform selection, edited versions, attached article
links, conversation, unsent chat text, pending requests, source failures, and the
last undoable AI update. **Save progress**
confirms the current state explicitly. Wait for **All changes saved**
before closing or reloading. A failed or conflicting save retains the local
text, stops automatic retries, and offers explicit retry/reload actions. Reload
requires confirmation before discarding unsaved changes. Draft text is not
written to browser storage; existing opaque job-recovery pointers remain.
Recovered jobs update the document only when their saved document snapshot still
matches; otherwise they require explicit replacement. Recovered terminal failures
unlock the composer and restore the message. An interrupted suggestion without a
recoverable job is shown explicitly and never retried automatically.

Editing the main-draft wording or title retains platform text but marks older versions as out of
date. Those versions cannot be copied, saved, or handed off until regenerated.
Regeneration asks before overwriting edited text. Platform publication drafts
remain separate records in Content, with their existing revision/conflict
checks. **Start new** replaces the active creation, not saved Content drafts.
Automatic article links do not overwrite a saved creation.
Formatting-only edits are saved without increasing the main text revision,
making existing social versions stale, or preventing continuation of an
interrupted platform batch. Starting a new creation or replacing the source
also resets editor undo history so the previous document cannot reappear.

Formatting is validated, size-bounded structured JSON, not arbitrary HTML.
Unsupported nodes, marks, attributes, excessive nesting, and formatting that
does not match the saved text are rejected. Older plain-text creations remain
compatible. Formatting uses the existing JSONB store; no additional migration
is required beyond the creation-session migration below.

Deployment requires migration
[`0051_creation_sessions.sql`](../migrations/0051_creation_sessions.sql) through
the existing migration runner before starting the new application. It creates
the owner-scoped, revision-protected store with forced row-level security.

Focused coverage:

- `draft-first.browser.test.ts`: real React/Chromium document/chat workflow,
  direct document updates, persistent Undo, confirmed conflict replacement,
  slash keyboard controls, multi-reference input,
  exact edited adaptation input, server-state restoration, save races, stale
  versions, selection cap, failures, and desktop/mobile sticky-chat geometry
  with mocked AI/HTTP boundaries. Rich-editor coverage includes every toolbar
  action, formatting save/reload/navigation, exact plain-text adaptation,
  formatting-only revisions, safe undo boundaries, paste/typing limits,
  pending/cancelled generation, one inline writing status, reduced motion,
  blocked-source details, explicit reference removal, and terminal prompt recovery.
- `document-format.test.ts`: supported formatting, plain-text round trips,
  paragraph/soft-break boundaries, legacy compatibility, invalid structures,
  complexity/size limits, and text/format consistency.
- `draft-reconciliation.browser.test.ts`: existing Content/Create revision
  conflicts, acknowledgement checks, and source/account ownership.
- `creationSession.test.ts`: real local PostgreSQL persistence, concurrent
  writes, lost-acknowledgement replay, tenant/user isolation, input limits, and
  rich-format persistence without accepting mismatched text.
- `punditBrain.generation.test.ts` and `editorial-request.deadline.test.ts`:
  neutral generation, editing instructions, reviewed-content adaptation,
  scoped multi-source evidence budgets/failures, provenance, cancellation,
  and unchanged execution deadlines.

These tests are not live-provider or production certification. The live
generation evidence below predates the document/chat workflow.

## Historical outcome: paid-key mismatch fixed; four-platform live generation passed

Preview: `http://localhost:4301/dashboard/create`.
Current provider/model: direct Gemini / `gemini-3.1-pro-preview`; OpenRouter fallback disabled.
Current editorial identity: `grounded-editorial-v6-gemini-pro`.

### Root cause and credential correction (2026-09-30)

- The initial Gemini job `1e9bcc70-d694-4a54-8f88-eaef1e8d5818` failed with upstream HTTP 429. A bounded diagnostic request revealed `generate_content_free_tier_*` quotas with **limit 0**, not evidence of an empty paid-account balance.
- After the user refreshed Google authentication, read-only checks confirmed the intended **TSPAI** project's billing was enabled and its linked billing account was open.
- TSPAI's existing Gemini-restricted key, **TSPAIPRO**, matched `AI_INTEGRATIONS_GEMINI_API_KEY`, but **not** `GEMINI_API_KEY`. The different primary credential took precedence over the working paid alias. The old key's parent-project lookup was permission-denied; its project identity was not established.
- A minimal Pro request using TSPAIPRO returned HTTP 200 with a complete response. The user then explicitly approved a private local terminal script to copy the existing paid alias into `GEMINI_API_KEY`. No credential values were exposed, no new cloud keys were created, and no cloud/billing settings were changed.
- Root `.env` and the owned port 4301 process select direct Gemini Pro with a blank fallback. The separate port 4300 process was left untouched.
- Pro requests use `thinkingLevel: LOW`, not `thinkingBudget: 0`. The default combined reasoning/output cap is 8192 tokens; explicit caller caps remain honored. Billable thinking tokens are included in reported output usage, while reasoning text remains private. Existing timeout, cancellation, validation, and non-Pro defaults remain unchanged.
- The exact dev profile was preserved across the restart; `/healthz` returned HTTP 200.

### Verified live after the correction

All four cards generated through the real Create UI, one platform at a time, using `gemini-3.1-pro-preview`. Each result endpoint returned HTTP 200, reported one writer attempt, and had `fallbackUsed: false`:

| Platform | Completed job |
| --- | --- |
| Twitter/X | `f3e64303-b5be-4ee1-9f14-f7bb143fbbce` |
| Threads | `cdb21101-8d2e-4290-9abc-b047c4a848dc` |
| Substack Notes | `8dc2a38a-12bb-4fa1-a70c-be5ac8256a3d` |
| LinkedIn | `d735b665-a8b5-41c9-9a08-c0cc2ca8d5e9` |

- All results passed structural and attribution-mapping validation. **Independent factual verification was not performed; human review remains required.** This is not a claim that every generated opinion is source-supported.
- X generated at 150/280 weighted characters. A small wording edit produced 155/280 characters; clipboard copying completed successfully.
- Saving the edited X card returned POST `/api/drafts` HTTP 200 with ID `987e6728-4008-4df2-adb0-5c3dda177e2d`. The returned content matched the edited card, `publishStatus` remained `draft`, and `publishedAt`/`scheduledAt` were null.
- LinkedIn, Threads, and Substack card text remained exactly unchanged during the X edit/copy/save flow. The older saved LinkedIn draft was not duplicated.
- A later development refresh reset the unsaved composer view. GET `/api/drafts` then confirmed the saved X draft still existed with matching content and no publish/schedule timestamps. This does not claim recovery of completed, unsaved cards across a development refresh; the final empty-view layout probe was not four-card layout evidence.
- This live run exercised sequential **single-card actions**, not the automatic “Generate 4 posts” button; automatic batch sequencing remains covered by the browser regression suite.

### Previously verified live with OpenRouter

- LinkedIn generation completed through the real async job and result endpoints.
- The failed card cleared its retry status after successful generation.
- Generated text included the supplied Agency Reporter source credit and article URL.
- Editing and clipboard copy succeeded in Create.
- Saving returned HTTP 200 and a real draft ID. That draft survived preview restarts and appeared in Content.
- Editing that same draft in Content returned HTTP 200 from PATCH, retained its ID, and refreshed the displayed text.
- Failed X generation retained the completed, edited LinkedIn card before the preview restart.
- The saved record remained `publishStatus: draft`, with no published or scheduled timestamp.

No publishing, scheduling, social-platform compose action, invitation email, production change, commit, or deployment was performed.

### Historical OpenRouter failures

Before the Gemini switch, X, Threads, and Substack Notes returned `ai_invalid_output` with OpenRouter's `openai/gpt-4o-mini`. Server diagnostics identified **length** on both the initial writer call and its single repair. Compact character/word-budget prompt guidance did not resolve those historical failures. The corrected Gemini run above now passes these platforms without weakening the checks.

An earlier OpenRouter HTTP 429 cleared after its cooldown. Successful key authentication was not treated as proof of generation capacity or account credits.

Source used: the Agency Reporter article titled “DGTOOHL Partners with Hero MotoCorp to Deliver its First Programmatic DOOH Campaign for a Two-Wheeler Launch via Google DV360.” Extraction returned readable article text and the correct publication label. Structural/source-mapping validation is **not** independent fact-checking; human review remains required.

## Implemented and regression-tested

- Partition development editorial queues by canonical provider/model/version identity; preserve production routing and the worker's fail-closed identity check.
- Invalid development provider configuration disables the editorial queue without taking down the rest of the app or joining a fallback queue.
- Show the real sanitized error. Separate a fresh, single-platform attempt from recovery of an unresolved original request intent.
- Track generation status per platform/tone, clear stale failures after success, and stop batches on empty/missing requested output.
- Retain completed text and edits when another card fails.
- Complete missing provenance using only supplied source/URL metadata. Validate original citation spans and completed content, including final length; never fabricate citations or truncate generated claims.
- Verify real-SDK Gemini Pro request serialization, explicit output/temperature caps, reasoning usage accounting, preserved non-Pro defaults, truncation rejection, and no implicit fallback after HTTP 402/429.

## Automated verification

**476 passed, 0 failed, 0 skipped, across 10 focused files** after the Gemini changes:

- `client/src/components/dashboard/create-post-state.test.ts`
- `client/src/components/dashboard/editorial-generation.test.ts`
- `client/src/lib/editorial-request.test.ts`
- `client/src/lib/editorial-recovery.test.ts`
- `server/jobs/editorial.test.ts`
- `server/services/punditBrain.evidence.test.ts`
- `server/services/punditBrain.generation.test.ts`
- `server/services/openRouter.regression.test.ts`
- `server/services/aiProvider.test.ts`
- `server/services/aiDiagnostics.test.ts`

These use mocked provider/API boundaries, real browser components, and a private disposable Redis process where applicable. They are not proof of live model compliance. Coverage includes per-card retries, sequential batches, cancellation/recovery, duplicate-click locks, edit/copy/save POST/PATCH, Idea behavior, responsive layouts, 6px cards, and reduced motion.

`pnpm check`, `pnpm build`, and `git diff --check` passed. Existing editor lint/deprecation notices remain; this was not a repository-wide lint cleanup.

Verification artifacts: `/tmp/tsp-create-gemini-e2e-regressions.json` and `/tmp/tsp-create-gemini-build.log`.

After the credential correction, the three isolated provider/diagnostic suites were rerun: **141 passed, 0 failed**, with `pnpm check` and `git diff --check` passing again. Artifact: `/tmp/tsp-paid-key-provider-regressions.json`. No production code changed during the credential correction.

Operational note: the app intentionally prefers `GEMINI_API_KEY` over `AI_INTEGRATIONS_GEMINI_API_KEY`. When both exist, ensure the primary is the intended project's key. Paid-account balance, model-catalog access, and CLI account presence alone do not establish that the running app uses that paid credential.