# Replit Decoupling & Stabilisation

**Date:** 2026-08-28
**Status:** Phases 1–3 implemented and verified. Phase 4 partly done (see below). Phase 5 not started.

## Implementation status

| Phase | State |
|---|---|
| 1 — Stabilise | **Done.** Auth contract, gate error branches, `@types/pg`. Gemini key deferred by the user. Temporary login bypass added (§2.5). |
| 2 — Decouple from Replit | **Done and verified by clean `npm ci`.** Zero `@replit` packages; boots in dev and production with no Replit env vars. |
| 3 — Test the gate | **Done.** 22 tests, Vitest + Supertest, real test database. Both critical assertions mutation-checked. |
| 4 — Split | **Done.** `routes.ts` (977 lines) → 7 resource modules + a composer. `App.tsx` 391 → 296 lines: gate extracted, `PublicRoutes` de-duplicated, `clerk-appearance.ts` extracted, render-time `setState` removed, signed-out `/dashboard` redirect, 404 symmetry. Verified against the pre-split compiled bundle: 26 routes, identical registration order and middleware chains. |
| 5 — Production readiness | **Partly done.** Versioned migrations implemented (`db:migrate`, checksum-tracked, `drizzle-kit push` prohibited). Remaining: Vercel serverless migration, boot-time env validation, README. Blocked on §7.3 (Postgres host). |
**Context:** Follows commit `ec66ac9` "Migrate authentication from Replit Auth to Clerk"

---

## 1. Verdict: no re-architecture

The question that prompted this document was whether the app needs re-architecting. It does not. The evidence:

| Signal | Finding |
|---|---|
| Total app code | 18,839 lines across `client/` + `server/` + `shared/` |
| Typecheck | Clean except one missing `@types/pg` |
| Stack coherence | React + wouter + TanStack Query + Express + Drizzle + Clerk — conventional, no layer fighting another |
| Largest files | `punditBrain.ts` 1082, `onboarding-wizard.tsx` 1049, `routes.ts` 977 |
| **Tests** | **Zero.** No runner, no `test` script, no spec files |

The last row is the argument. A re-architecture is a large behaviour-preserving refactor, and there is currently no way to prove behaviour was preserved. The layering is already correct: the client talks HTTP to an Express API, auth is one middleware, data access sits behind `storage`/Drizzle, AI sits behind a service. None of the defects found were structural — the auth failure was a wrong claim name, the trap was a missing error branch, the AI failure was an empty env value.

What the codebase actually carries is **incomplete migration debt**: the Clerk migration landed the new auth but left the Replit scaffolding, the old session tables, the old password-auth columns, and — most seriously — an email service that still calls Replit's connector API for its credentials.

This plan clears that debt in five phases. Each ships independently.

### Non-goals

- Typed RPC layer (tRPC/oRPC). Worth doing when the next major feature lands, not now.
- Feature-folder colocation of client and server code.
- Test coverage beyond the auth gate.
- Rewriting the AI engines or the onboarding wizard.

---

## 2. Phase 1 — Stabilise

Three defects currently prevent the app from working for a signed-in user. Fix these first so later phases are verified against a working app.

### 2.1 The auth contract

`server/middlewares/requireAuth.ts:26` reads `auth.sessionClaims.userId`, and `:36` reads `sessionClaims.email`. Neither is a default Clerk claim — the native subject claim is `sub`, surfaced by `@clerk/express` as `auth.userId`. Both only exist if a session-token customisation defines them. Without that template, every authenticated request returns 401, which is the cause of the observed `POST /api/complete-registration 401`.

Because the app is pre-launch with no Replit-Auth subjects to preserve, the custom-claim approach is dropped entirely rather than given a fallback:

```ts
const { userId } = getAuth(req);
if (!userId) return res.status(401).json({ message: "Unauthorized" });

let [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
if (!dbUser) {
  const clerkUser = await clerkClient.users.getUser(userId);
  const email = clerkUser.primaryEmailAddress?.emailAddress;
  if (!email) return res.status(422).json({ message: "Clerk account has no primary email" });
  // ...insert as today, onConflictDoNothing
}
```

Three deliberate decisions:

