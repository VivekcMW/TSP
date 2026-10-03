# Create post: local end-to-end findings

## Outcome: paid-key mismatch fixed; four-platform live generation passed

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