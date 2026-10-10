# Agentic Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chip-picker onboarding with an agent that understands the user, builds a pre-selected setup from live news while showing its work, and can be steered in plain language.

**Architecture:** The existing grounded suggestion pipeline (`server/services/onboardingSuggestions.ts`) gains understanding/instruction context, deterministic picks, a note and progress callbacks. A new streaming route runs steps in order and emits server-sent events. The client replaces `use-onboarding-suggestions` with `use-onboarding-agent`, which consumes the stream, pre-selects picks, supports steering and keeps "more like this" refreshes.

**Tech Stack:** Express, zod, Gemini via `generateText`, Google News RSS, React 18, TanStack Query, vitest + Playwright fixtures.

**Spec:** `docs/superpowers/specs/2026-09-24-agentic-onboarding-design.md`

## Global Constraints

- Test-first for every behaviour change; run `npx tsc --noEmit -p .` before each commit.
- No database migration; no new environment variables.
- Rate limit: reuse `onboardingSuggestionRateLimit` (60 requests per user per hour) for understand and agent.
- Pre-selection sizes: 6 sources, 8 topics, 4 people, 4 companies.
- Automatic understanding: 1.2 s pause, at least 20 characters, at most 6 automatic calls per session.
- Copy uses sentence case and plain words; no static industry lists in onboarding.

---

### Task 1: Understanding endpoint

**Files:**
- Create: `server/services/onboardingUnderstanding.ts`, `server/services/onboardingUnderstanding.test.ts`
- Modify: `server/routes/onboarding-suggestions.ts`, `server/routes/onboarding-suggestions.test.ts`

**Interfaces:**
- Produces: `understandFocus(input: UnderstandRequest, scope, signal?): Promise<Understanding>`;
  `Understanding = { role: string; industry: string; focusAreas: string[]; region: string | null; audience: string | null; question: { text: string; options: string[] } | null }`;
  route `POST /api/onboarding/understand`.

- [ ] Tests: returns trimmed, bounded fields; drops empty focus areas; returns a question only when the model asks one and no clarification was given; clarification is sent in the prompt and suppresses the question; model failure surfaces as `AIGenerationError`; cached per input.
- [ ] Route tests: 400 on invalid input, 200 with understanding, auth/permission/rate limit wired.
- [ ] Implement, run, commit.

### Task 2: Pipeline context, picks, note and progress

**Files:**
- Modify: `server/services/onboardingSuggestions.ts`, `server/services/onboardingSuggestions.test.ts`

**Interfaces:**
- Request gains `understanding?: { role?; focusAreas?; region?; audience? }` and `instruction?: string (≤200)`.
- Responses for publications/topics/people gain `picks: string[]` and `note: string`.
- `suggestOnboardingItems(input, scope, signal?, onProgress?: (message: string) => void)`.

- [ ] Tests: picks = first 6 outlets / top 8 topics / first 4 people (news first) and 4 companies; note comes from the model and is trimmed; instruction and understanding appear in prompt context; progress messages report searches, counts and the choosing phase; cached results still carry picks and note.
- [ ] Implement (bump `CACHE_VERSION`), run, commit.

### Task 3: Streaming agent route

**Files:**
- Modify: `server/routes/onboarding-suggestions.ts`, `server/routes/onboarding-suggestions.test.ts`

**Interfaces:**
- `POST /api/onboarding/agent` body: suggestion context plus `steps: ("publications"|"topics"|"people")[]` (1–3, in order) and optional `instruction`, `exclude` per request.
- Events (`data: <json>\n\n`): `{ type: "progress", step, message }`, `{ type: "result", step, ...response }`, `{ type: "error", step, code }`, `{ type: "done" }`.

- [ ] Tests: full build streams progress then results in order and carries publication picks into the topics request and topic picks into the people request; a single-step run uses the client's selections; a failed step emits `error` and later steps still run; client disconnect aborts; invalid body → 400 JSON.
- [ ] Implement with `text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, flushed headers, 60 s budget, run, commit.

### Task 4: Client parsing

**Files:**
- Modify: `client/src/lib/onboarding-suggestions.ts`, `client/src/lib/onboarding-suggestions.test.ts`

**Interfaces:**
- `parseUnderstanding(value): Understanding`, `readEventStream(response, onEvent)`, `parseAgentEvent(value): AgentEvent | null`, `SuggestionResult` gains `picks: string[]` and `note: string`.

- [ ] Tests for each parser (malformed entries dropped, events split across chunks, unknown events ignored), implement, commit.

### Task 5: Agent hook

**Files:**
- Create: `client/src/hooks/use-onboarding-agent.ts`
- Delete: `client/src/hooks/use-onboarding-suggestions.ts`

**Interfaces:**
- `useOnboardingAgent(step, context, selections)` returns `{ state, catalog, feed, run(steps, instruction?), retry(step), reset(), cancel() }`; `state[step] = { status, items, picks, note, batches, refreshes, error }`.
- Selection changes are applied through callbacks supplied by the wizard (`applyPicks(step, picks, replacedAgentPicks)`).

- [ ] Covered by the browser tests in Task 6 (the hook has no DOM-free behaviour worth isolating).

### Task 6: Wizard UI

**Files:**
- Create: `client/src/components/onboarding/understanding-card.tsx`, `client/src/components/onboarding/agent-step.tsx`
- Modify: `client/src/components/onboarding/onboarding-wizard.tsx`
- Delete: `client/src/components/onboarding/suggestion-panel.tsx`
- Test: `client/src/pages/onboarding.browser.test.ts`, `client/src/pages/ux-audit.test.ts`

- [ ] Browser tests (write first): understanding card appears after a pause and is editable; follow-up question answer refines it; "Build my setup" streams feed lines and pre-selects picks with reasons on every step; steering keeps user picks, drops untouched agent picks, never re-adds removals and shows the note; add-your-own works for sources (with website), topics, people and companies; no static list chip renders; "Set up manually" makes no AI calls and "Let the agent help" starts it; failures show "Try again"; completion payload keeps URLs and weights; finish preview unchanged; 320 px has no horizontal scroll.
- [ ] Implement, run, commit.

### Task 7: Verify and ship

- [ ] Full suite and typecheck.
- [ ] Live local run with the paid Gemini key for the DOOH, fintech and pharma personas (timings, quality, feed).
- [ ] Commit, deploy (clean worktree → no-traffic candidate → checks → switch → remove tag), production walkthrough in the test Chrome, runbook note.