- **Email comes from the Backend API, not a claim.** This removes the entire class of bug — there is no session-token template to configure and nothing to drift.
- **The `getUser` call is on the miss path only**, so it costs one API call per user lifetime, not per request. A test locks this in.
- **No primary email is 422, not 401.** It is a real, unretryable data problem; reporting it as "Unauthorized" is what made the original bug unreadable.

Rename the middleware to `requireDbUser` — it currently shadows `@clerk/express`'s own exported `requireAuth`.

**Error contract**, relied on by the client gate and nothing else:

| Status | Meaning | Client behaviour |
|---|---|---|
| 401 | No valid Clerk session | Sign out, return to sign-in |
| 422 | Valid session, unusable account | Terminal error screen |
| 500 | Server fault | Offer retry |

### 2.2 Transport: keep cookies

`server/static.ts` serves the built client from the same Express process, so client and API are always same-origin. `credentials: "include"` is therefore correct, and a bearer token would add a `getToken()` await to every request for no gain. An earlier draft of this plan proposed a bearer fallback; it is dropped as speculative. If the client is ever split onto a CDN, that is the moment to add it.

### 2.3 The client gate trap

`client/src/App.tsx:305-330` treats every non-success from `/api/me` as "not registered". Because the global query default is `on401: "throw"` with `retry: false` and the `error` field is never read, a failing `/api/me` leaves `dbUser` undefined, so `registrationComplete` is false and the user is pinned to the registration form — whose submit then 401s too. `/api/profile` has the identical shape, trapping users in the onboarding wizard.

Fix: one branch ahead of the others. If either query reports `isError`, render an `AuthError` screen — message plus sign-out — instead of falling through.

### 2.4 The Gemini key

`.env` contains `AI_INTEGRATIONS_GEMINI_API_KEY=` and `AI_INTEGRATIONS_GEMINI_BASE_URL=` with **zero-length values**. Six modules construct `GoogleGenAI` at import time, producing the six startup warnings. Every AI path fails at call time: inbox scoring, post generation, instant review, onboarding identity analysis. The dashboard fires `/api/inbox/refresh` on mount, so this hits on first load.

Populate the key. Phase 5 adds boot-time validation so this fails loudly instead of silently.

### 2.5 Temporary login bypass — MUST BE REMOVED

Clerk sign-in is not currently working locally, and diagnosing it was deferred, so phase 1 shipped a development-only auth bypass to unblock work on the rest of the app. **This is tracked debt with a removal condition, not a design decision.**

Files: `server/middlewares/devAuth.ts`, `client/src/lib/dev-auth.ts`, plus a branch at the top of `requireDbUser` and the `isLoaded`/`isSignedIn` override in `App.tsx`.

Activation requires **both** `NODE_ENV !== "production"` and `DEV_AUTH_BYPASS === "true"` (opt-in; absent means off). While on, there is no authentication at all — every request runs as a seeded `dev-user-local`, with registration and onboarding pre-completed because the onboarding wizard calls `/api/ai/analyze-identity` and so cannot be finished without a Gemini key.

Guards, all three verified by test:

| Guard | Verified behaviour |
|---|---|
| `NODE_ENV=production` + flag set | Refuses to boot, exit code 1 |
| `NODE_ENV=production`, no flag | Boots normally, `/api/me` returns 401 |
| Production client bundle | Bypass dead-code-eliminated; zero occurrences of the flag or the dev user id |

**Removal condition:** delete both files, the `requireDbUser` branch, the `App.tsx` override, and the `DEV_AUTH_*` entries in `.env` as soon as real Clerk sign-in works. `useIsSignedIn()` should then collapse back to Clerk's `isSignedIn`.

A side effect worth keeping: `useIsSignedIn()` replaced six scattered `useUser().isSignedIn` reads with one seam, and `AppSidebar` now falls back to the local `users` row for display identity. Both are improvements independent of the bypass and should survive its removal.

**Phase 1 verification:** with the bypass on — `/api/me` returns the seeded user, `/api/profile` reports `onboardingStatus: "completed"`, and `/api/inbox` and `/api/drafts` return 200. Once real sign-in works, re-verify the original path: sign in, land on the dashboard, complete registration and onboarding, and confirm an inbox refresh returns articles.

---

## 3. Phase 2 — Decouple from Replit

