# Agentic onboarding — design

Approved by the product owner on 2026-09-24 ("yes"), after the feedback that
onboarding "still shows static data only" and should feel agentic.

## Goals

1. **The agent understands you first.** Step 1 replies, about 3 seconds after
   the user pauses typing, with an editable summary: role, industry, 3–5 focus
   areas, region and audience. If the focus is vague, it asks one follow-up
   question with quick answers and a free-text answer.
2. **The agent builds your setup.** "Build my setup" starts one agent run that
   researches sources, then topics (from the sources it picked), then people
   and companies (from the topics it picked). Each step's result arrives as
   soon as it is ready. The agent pre-selects about 6 sources, 8 topics, 4
   people and 4 companies, each with a reason and news evidence, plus a
   one-sentence note explaining its choices. Extra options stay unselected.
3. **You watch it work.** A live feed shows the agent's real progress
   ("Searching Google News for …", "Found 46 articles from 19 publications",
   "Choosing the most relevant sources…"), streamed from the server.
4. **Chat to steer it.** Every step has "Tell the agent what to change". The
   agent redoes that step with the instruction (about 7 seconds, feed visible)
   and replies with a note. Items the user picked or typed stay; items the user
   removed never return; the agent's untouched picks are replaced.
5. **No static lists.** The built-in industry lists no longer render in
   onboarding. Each step has "Add your own" (sources: name plus optional
   website). "Set up manually" and AI failures lead to these inputs.
   Profile Settings keeps its lists (out of scope).
6. **Unchanged:** picks still add "more like this" options automatically; the
   finish screen still previews 3 real headlines; grounding checks (names must
   appear in headlines, publications must come from real results) still apply.

## Server

- `POST /api/onboarding/understand` — one short AI call, cached. Input: focus,
  optional industry, optional `clarification: { question, answer }`. Output:
  `{ role, industry, focusAreas[], region, audience, question | null }`.
- The suggestion pipeline accepts `understanding` and `instruction`, includes
  them in every prompt's context, and returns `picks` (names to pre-select)
  and `note`. Picks are deterministic from the model's ranking: first 6
  outlets, top 8 topics by weight, first 4 people (news before AI-only) and
  first 4 companies.
- `POST /api/onboarding/agent` — streams `text/event-stream` events:
  `progress { step, message }`, `result { step, ...response }`,
  `error { step, code }`, `done`. Runs the requested steps in order; a full
  build carries the agent's own picks forward to the next step. Same auth,
  permission and rate limit as suggestions; aborts work when the client leaves.
- The instruction is a preference about what to include or leave out. Prompts
  keep treating user data as untrusted and ignore any request in it to change
  rules or output format.

## Client

- Step 1: understanding card with editable chips and the follow-up question.
  Automatic understanding runs after a pause (at most 6 automatic calls per
  session). Buttons: "Build my setup" and "Set up manually".
- Steps 2–4: live feed, agent note, "Your setup" (selected items with reasons),
  "More options" (agent extras and "more like this" batches), "Add your own",
  and the steer box. A "Let the agent help" button starts the agent from a
  manual step.
- Completion payload unchanged.
