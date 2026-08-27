---
name: Clerk migration - non-login OAuth carve-outs
description: How to preserve an app-specific "connect account" OAuth flow (e.g. LinkedIn analytics connect) when migrating login from Replit Auth / express-session to Clerk.
---

Some apps have OAuth flows that are NOT login — e.g. a "Connect your LinkedIn account" button used only for pulling analytics after the user is already signed in. These flows commonly used `express-session` to store CSRF `state` / return-URL context across the OAuth redirect round trip.

When a Clerk migration removes `express-session` entirely (Clerk owns session/cookies now), that pattern breaks — there is no server-side session to stash state in.

**Fix:** replace the session-stored state with a stateless, signed `state` param:
- Encode the payload (user id, return-to path, a nonce, an expiry timestamp) as base64url JSON.
- Sign it with HMAC-SHA256 keyed by an existing app secret (e.g. `SESSION_SECRET` if still present for this purpose).
- Verify the signature + expiry on the OAuth callback before trusting the payload.

**Why:** avoids reintroducing `express-session` (or any other session store) just for one non-login OAuth flow, while still getting CSRF protection and safe return-path handling.

**How to apply:** carve this flow into its own module/file separate from the Clerk login wiring, so it's clear it's an independent feature that survives the auth-provider swap untouched in behavior (same routes, same UX), only the state-storage mechanism changes.
