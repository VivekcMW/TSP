# External inputs: newsletter forwarding and save from any page

Two ways to get stories into a member's **Shortlist** (inbox status `saved`) from outside the app.
Both land in Shortlist rather than For you, so they never hit the For you capacity limit and never
replace curated stories. Nothing is ever posted automatically.

| Input | Entry point | Auth | Code |
| --- | --- | --- | --- |
| Forward newsletters | `POST /api/inbound/email` (provider webhook) | `INBOUND_EMAIL_SECRET` | `server/services/inboundEmail.ts`, `server/routes/inputs.ts` |
| Save from any page | `POST /api/capture` (extension, bookmarklet) | personal key (`Bearer tsp_cap_…`) | `server/services/captureTokens.ts`, `server/routes/inputs.ts`, `extension/` |
| Settings panel | `GET/POST/DELETE /api/inputs/*` (session) | `inbox:read:own` / `inbox:write:own` | `client/src/components/inbox/inputs-panel.tsx` |

Data lives in three tables from `migrations/0064_inbound_inputs.sql`: `inbound_addresses`,
`inbound_messages` and `capture_tokens`.

## Newsletter forwarding

### How it works

1. A member selects **Create address** in More connectors and gets a private address
   `<26 random lowercase letters and digits>@INBOUND_EMAIL_DOMAIN` (about 134 bits). Plus addressing
   (`token+anything@…`) also works. **Replace address** issues a new token at once; **Turn off** disables it.
2. The member forwards newsletters to it, usually with a Gmail filter. Gmail first sends a forwarding
   confirmation; it is recorded (not processed) and its code is shown under **Recent forwards**.
