# Onboarding Workspace (Direction B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four-page onboarding wizard with one workspace: Pundit's conversation panel on the left and a live "Your setup" canvas on the right.

**Architecture:** Server APIs stay; results gain `followUps` and publication evidence gains `headlines`. The wizard's selection logic moves into `use-setup-selections`; the understanding hook becomes explicit (send, not typing pause); new presentational components render the panel, the canvas and its sections; `onboarding-workspace.tsx` composes them and owns the conversation. The page passes the saved data back so the finish view appears inside the workspace. Create accepts a story link through navigation state.

**Tech Stack:** React 18, Tailwind, wouter 3, TanStack Query, vitest + Playwright fixtures, Express/zod on the server.

**Spec:** `docs/superpowers/specs/2026-09-24-onboarding-workspace-design.md`

## Global Constraints

- Test-first; `npx tsc --noEmit -p .` before each commit; local only until the owner approves a deploy.
- Desktop two-column layout from 1024 px (`lg`); below that, tabs "Pundit" / "Your setup · N".
- Keep: grounding, pick counts 6/8/4+4, steering semantics, "more like your picks", retry and busy messages, 20-item limits, completion payload.
- `followUps`: at most 3, 2–40 characters each. Publication `headlines`: at most 3.
- Real buttons and inputs; polite live region for new Pundit messages and checklist changes; no horizontal scroll at 320 px.

---

### Task 1: Server follow-ups and publication headlines
**Files:** `server/services/onboardingSuggestions.ts` (+ test).
- [ ] Tests: results carry up to 3 trimmed, de-duplicated `followUps` from the model (none on fallback paths); publication evidence lists up to 3 headlines; cache version bumped.
- [ ] Implement; commit.

### Task 2: Client parsing and hooks
**Files:** `client/src/lib/onboarding-suggestions.ts` (+ test), `client/src/hooks/use-focus-understanding.ts`, `client/src/hooks/use-onboarding-agent.ts`, create `client/src/hooks/use-setup-selections.ts`.
- Produces: `SuggestionResult.followUps: string[]`; `SuggestionEvidence.headlines?: string[]`; `useFocusUnderstanding(industry)` → `{ status, understanding, setUnderstanding, understand(text), answer(question, reply), retry() }`; agent state per step gains `followUps`; `useSetupSelections(catalog)` → `{ lists, removed, candidates, keywordChoices, lastTouched, toggle, addCustom, addSource, applyResult, completionData(focus) }`.
- [ ] Unit tests for parsing; hooks covered by the browser tests in Task 4.

### Task 3: Create opens with a story link
**Files:** `client/src/components/dashboard/create-post-provider.tsx`; test in `client/src/pages/ux-audit.test.ts`.
- [ ] Test: arriving at `/dashboard/create` with `history.state.createFromUrl` (an https URL) opens Create in article mode with that link, once.
- [ ] Implement; commit.

### Task 4: Workspace UI
**Files:** create `onboarding-workspace.tsx`, `pundit-panel.tsx`, `setup-canvas.tsx`, `setup-section.tsx`; adapt `understanding-card.tsx`, `onboarding-finish.tsx` (preview list only); delete `onboarding-wizard.tsx`, `agent-step.tsx`; update `client/src/pages/onboarding.tsx`.
- [ ] Browser tests first (rewrite `client/src/pages/onboarding.browser.test.ts`): greeting and focus sent from the composer; understanding card editable; follow-up question; build streams the checklist and fills sources, topics, people with reasons, evidence and notes; follow-up chips steer their section; composer steering uses the section pill (defaults to last touched); "Why?" shows headlines; more like your picks; failed step with Try again rerunning later failures; manual path with add-your-own (invalid website refused) and "Let Pundit help"; finish view with headlines, Pundit's offer and "Write a post" opening Create; save failure keeps everything; phone tabs at 390 px; no overflow at 320 px.
- [ ] Update the onboarding cases in `client/src/pages/ux-audit.test.ts` (abort on leave, timeout, failure stays optional).
- [ ] Implement; commit.

### Task 5: Verify locally
- [ ] Full suite and typecheck; visible local end-to-end run with the paid key (DOOH, fintech, pharma, manual); fix what it finds; commit; ask the owner to push. Deploy only on request.
