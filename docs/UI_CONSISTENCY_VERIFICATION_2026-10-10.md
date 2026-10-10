# UI consistency verification — 2026-10-10

## Scope

The retained Playwright audit covers the end-user application in Chromium,
Firefox and WebKit:

- 25 public, authentication and preference routes
- 6 authenticated workspace routes
- 320px, 375px, 768px and 1440px viewport widths
- 93 browser/route tests and 372 responsive page evaluations

The suite checks:

- one visible `main` landmark and one visible page-level `h1`
- no document or body horizontal overflow
- no visible broken images
- Inter body typography and Poppins heading typography
- loaded design tokens before measurements
- 44px mobile button height and 44px icon-only targets
- consistent enabled primary-button color pairs
- matching shared header/body gutters where those primitives are used

The role-protected admin console is not included because the local development
bypass intentionally creates a normal workspace user, not an administrator.
One representative blog article covers the shared dynamic article template.

## Command and retained reports

Run:

```bash
pnpm test:consistency
```

The config is `playwright.consistency.config.ts` and the assertions are in
`e2e/consistency.spec.ts`.

The latest run passed:

```text
93 passed (2.3m)
```

Generated evidence:

- HTML report: `playwright-report/consistency/index.html`
- JSON report: `test-results/consistency-results.json`
- failure traces/screenshots, when applicable:
  `test-results/consistency-artifacts/`

These generated directories are intentionally gitignored; the reproducible
config, assertions and this verification record are versioned.

## Defects corrected during the audit

- Long display headings can wrap at narrow widths.
- Public footer Cookie settings now has a 44px mobile target.
- Marketing CTAs no longer nest links around buttons.
- Password visibility and reset controls now have mobile-safe targets.
- Create Post hashtag suggestion controls now have mobile-safe targets.
- The WebKit audit waits for design tokens and typography before measuring,
  preventing a false pass or failure during stylesheet application.

## Supporting verification

- `pnpm check`
- `pnpm design:check`
- targeted Vitest consistency regressions: 195 passed
- `pnpm build`
- `git diff --check`
