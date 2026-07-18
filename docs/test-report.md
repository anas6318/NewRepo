# Test Report

Every claim below was produced by commands run in this delivery environment
against this exact source tree. Anything not run is listed under
"Not executed" — nothing there is claimed to work.

## Executed and passing

**TypeScript (strict) — 0 errors.** `tsc -p tsconfig.sandbox.json` over all
app + unit-test sources (strict, noUncheckedIndexedAccess, noUnused*). The
sandbox config differs from the default only in using a local React type
shim (`types-shim/`) because @types/react cannot be downloaded in this
environment; all application types are fully checked. On a normal machine
run `npm run typecheck` for the same gate with the real @types/react.

**Unit tests — 47/47 pass.** `node --experimental-strip-types --test
tests/unit/*.test.ts`: pricing (₪5 patch, version/sleeve adjustments,
rounding, rejection of invalid quantities/negative prices), delivery
(unlock at exactly 3 qualifying items incl. the spec's cross-line and
single-product×3 examples, quantity-not-value, no-zone→error), schema
validation, router matching/specificity/locale-swap, catalog filters +
trilingual + typo-tolerant search, dictionary parity (403 keys × 3 locales,
zero missing/empty/placeholder-mismatched), WhatsApp link building.

**End-to-end — 40/40 pass** (Playwright + Chromium against the built app,
`npm run test:e2e`): language gate; ar/he RTL + en LTR; switcher preserves
the equivalent page; remembered language; no translation-key leaks;
catalog + URL-synced shareable filters; search incl. typo + suggestions;
wishlist persistence; patch = exactly +₪5 and removable; player +₪20;
quantity math; free personalization with required spelling confirmation;
conditional options (hoodie has no version/personalization, kids sizes
only); unavailable product blocks purchase; size-guide dialog; free
delivery locked at 1–2 items with honest progress text, unlocked at 3
(three ways); cart persistence; checkout totals with/without free delivery;
bank transfer as the only visible method, labeled manual-verification;
validation blocks bad checkout; full guest order → CR-XXXXXX confirmation →
tracking with correct contact succeeds / wrong contact + number-alone fail
generically; order appears in admin; customer accounts rejected from
admin; status update extends the timeline; bank verification flow; review
approve/moderation; CSV import → drafts only with duplicate + bad-row
reporting; drafts invisible to customers; rights gate blocks publish until
cleared; demo Sheets resync reports honestly that nothing external ran;
skip link; drawer Esc + focus restore; role=alert errors; all controls
labeled; lang/dir per locale.

**Visual audit — 97 screenshots, zero errors.** `npm run screenshots`:
10 storefront pages × 3 locales × 3 viewports (390/820/1440) + admin +
language gate → `docs/screenshots/`. Automated checks: no console/page
errors, no horizontal overflow anywhere. Key shots reviewed by eye.

**Build + SEO artifacts.** Sandbox esbuild production bundle: **149.8 KB
gzip JS + 7.8 KB gzip CSS**. `sitemap.xml`: 117 URLs with hreflang.
Prerender: **114/114 public pages** written as static HTML; spot-checked
for hreflang ×4, JSON-LD, localized titles/descriptions and crawlable
product markup.

**ESLint — clean** over scripts/tests (plain-JS surface; TS is gated by
tsc — the core eslint binary here has no TS parser; on a normal machine add
typescript-eslint per `eslint.config.mjs`'s header note).

**Demo data generation.** 45 original neutral images (sharp), seed.sql
generated from the canonical demo dataset.

## Bugs found by these tests and fixed during delivery

1. `useCatalog` refetch loop: a fresh `base` object each render re-triggered
   the load effect (visible as skeleton flicker; Playwright caught it as
   unstable DOM). Fixed by value-keying the memo/effect.
2. Product-card stretched link overlaid the wishlist button (clicks
   intercepted). Fixed with stacking-context CSS.
3. `schema.ts` used TS constructor parameter properties, unsupported by
   Node's type-stripping test runner. Rewritten to explicit fields.
4. Home `<title>` duplicated the brand suffix. Fixed in `usePageMeta`.

## Not executed here (requires normal network / live services)

- `npm install`, the **Vite build itself**, `npm run typecheck` with real
  @types/react, vite preview. The shipped esbuild pipeline compiled the
  same sources for every test above, but treat the first Vite build as a
  required verification step.
- Anything against a **live Supabase project**: migrations apply, RLS
  behavior with real JWTs, edge functions (place-order, track-order,
  payments-webhook, sheets-sync, admin-actions), email sending, real
  auth flows. Run `docs/deployment-guide.md` §Staging smoke first.
- Real payment-provider sandboxes (no credentials exist — spec forbids
  faking them), real Google Sheets sync, real email delivery.
- Lighthouse scoring (Chrome-headless-only environment without the npm
  lighthouse package). Bundle sizes + prerender + image discipline are in
  `performance-report.md`; run Lighthouse in CI or DevTools post-deploy.
- Mobile Safari / Firefox / physical devices: e2e ran on Chromium
  (mobile viewports emulated). Cross-browser pass is a launch-checklist
  item; the CSS avoids Chromium-only features except where noted
  (`color-mix`, logical properties — Baseline 2023+ in all evergreen
  browsers).

## Addendum — production-readiness repair pass (2026-07-15)

Changes: `npm run typecheck` now auto-selects the right tsconfig
(scripts/typecheck.mjs) and **exits 0 here**; @types/node +
typescript-eslint + react-hooks plugin added to devDependencies; explicit
undefined guard in tests/unit/catalog.test.ts; ESLint config now covers
src/scripts/tests (TS blocks self-disable with a printed warning when
typescript-eslint isn't installed — the case in this sandbox, where tsc
remains the TS gate); `getConfig()` hard-disables demo mode whenever a
Supabase URL is configured (VITE_DEMO_MODE cannot re-enable it); Supabase
login/register now catch network failures and surface a normal error
(found by the new production-mode e2e — previously the form hung); two new
e2e specs: production-config behavior (no demo banner/credentials, demo
logins rejected, no simulated-payment labels) and full route coverage
(69 localized deep links, localized 404, mobile+desktop layouts, all 13
admin routes).

Executed this pass: typecheck exit 0 · lint exit 0 · unit 47/47 ·
**e2e 48/48** · sandbox production build + sitemap (117 URLs) +
prerender 114/114 · preview serving deep links (200, RTL HTML) ·
generated-HTML inspection (unique localized titles, canonical, hreflang,
crawlable localized content, zero demo credentials in public HTML).

Genuinely attempted and still blocked by this environment's network
policy: `npm install` → registry 403 (log in ~/.npm/_logs/…2026-07-15…),
therefore `npm run build` (Vite) exits 127 at `vite: not found` after its
typecheck step passes. Vite/rollup exist nowhere on this disk and cannot
be fetched. **The genuine Vite build remains the one unexecuted build
step** — it must run on any machine with normal registry access
(`npm install && npm run build`); every test above ran against the
equivalent esbuild bundle of the same sources.
