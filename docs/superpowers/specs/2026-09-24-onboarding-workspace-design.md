# Onboarding workspace (Direction B) — design

Chosen by the product owner on 2026-09-24 from three directions
(mockups: https://claude.ai/artifact/A7kj9HqUJgw4PVFmEPzswZ). It replaces the
four-page wizard layout. The agent, research and grounding built earlier stay;
this is mainly a new interface on the same server APIs.

## The experience

**One screen, two areas.** On desktop (1024 px and wider) a left panel is the
agent, "Pundit", and the right side is "Your setup". There are no step pages
and no Next buttons; progress is shown by Pundit's checklist.

**Pundit (left panel, 440 px)**
- A conversation: Pundit's greeting, the user's messages, Pundit's replies and
  notes. The composer at the bottom is the only place the user types to Pundit.
- Start: the user describes their work in the composer. Pundit replies with
  the "Here's what I understood" card (role, industry, region, audience, focus
  areas, all editable) and, for a vague focus, one question with quick answers.
- While building: a checklist (Understood your focus, Sources, Topics, People
  and companies) with live status (done, working with the current progress
  line, waiting). The full activity log opens under "Show what I did".
- After each step: Pundit's note as a message, plus up to three "Try asking"
  chips proposed by the agent for that step (for example "More India-focused").
- Steering: a message typed in the composer applies to one section. A pill in
  the composer ("About: Sources") shows which. It defaults to the section the
  user last touched and can be changed. "Try asking" chips carry their own
  section. The user's message appears as a bubble; Pundit replies with its note.

**Your setup (right)**
- Before building: three outlined placeholders (Sources, Topics, People and
  companies) explaining what Pundit will find, with "Build my setup" and
  "Set up manually".
- While building: sections fill as results stream in. A section still in
  progress shows placeholder chips. Selected items are cards with a check,
  the evidence ("12 recent articles") and the reason. Clicking a card toggles
  it. "Why?" opens the headlines behind a pick (up to three). Unselected agent
  options sit under "More options" in each section. Each section ends with an
  "Add your own" card (sources take a name and an optional website).
- "Finish setup" (top right) is always available. It saves and turns the right
  side into "Your Discover is ready": counts, today's matching headlines
  (the existing preview), and "Write a post" on each headline, which opens
  Create with that story. Pundit offers the same in its panel.

**Phones and narrow windows (under 1024 px):** two tabs, "Pundit" and
"Your setup · N". A strip at the top shows Pundit's current step. The composer
and "Try asking" chips stay pinned at the bottom on both tabs.

**Manual path:** "Set up manually" shows the same canvas with only "Add your
own" cards. Pundit's panel offers "Let Pundit help" at any time.

## Server changes (small)

- Agent results gain `followUps`: up to three short steering suggestions
  (at most 40 characters each) written by the same model call as the note.
- Publication evidence gains `headlines`: up to three recent headlines per
  source, for "Why?". Topic and people evidence keep one headline.
- No new routes. `/understand`, `/agent` (stream) and `/suggestions` ("more
  like your picks" and the finish preview) are unchanged otherwise.

## Behaviour kept from today

Grounding rules, pick counts (6, 8, 4 + 4), steering semantics (the user's own
picks stay, untouched agent picks are replaced, removals never return),
"more like your picks", retry and busy messages, the 20-item limits, and the
completion payload.

## Accessibility

Real buttons and inputs throughout; the checklist and new messages are
announced through a polite live region; focus moves to the composer after
"Build my setup"; the tabs on phones are a proper tab list; no horizontal
scroll at 320 px.

## Testing

Browser tests are rewritten for the workspace: start conversation and
understanding card, build with streaming checklist, steering with the section
pill and with chips, "Why?", add-your-own, manual path, finish with "Write a
post" opening Create, busy/failed steps, phone tabs at 390 px and no overflow
at 320 px. Server tests cover `followUps` and publication headlines.

## Guided app tour (2026-10-22)

The first-run tour begins after registration, at the **Message Pundit** input
on the setup screen. Each instruction is anchored to a real visible control,
with an arrow and a spotlight; it is not a centered slideshow.

- The 13-stage interactive walkthrough waits for real actions and acknowledged
  results: submit a meaningful focus in Pundit, choose agent/manual setup,
  save setup, optionally connect an account, select a Discover story (or use
  your own idea), prepare a document, open platform adaptation, generate usable
  versions, save a version, open that exact draft, review publishing options,
  confirm a publishing choice, and inspect its result.
- Every step has an always-enabled **Next** button, so users can click through
  the whole tour without entering data. Completing the highlighted action shows
  "Done" but never advances automatically. Setup-save, generation, draft-save
  and publishing failures do not mark a step done. Skipping past setup closes
  the guide on the setup page; it resumes at the connection stage once setup is
  saved. Skipped draft and result steps resume normally, without a draft ID or
  outcome. **Continue without connecting** marks the optional connection done.
- Publishing actions are tied to the saved draft ID. The result distinguishes
  a confirmed future schedule, live delivery status, manual copy/open handoff,
  demo simulation, and delivery needing attention. A successful publish-now
  request alone is not evidence of publication. Persisted schedule/target
  status can reconcile a resumed confirmation step without sending again.
- Callouts reposition around their targets, track scrolling and resizing, and
  wait for controls loaded asynchronously. Missing controls show an explicit
  waiting message with the option to skip. The non-modal guide leaves inputs,
  buttons and the actual publishing dialogs operable. It supports Escape and
  Skip; an off-route guide offers a return link. **Minimize guide** frees screen
  space without pausing progress or removing the spotlight; **Show guide**
  restores instructions. A completed action expands the current instruction
  and marks it done. Readiness is retained across pause/resume and reloads,
  including the setup-to-workspace handoff.
- Progress is stored only in this browser, scoped to the user and workspace.
  The setup header and dashboard account menu offer **App tour** to resume;
  completed workspace tours replay from the optional connection stage without
  repeating account setup. Storage contains progress, draft ID and outcome,
  never draft text or account credentials.
  Browser-storage failures are logged and do not block setup or publishing.
- The tour only explains the workflow. It does not generate, connect accounts,
  save drafts, schedule or publish on the user's behalf.

The [tour browser tests](../../../client/src/components/app-tour.browser.test.ts)
check action gating, exact-draft identity, modal interaction, distinct outcomes,
spotlight geometry, desktop/mobile targets, persistence and workspace isolation.
The [onboarding browser tests](../../../client/src/pages/onboarding.browser.test.ts)
also run the real chat/setup with the guide enabled, including a failed save.
All tests use isolated fixtures, without real AI, OAuth or publishing requests.
