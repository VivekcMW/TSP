# Create and Content: external composer handoff

## Source contract — 2026-10-01

The full-page Create workbench's Article cards, Idea posts and Content's manual
handoff share `PlatformComposeAction`. **Copy & open** is a manual handoff, not
a publishing API. Local handoff/browser regressions pass in the 1,150-test
integrated checkpoint; no logged-in external-platform or production acceptance
is claimed. See [adoption notes](UI_UX_IMPLEMENTATION_2026-10-01.md).

Sources: `client/src/components/platform-compose-action.tsx`,
`client/src/lib/{platform-handoff,platforms}.ts`,
`client/src/components/dashboard/{social-preview-card,instant-review-panel}.tsx`,
`client/src/components/dashboard/use-create-post-composer.ts`, and
`client/src/pages/drafts.tsx`, `shared/editorial.ts`.

## Exact text and safe navigation

- Copy the exact current platform/tone text, including edits, newlines, Unicode, source links and hashtags. No trimming, truncation, duplicate source link, or hidden re-insertion of a link the user removed. Generated article posts already include their source link in the visible text.
- LinkedIn opens `feed/?shareActive=true&text=…`, not the URL-only `sharing/share-offsite` dialog. This text parameter is **undocumented/best effort**; clipboard backup and paste instructions are required. LinkedIn may discard text during login or change composer behavior.
- X, Threads and Bluesky use text intents. Existing Farcaster/Weibo/VK/LINE destinations retain the complete encoded payload rather than slicing it. All destinations have a full-text clipboard fallback; a query parameter is not a promise that the destination will honor it.
- Platforms without a text intent open their existing destination for manual paste. Media attachments must be attached on the destination separately.
- Start clipboard access before opening a tab, reserve a blank tab synchronously during the click, then navigate only after copy succeeds and current ownership is rechecked. Clear `opener` before external navigation and navigate through a `noreferrer` link with `referrerPolicy="no-referrer"`. Do not substitute parent-initiated `location.replace`; native Chromium opener/referrer regressions pass against intercepted destinations.
- Clipboard denial closes the reserved blank tab and exposes selectable complete text plus an explicit continuation link. Popup/navigation failure retains the successful copy and exposes a secure continuation link. Neither is reported as successful publication.
- Empty, over-limit and operation-locked versions cannot use the Create handoff.
	Shared validation checks platform length (including X's weighted links) and
	the separate 5,000 raw UTF-16-character application cap; it never fixes an
	invalid post by silently truncating it. Batch-reserved/saving/uncertain versions
	are guarded, while other completed unlocked cards can remain usable.
- Duplicate clicks are locked. Feedback/recovery links are invalidated by text,
	platform or disabled-context changes; Create keys the action by platform/tone.
	Late clipboard feedback must not restore a stale version's continuation link.
- `canProceed` and synchronous busy admission are checked before work and again
	immediately before external navigation. Unmount, source/draft/text/platform or
	delivery-lock changes abandon the reserved popup. Stale completion cannot
	release a newer action's lock. An already-completed clipboard write cannot be
	undone; only stale navigation/feedback can be prevented.
- Content's manual-pending ref synchronously excludes direct publishing, and
	the latest draft identity/readiness is checked after delayed clipboard work.
	Dismissing a monitor does not clear uncertain delivery or authorize a handoff.
- This action makes no application save, publish, schedule, account-connection
	or publishing-provider API request. It does navigate to an external website;
	that site's behavior is outside the application's acknowledgement contract.
	Content's direct-publishing controls and delivery monitors are separate.

## Presentation and Idea formatting

- Use the shared neutral outline Button: `size="sm"` still has a 44px minimum,
	not a compact action. Keep the accessible description and full-text fallback.
	Selected platform controls use accent/pressed semantics; a provider logo does
	not indicate selected, connected, approved or delivered status.
- Keep Article's 6px bento and maximum four sequential generation targets.
	Copy/open is per current card/tone, not a batch publication operation.
- Idea generation and handoff consume **plain text**. Markdown remains literal;
	the preserved font, size, colour, list, alignment and other formatting controls
	change the source editor preview only. Rich styling is neither submitted nor
	restored after navigation. The horizontally scrolling formatting strip is a
	dense-control exception, not a reason to shrink Copy & open.
- Media must be attached manually at the destination; no formatting or upload
	preview implies that external media delivery or factual verification occurred.

## Keep outcomes separate

| Action | What it acknowledges | What it does not acknowledge |
|---|---|---|
| Copy text / Copy & open | Clipboard success and, if possible, opening a destination | Saving, approval, scheduling, publication or a provider receipt |
| Save draft / Save changes | Validated server draft ID and content/revision | Voice consent, publishing approval, schedule or delivery |
| Retain approved edit | Explicit consent for the chosen voice sample | Automatically enabling voice guidance, checking facts or approving publication |
| Approve publishing | Separate review approval of exact saved content/revision | Scheduling or delivery |
| Schedule / reschedule | Confirmed text, destinations and time/zone admitted for scheduling | All targets delivered |
| Publish directly | An explicit application publishing request, followed by target monitoring | A successful queue/job response alone is not live delivery |

Only delivery outcomes with the required target/receipt evidence may be described
as published. Simulation, accepted-but-unverified, manual claims and unknown
outcomes remain distinct. Never silently replay an uncertain request. Content
disables manual handoff for scheduled, already-submitted, unavailable or uncertain
drafts to avoid another copy; dismissing a monitor does not resolve that state.

Copy uses exact visible text; saving is a different boundary whose server may
trim submitted content. Existing saved edits PATCH with acknowledged
`expectedContent` and `expectedUpdatedAt`, including a real legacy `null`, and
surface `draft_conflict` explicitly. Reads, conflict resolution and copy/open
never silently retry a save. See [revision/reload contract](editorial-reload-recovery.md).

## Exact saved-draft destinations

`SavedDraftLinks` appears only for confirmed saved state and uses
`/dashboard/content?draft=<encoded-id>` and
`/dashboard/calendar?draft=<encoded-id>`:

- Content clears conflicting initial filters, chooses the draft's status group
	and focuses/highlights that exact record. It does not open an editor,
	bulk-select the draft or issue a write on arrival.
- Calendar preselects a ready linked draft in its confirmation dialog; an
	existing schedule is shown in the list instead of recreated. Text, targets,
	readiness and time/zone still require review and explicit confirmation.
- Missing/inaccessible/unsuitable links never substitute the first ready draft.
	Clear draft selection removes only that query parameter, preserving other
	context. Independent scoped no-store GET `/api/drafts/:id/details` resolves
  beyond-list IDs using receipt-aware projection, not raw publishing status.
  Storage applies the tenant/user/ID predicates before limiting results. Failed
  reads offer retry and remain distinct from missing/forbidden records.

Source replacement and reload rules remain separate: ordinary dashboard
navigation retains in-memory work, but a reload restores only an acknowledged
unfinished job pointer, never saved-card baselines, text, selection or formatting.

## References and verification scope

- [LinkedIn Share Plugin](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/plugins/share-plugin) documents URL sharing, not prefilled commentary. [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin) requires OAuth and `w_member_social` for API publication; this action does not use that API.
- [Threads web intents](https://developers.facebook.com/docs/threads/threads-web-intents) documents `https://www.threads.com/intent/post?text=…`.
- `client/src/lib/platform-handoff.test.ts` (44 cases), `client/src/components/dashboard/editorial-generation.test.ts`, publishing UX and actual-App regressions pass in `/tmp/tsp-ux-priority-sUHyaB/tests.json`. They cover full payloads, latest edits, card/tone isolation, denial, blocked/closed navigation, delayed ownership loss, duplicate clicks, native Chromium opener/referrer isolation and narrow layout. These cases are part of the 1,150 total, not additional tests.
- Browser tests use mocked API/clipboard boundaries and an intercepted destination, not logged-in social accounts. They do not prove that external platforms retain the prefill after login, inspect attached media, or publish anything. No paid AI generation is needed for handoff validation.
- External references above are retained background links, not newly fetched or
	revalidated for this documentation refresh. Current reports/screenshots and the
  temporary build are recorded in the adoption notes; no commit or deployment
  was performed. Live social prefill after login and publication remain untested.