3. The email provider posts each message as JSON to `/api/inbound/email`. The handler:
   - checks the shared secret (constant time) **before** reading the body, which may be up to 10 MB;
   - finds the address by the SHA-256 of the token in `OriginalRecipient`, `To`, `Cc` or `Bcc`;
   - confirms the owner is still a member who may write to their inbox;
   - deduplicates by `Message-ID` (header, else the provider's ID, else a content hash);
   - allows 30 messages per address per rolling 24 hours (counted in the database, so it holds across instances);
   - extracts up to 10 article links: skips unsubscribe, preferences, view-in-browser, social profile and
     share links, `mailto:`, app-store links, images and tracking pixels, homepages and the sender's own
     section pages; unwraps redirect wrappers whose target is a plain query parameter (Google, Outlook
     Safe Links, Facebook and similar); strips tracking parameters; deduplicates; titles come from the
     anchor text (or image alt text, or the URL slug);
   - creates Shortlist items with source `Newsletter: <sender>`. For hand-forwarded mail the original
     sender is read from the forwarded header block. **Pages are not fetched** when mail arrives.
4. Responses: `200 {"received":true}` for every well-formed message, including unknown or disabled
   addresses, duplicates and messages over the daily limit (the provider learns nothing about which
   addresses exist and does not retry them); `400` for a payload that is not an inbound email; `401` for a
   wrong secret; `503` when forwarding is not configured; `500` if saving fails (the reservation is released,
   so the provider's retry is processed normally).

### Production setup (Postmark)

1. **Pick an inbound subdomain**, for example `in.thesocialpundit.com`. Do not use the main domain: its MX
   records route staff mail.
2. **DNS**: add one MX record for the subdomain and nothing else is required for receiving.

   | Host | Type | Priority | Value | TTL |
   | --- | --- | --- | --- | --- |
   | `in.thesocialpundit.com` | MX | 10 | `inbound.postmarkapp.com` | 3600 |

3. **Postmark**: in the production server, open the default **Inbound** message stream.
   - Settings → **Inbound domain forwarding**: `in.thesocialpundit.com`.
   - Settings → **Webhook URL**:
     `https://postmark:<INBOUND_EMAIL_SECRET>@www.thesocialpundit.com/api/inbound/email`
     (HTTP Basic; the user name is ignored). Leave "Include raw email content" off.
   - Use **Check** to send a sample payload: expect `200` (its recipient is unknown, so nothing is saved).
4. **Environment** (Cloud Run, from Secret Manager), then redeploy:
   - `INBOUND_EMAIL_DOMAIN=in.thesocialpundit.com`
   - `INBOUND_EMAIL_SECRET=` at least 32 characters, e.g. `openssl rand -base64 48 | tr -d '/+='`
   Both are optional. Without them the panel says forwarding is not available and the webhook returns `503`.
   `WEBHOOK_ENCRYPTION_SECRET` (already required in production) encrypts the stored copy of each address so
   members can see it again; without encryption the address is shown only when created or replaced.
5. **Migration**: apply `0064_inbound_inputs.sql` before deploying the code.
6. **Smoke test**: create an address in the app, forward a newsletter to it, and check **Recent forwards**
   and Shortlist. The secret can be sent as `X-Inbound-Secret` instead of Basic auth when testing with curl.

**Rotating the secret**: change `INBOUND_EMAIL_SECRET` and the Postmark webhook URL together. Messages that
get `401` in between are retried by Postmark.

**Other providers** (Mailgun Routes, SendGrid Inbound Parse, Cloudflare Email Workers) post different
formats. Add an adapter next to `parsePostmarkInbound` that returns the same `InboundEmail` shape, or have a
Cloudflare Email Worker post Postmark-shaped JSON to the same URL.

## Save from any page

### Keys

- Created in More connectors → **Save from any page** → **Create key**. Format `tsp_cap_` + 43 base64url
  characters (256 bits). Only the SHA-256 and the last four characters are stored; the key is shown once.
- Up to 5 active keys per member. **Revoke** stops a key immediately. `last_used_at` is updated on use.
- Every use re-checks that the owner is still a member who may write to their inbox.

### `POST /api/capture`

```http
POST /api/capture
Authorization: Bearer tsp_cap_…
Content-Type: application/json

{ "url": "https://…", "title": "optional", "selection": "optional, ≤ 2000 chars", "note": "optional, ≤ 1000 chars" }
```

- CORS for this route only: any origin, no cookies (`Access-Control-Allow-Origin: *`, no
  `Allow-Credentials`); preflight is answered. Every other route keeps the credentialed origin allowlist.
- The URL must be http(s) and resolve to a public address (`resolvePublicHttpUrl`). The page is not fetched.
- Limits: 60 saves per key per hour and 600 per IP per hour (shared through Redis when `REDIS_URL` is set).
- `201` creates a Shortlist item (source = the site's host name). `200` means the story already existed; it is
  moved to Shortlist if it was elsewhere. With a selection or note, a Note is also created:
  `From <title>: “<selection>” — <note>`, shortened to the 1000-character note limit (the note keeps priority).
  If the member is at the note limit the page is still saved and `noteMessage` explains why.

### Browser extension

`extension/` is a dependency-free Manifest V3 extension (toolbar popup with an optional note, a
**Save to TheSocialPundit** context menu for pages, links and selected text, and an options page for the app
address and key). Permissions: `activeTab`, `contextMenus`, `storage`, plus optional host access requested for
the configured app origin only. Install and publishing steps are in [`extension/README.md`](../extension/README.md).

To publish: add 16/32/48/128 px icons, bump the version, zip the folder contents, upload to the Chrome Web
Store Developer Dashboard, complete the privacy and permission justifications, and submit for review. After
approval, set `VITE_CAPTURE_EXTENSION_URL` (build-time) to the listing URL so the panel links to it; until
then the panel explains how to load the extension unpacked.

### Bookmarklet

Shown in the panel right after a key is created, built from that key and the app's origin. It posts the page
URL, title and any selected text to `/api/capture` and shows the result in an alert. Some sites block
bookmarklet requests with their Content-Security-Policy (`connect-src`); the bookmarklet then says so and
suggests the extension. A bookmarklet runs inside the page, so a hostile page could read the key from it;
the extension does not have this exposure. The panel warns that anyone with the bookmarklet can add items to
the Shortlist, recommends the extension, and offers **Revoke this key**. A leaked key can add Shortlist
items and Notes (60 an hour). It can also tell whether a link is already in the Shortlist (and see that
story's headline) and move a story marked Not relevant back to the Shortlist. It cannot read anything else.

## Security notes

- **Secrets at rest**: forwarding tokens and capture keys are stored only as SHA-256 hashes (plus a 4-character
  hint). The forwarding token also has an AES-256-GCM copy (`server/services/webhookSecrets.ts`) so its owner
  can see the address again; platform staff viewing a workspace never receive it.
- **Row-level security**: all three tables use `FORCE ROW LEVEL SECURITY` with the usual `tenant_isolation`
  policy, and every query also filters by `user_id`. Token lookups happen before any tenant is known. The
  invitation tables (0049, 0050) are this codebase's precedent for resolving SHA-256 token hashes without a
  tenant; they opt out of RLS entirely. Here the tables keep RLS and add one SELECT-only policy each that
  matches only the row whose `token_hash` equals a transaction-local setting (`app.inbound_token_hash`,
  `app.capture_token_hash`). Computing that value requires the token, so the lookup cannot list or reach any
  other row, and it cannot update anything. There is no `SECURITY DEFINER` function: none exist in this
  schema, and `FORCE` RLS binds the table owner too, so its behaviour would vary by environment.
- **No SSRF surface**: newsletter links are never fetched on receipt; captured URLs are DNS-checked but not
  fetched. Any later fetch (drafting) goes through the existing pinned, SSRF-safe fetcher.
- **Webhook**: secret compared on fixed-length digests; checked before the body is parsed; identical
  responses for known and unknown recipients; logs record only the outcome, never addresses, tokens or content.
- **Stored email data**: `inbound_messages` keeps sender, subject, counts and status only, never bodies.
- **Abuse**: anyone holding an address or key can add Shortlist items. Mitigations: per-address and per-key
  limits, Replace/Turn off/Revoke, items land in Shortlist with relevance unscored, and nothing posts.