Mostly deletion, but three items are rewrites. Deletion is safe here because everything removed is provably unreferenced; the rewrites are verified manually.

### 3.1 Rewrites (do these first — they are functional gaps)

**Email is broken off-Replit.** `server/services/emailService.ts:145-168` fetches Resend credentials from Replit's connector service:

```
https://$REPLIT_CONNECTORS_HOSTNAME/api/v2/connection?include_secrets=true&connector_names=resend
```

authenticated with `REPL_IDENTITY` / `WEB_REPL_RENEWAL`. This cannot work off Replit, and does not work locally either — `.env` already carries a `RESEND_API_KEY` that the code never reads. Replace `getCredentials()` with a direct read of `RESEND_API_KEY` and a new `RESEND_FROM_EMAIL`. Drop `connectionSettings` caching along with it.

**LinkedIn callback base URL.** `linkedinAnalyticsAuth.ts:71` falls back to `REPLIT_DOMAINS`. Reduce the chain to: explicit `LINKEDIN_ANALYTICS_CALLBACK_URL` → `APP_URL` → `http://localhost:$PORT`.

**Vite config.** `vite.config.ts` calls `runtimeErrorOverlay()` **unconditionally**, so a Replit plugin is loaded in production builds. Remove it and the two `REPL_ID`-gated plugins.

### 3.2 Deletions

| Target | Size |
|---|---|
| `server/replit_integrations/` | 418 lines, 8 files — referenced only from its own comment |
| `server/middlewares/clerkProxyMiddleware.ts` + its mount | 146 lines |
| `CANONICAL_HOST` redirect block in `server/index.ts` | ~20 lines |
| `replit.dev` / `repl.co` / `replit.app` CORS patterns | 3 patterns |
| `.replit`, 3 `@replit/*` plugins, `vite.config.ts.*` gitignore entry | config |
| `artifacts/mockup-sandbox/` | 74 tracked files, 608K — a second Vite project in the repo |
| `attached_assets/` | 68 tracked files, 6.1M — the `@assets` alias has **zero** code references |
| `VITE_CLERK_PROXY_URL`, `publishableKeyFromHost` multi-domain resolution | client + server |

**Correction (measured during implementation).** An earlier draft claimed deleting `replit_integrations` would remove 2 of the 6 `GoogleGenAI` constructions and drop the startup warning count to 4. That was wrong on both counts: the directory was never imported, so its constructions never executed and never produced warnings. The count is 6 before and after.

The actual source is 2 warnings per construction (verified) from the 3 live constructions in `punditBrain.ts`, `metaEngine.ts` and `engines/baseEngine.ts`. All 6 disappear once `AI_INTEGRATIONS_GEMINI_API_KEY` is set. Consolidating those three onto a single shared client is a reasonable follow-up but is not in this plan.

With the proxy gone, `App.tsx` can resolve the Clerk publishable key directly from `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY`, removing the `publishableKeyFromHost` + `proxyUrl` machinery and the "copy verbatim" comments that no longer apply.

### 3.3 Dead schema

`shared/schema.ts:6` re-exports `./models/auth`, so Drizzle does manage these tables.

- `sessions` — express-session store. `express-session` is no longer even a dependency; `linkedinAnalyticsAuth.ts:14-17` documents that OAuth state moved to a stateless HMAC-signed parameter.
- `authAccounts` — zero imports anywhere. Clerk owns social login; analytics uses the separate `socialAccounts` table.
- `conversations`, `messages` — the `replit_integrations/chat` tables. Delete `shared/models/chat.ts` too.
- `users.password_hash`, `users.reset_token`, `users.reset_token_expiry` — pre-Clerk local password auth. Also delete `sendPasswordResetEmail` (`emailService.ts:399`), which links to `/reset-password?token=…`, a route that does not exist.

Once those columns are gone, `toSafeUser` strips nothing. Keep the function as the seam but drop the destructuring.

Pre-launch with no real users means this is a `drizzle-kit push` accepting the destructive prompts. No backfill.

### 3.4 Dependencies

