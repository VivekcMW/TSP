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
