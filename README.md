# CROWNED — premium multilingual football-jersey store

React + Vite + TypeScript storefront and admin dashboard for CROWNED —
retro, current-season and national-team football shirts, made to order,
sold in **Arabic, Hebrew and English** across Israel. Backend: Supabase
(Postgres, Auth, RLS, Edge Functions).

> **Build provenance:** this project was developed and verified inside a
> network-restricted environment (no npm registry). Unlike a typical
> unverified delivery, the application **was actually compiled, run,
> unit-tested (47/47), end-to-end tested in Chromium (40/40) and visually
> audited (97 screenshots, 3 locales × 3 viewports)** using a vendored
> esbuild pipeline over the same `src/`. What could NOT be exercised there:
> `npm install` + the Vite build itself, and anything requiring a live
> Supabase project. Details: `docs/test-report.md`.

## Run it locally (2 minutes, no backend needed)

```bash
npm install
npm run dev            # http://localhost:5173
```

With no `VITE_SUPABASE_URL` configured the app starts in **clearly-labeled
DEMO MODE**: full catalog, cart, simulated checkout, order tracking and the
complete admin dashboard run on local in-browser data. No real services, no
real money. Demo accounts (visible on the login pages):

- customer `demo@crowned.example` / `demo1234`
- admin (owner) `admin@crowned.example` / `admin1234` → `/admin`

Zero-install alternative (mirrors the delivery environment): `npm run
sandbox:build && npm run sandbox:serve` → http://localhost:4173.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server / production build (typecheck → build → sitemap → prerender) / preview |
| `npm run typecheck` | `tsc --noEmit` (strict). Sandbox variant: `tsc -p tsconfig.sandbox.json` |
| `npm run test` | Unit tests (node:test) — pricing, delivery, schema, router, catalog, i18n parity, WhatsApp links |
| `npm run test:e2e` | Playwright e2e — localization/RTL, filters, pricing, free delivery, checkout, tracking security, admin, a11y |
| `npm run screenshots` | Visual audit sweep → `docs/screenshots/` |
| `npm run lint` | ESLint (scripts/tests; TS gated by tsc — see eslint.config.mjs note) |
| `npm run sitemap` / `prerender` | SEO artifacts into `dist/` |
| `npm run demo:images` | Regenerate neutral demo artwork (sharp) |

## Going live (summary — full steps in docs/deployment-guide.md)

1. Create a Supabase project; run `supabase/migrations/0001_schema.sql` then
   `0002_rls.sql`; seed dev/staging with `supabase/seed.sql` (never prod).
2. Deploy edge functions in `supabase/functions/` and set their secrets
   (`.env.example` lists every name).
3. Set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (+ site URL, WhatsApp,
   Instagram, analytics IDs) and deploy `npm run build` output to Vercel
   (config in `vercel.json`) or any static host with SPA rewrites.
4. Promote your owner account:
   `update profiles set role='owner' where email='you@…';`
5. Work through `docs/launch-checklist.md` before announcing.

## Key guarantees implemented

- Free name & number; patches +₪5; prices recomputed **server-side** at
  order time — client totals are never trusted.
- Free delivery at **3+ qualifying items by quantity**, never cart value.
- Bank transfer live end-to-end with manual verification; other payment
  methods are architecture-complete but **hidden until real credentials
  exist — nothing ever fakes a successful payment**.
- Order tracking needs order number **+** matching email/phone; failures
  are indistinguishable (anti-enumeration).
- Supplier imports and new products start as **draft**; publishing is
  blocked (app + edge function + DB constraint) until product rights are
  marked cleared.
- Reviews require moderation; demo reviews are labeled and never seeded to
  production.
- Google Sheets is a one-way mirror with a retry queue; Postgres stays the
  source of truth; never connects to any legacy spreadsheet.

## Documentation index

| Doc | Purpose |
|---|---|
| `docs/architecture.md` | Stack decisions (incl. local router/schema rationale), folder map, SEO strategy |
| `docs/test-report.md` | Exactly what was executed vs. what still needs a live environment |
| `docs/deployment-guide.md` | Supabase + edge functions + Vercel + domain |
| `docs/admin-guide.md` | Roles and every admin area |
| `docs/payment-setup.md` | Wiring card/PayPal/Bit/PayBox for real |
| `docs/google-sheets-setup.md` | New-sheet sync setup |
| `docs/performance-report.md` | Bundle sizes, prerender, what Lighthouse still needs |
| `docs/security-checklist.md` | Implemented vs. deploy-time items |
| `docs/launch-checklist.md` | Ordered go-live path |
| `docs/*-checklist.md` | Assets, legal, translation review, payment onboarding |
| `docs/supplier-import-template.csv` | Import format |

## Known limitations (read before assuming)

- No live payment gateway; only bank transfer is operational (by design
  until the owner obtains merchant credentials).
- Supabase mode (`SupabaseDataService` + edge functions + RLS) is
  architecture-complete but has **not run against a live project** — do the
  staging smoke test in the deployment guide first.
- `npm install` + Vite build never executed in the delivery environment
  (registry blocked) — the equivalent esbuild pipeline was used for all
  testing; treat the first Vite build as a required verification step.
- Demo imagery is original placeholder art; size charts are labeled
  placeholders; policies are drafts pending legal review.
- Product images are referenced by URL (owner-supplied assets); Supabase
  Storage upload UI is a documented follow-up (see architecture.md §Later).