Seven declared with no import: `next-themes` (dead since `theme-provider.tsx`/`theme-toggle.tsx` were deleted), `@hookform/resolvers`, `@mailchimp/mailchimp_transactional`, `zod-validation-error`, `ws`, `tw-animate-css`, `@jridgewell/trace-mapping`. Plus `@types/passport-local` (you use `passport-oauth2`) and `@types/ws`. Plus the 3 `@replit/*`.

Verify each individually rather than bulk-removing. **Leave the other `@types/*` alone** — they are ambient, so "no import" proves nothing.

Separately, `script/build.ts`'s esbuild allowlist names six packages that **are not dependencies at all**: `openai`, `stripe`, `nodemailer`, `multer`, `xlsx`, `jsonwebtoken`. Prune them. Note `passport` and `passport-oauth2` **are** real — LinkedIn analytics OAuth uses them.

### 3.5 Rename

`SESSION_SECRET` → `OAUTH_STATE_SECRET`. It is the HMAC key for the LinkedIn OAuth `state` parameter and has nothing to do with sessions.

**Phase 2 verification:** `npx tsc --noEmit` clean (fix the `@types/pg` gap here), `npm run build` succeeds, dev server boots with fewer warnings, and a manual pass through sign-in → dashboard → analytics → a sent welcome email.

---

## 4. Phase 3 — Test the gate

No test infrastructure exists today. This phase adds ~5 dev dependencies and a test database — the only place in the plan that adds rather than removes. Target is ~20 tests, not a coverage drive.

**Runner: Vitest**, because it reuses `vite.config.ts` and its `@`/`@shared` aliases with no extra config. Scripts: `test` (`vitest run`), `test:watch`.

### 4.1 Make the gate a pure function

Testing the current gate would mean rendering `App.tsx` inside a fake `ClerkProvider` with jsdom and RTL — heavy machinery for one cascade of `if`s. Instead extract the decision:

```ts
export type GateState =
  | 'loading' | 'public' | 'redirect-signin' | 'redirect-dashboard'
  | 'auth-error' | 'register' | 'onboarding' | 'dashboard' | 'not-found';

export function resolveGate(input: {
  clerkLoaded: boolean;
  signedIn: boolean;
  me:      { status: 'loading' | 'error' | 'ok'; registrationCompleted: Date | null };
  profile: { status: 'loading' | 'error' | 'ok'; onboardingStatus: string | null };
  path: string;
}): GateState
```

`AppRoutes` becomes a thin `switch` from `GateState` to a component. The state machine — the part that traps users — becomes testable with zero DOM and zero Clerk mocking. This is the same extraction phase 4 needs, so the work is not spent twice.

### 4.2 Server tests: real DB, faked Clerk

A `thesocialpundit_test` database, schema via `drizzle-kit push`, tables truncated between tests. Because `server/db.ts` reads `DATABASE_URL` at module load, a Vitest setup file that sets it before import is a sufficient seam — no refactor of `db.ts`.

Clerk is faked with `vi.mock('@clerk/express')` supplying a controllable `getAuth` and `clerkClient.users.getUser`. That is the right boundary: what is under test is our reaction to Clerk's outputs, not Clerk. Supertest drives a minimal Express app mounting only `requireDbUser` and a probe route.

### 4.3 Cases

Chosen to match real failure modes.

**`requireDbUser`:** no session → 401 · session + existing row → 200 and `getUser` *not* called · session + no row + email → row provisioned → 200 · session + no row + no email → **422, not 401** · concurrent duplicate first request → `onConflictDoNothing` resolves to one row · DB throws → 500.

**`resolveGate`:** `me` errored → `auth-error`, **never** `register` · `profile` errored → `auth-error`, **never** `onboarding` · signed out on `/dashboard` → `redirect-signin` · `registrationCompleted` null → `register` · onboarding incomplete on `/dashboard` → `onboarding` · all complete → `dashboard` · signed in on `/sign-in` → `redirect-dashboard` (an earlier draft of this list said `redirect-signin`, which was simply wrong — it would have bounced a signed-in user back to the page they came from).

The first two gate cases are the phase-1 trap encoded as tests, which is the reason this phase exists.

**Out of scope:** AI engines (nondeterministic, cost money per run), `rssService` (network), marketing pages, the 40 shadcn `ui/` components.

---

## 5. Phase 4 — Split the two oversized files

Optional. Stopping after phase 3 leaves a working, tested, much smaller app. This is the highest-churn phase and is sequenced last deliberately, behind the tests that protect it.

### 5.1 `server/routes.ts` (977 lines, ~30 endpoints)

Split into `server/routes/` by resource, each exporting a `register(app)`:

`auth.ts` (`/api/me`, `/api/complete-registration`) · `profile.ts` · `inbox.ts` · `drafts.ts` · `ai.ts` · `social.ts` · `analytics.ts` · `index.ts` composing them.

Pure code movement. No signature or behaviour changes.

### 5.2 `client/src/App.tsx` (391 lines)

`App.tsx` is currently simultaneously the router, the auth gate, the registration gate and the onboarding gate.

- `lib/gate.ts` — `resolveGate` (already extracted in phase 3)
- `components/auth-gate.tsx` — maps `GateState` to a component
- `components/public-routes.tsx` — the 13-route public list, currently **duplicated verbatim** at `App.tsx:249` and `:286`
- `lib/clerk-appearance.ts` — the ~60-line appearance object
- `App.tsx` retains providers and top-level routing only

### 5.3 Two fixes to fold in

- **`setState` during render.** `App.tsx:271-274` calls `setLocation("/dashboard")` in the render body — React warns, and the effect at `:214-218` already does it. Delete the render-time branch.
- **Signed-out `/dashboard` renders the landing page at the `/dashboard` URL** (`App.tsx:236-238`) without changing the URL, so a bookmarked link shows marketing content and reload repeats it. Return `redirect-signin` instead.

---

## 6. Phase 5 — Production readiness

What "standalone app" requires beyond removing Replit.

### 6.1 Boot-time env validation

A Zod schema in `server/env.ts`, parsed once at startup, that fails loudly with the missing variable names. Required: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `AI_INTEGRATIONS_GEMINI_API_KEY`, `OAUTH_STATE_SECRET`, `APP_URL`. Optional with defaults: `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `LINKEDIN_*`.

This is what turns the phase-1 Gemini defect from a silent failure into a refused boot. Also rewrite `.env.example` to match, since `.env` is correctly gitignored and there is currently no template.

### 6.2 Versioned migrations

`drizzle.config.ts` already sets `out: "./migrations"`, but there is no `migrations/` directory and `package.json` only exposes `db:push`. `push` is a dev tool; production needs versioned SQL. After the phase-2 schema deletions settle, generate an initial migration and add `db:generate` / `db:migrate` scripts, keeping `db:push` for local iteration only.

### 6.3 Deployment: Vercel

**Decided: Vercel.** This is more than a host swap. The app is currently a long-running stateful Express process — `httpServer.listen()` plus `serveStatic` serving the built client from the same process. Vercel runs serverless functions plus CDN static hosting, so four assumptions that only hold for a persistent process must change.

**Runtime model.** The client is built by Vite and served as static assets from the CDN. The Express app becomes a single serverless function (`api/index.ts` exporting the app as a handler), with `vercel.json` rewriting `/api/*` to it and everything else to the SPA shell. `httpServer.listen()`, `serveStatic`, `/healthz` and the `script/build.ts` esbuild bundle all become dead on this path — the esbuild step is replaced by Vercel's own build.

Deploying client and API as **one Vercel project** keeps them same-origin, so the cookie decision in §2.2 stands unchanged. Splitting them into two projects would break it and force bearer tokens.

**Connection pooling — the significant one.** `server/db.ts` creates a `pg.Pool` at module load. In serverless, every cold start creates a new pool, and concurrent invocations exhaust Postgres connections. Options, in order of preference: a driver designed for serverless over HTTP (Neon's), or a connection pooler in front of Postgres (PgBouncer/Supavisor in transaction mode) with `pg` pool size pinned to 1. This decision is coupled to where Postgres is hosted, which is now an open question — see §7.

**Function duration.** `/api/instant-review` fans out to 8 Gemini calls in one request, and `/api/inbox/refresh` does RSS fetching plus AI scoring. Both risk exceeding the function timeout. Needs an explicit `maxDuration`, and if that is not enough, the fanout has to move to a background job or stream partial results.

**Rate limiting breaks silently.** `express-rate-limit` defaults to an in-memory store. Across serverless instances each has its own memory, so the limits in `server/middlewares/rateLimit.ts` — including the 10/hour Instant Review budget guarding your most expensive path — become close to unenforced. Needs a shared store (Vercel KV / Upstash Redis).

Platform specifics here were written from the analysis, not from the Vercel docs. Verify against the `vercel:vercel-functions`, `vercel:vercel-storage` and `vercel:deployments-cicd` skills when this phase starts.

### 6.4 Operational basics

- **`README.md`** — there is none. Setup, env vars, scripts, deploy.
- **The error handler re-throws.** `server/index.ts` responds and then `throw err`, which surfaces as an unhandled rejection on every handled error. Log instead of rethrowing. This matters more on Vercel, where an unhandled rejection can fail the invocation after a response was already sent.
- **Remove the Replit port hack** — `reusePort: process.platform === "linux"` exists for Replit's container networking; it goes with the `listen()` call.
- **Graceful shutdown is not applicable** on serverless — dropped from this plan. (It would have been required for the Docker path.)
- **Keep a local long-running path.** `npm run dev` must keep working as it does today, so the `listen()` call moves behind a "not on Vercel" guard rather than being deleted outright.

### 6.5 Deferred client-side items

Found during analysis, not blocking, tracked so they are not lost:

- `getQueryFn` builds URLs with `queryKey.join("/")` — fragile for any non-path key element.
- `staleTime: Infinity` globally — correct for `/api/me`, wrong for `/api/inbox` and `/api/analytics`.
- Dashboard pages destructure only `data, isLoading`, so a failed query renders as "empty" rather than "broken".
- `dashboard.tsx:72-80` fires `/api/inbox/refresh` once per browser tab against a 20-per-15-min limit.
- Sidebar Hot Trends links both navigate away and fire a mutation on one click.
- Duplicate sign-out buttons in the sidebar footer.
- `AuthenticatedLayout` uses `h-screen`, which clips on mobile browsers with dynamic toolbars; the auth pages correctly use `100dvh`.

---

## 7. Decisions

**Resolved 2026-08-28:**

1. **Deployment target: Vercel.** One project serving both the static client and the API function, which preserves same-origin and therefore the cookie decision in §2.2. See §6.3 for the runtime-model consequences.
2. **`attached_assets/` — delete.** Confirmed by the user; zero code references and the `@assets` alias is unused.

**Still open:**

3. **Where Postgres lives.** `DATABASE_URL` currently points at local Postgres (`localhost:5433`). Vercel has no managed database of its own, so production needs a provider, and the choice determines the §6.3 pooling approach: a serverless-native driver (Neon) removes the pooling problem outright, whereas a conventional Postgres host requires a pooler plus a pinned pool size. Needed before phase 5, not before phase 1.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Phase 2 deletes something reachable by a path not caught by grep | Type check plus manual pass after each deletion group; deletions are committed separately so any one is revertible |
| Phase 4 changes behaviour while "just moving code" | Sequenced after phase 3 so the gate tests protect it |
| Email rewrite untested — Resend domain may not be verified | Verify `thesocialpundit.com` in Resend before phase 2; test with a real send |
| `drizzle-kit push` destructive prompts drop the wrong thing | Pre-launch, no real data; take a `pg_dump` first anyway |
| Serverless migration (§6.3) is the largest single change and is sequenced last, so problems surface late | Phases 1–4 are runtime-agnostic and leave the app working locally either way; the `listen()` path is kept for local dev so the change is additive rather than a cutover |
| Rate limits and connection pooling fail *silently* on serverless rather than erroring | Both are called out explicitly in §6.3 as required work, not optional hardening |

## 9. Sequencing

Phases are strictly ordered: 1 → 2 → 3 → 4 → 5, with §6.1 (env validation) pulled forward into phase 2 since it is what makes the phase-1 Gemini defect impossible to reintroduce.

Phases 1–4 are deployment-agnostic — none of them depend on the Vercel decision, and all of them leave the app working under `npm run dev`. Phase 5 is where the runtime model changes.

Rough shape: phase 1 is hours, phases 2–4 are about a day each, phase 5 is the largest and least certain, being both a platform migration and the only phase with an unresolved dependency (§7.3).
