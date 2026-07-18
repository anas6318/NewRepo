# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite + TypeScript (strict) | Spec requirement; SPA with prerendered public pages |
| Styling | Token-based CSS system (`src/styles/tokens.css` + logical properties) | Spec allows "equally maintainable token-based CSS"; full RTL mirroring for free; zero runtime cost |
| Routing | Local mini-router (`src/lib/router.tsx`, matcher in `router-core.ts`, unit-tested) | See "Local libraries" below |
| Validation | Local Zod-subset (`src/lib/schema.ts`, unit-tested) | Spec: "or an equivalent schema-validation library" |
| Server state | Effect-based loads via `services/` + small helpers | App-scale appropriate; TanStack Query slot documented for later |
| Backend | Supabase: Postgres + Auth + RLS + Edge Functions | Spec requirement |
| Deployment | Vercel (static + SPA rewrites, `vercel.json`) + Supabase | Reliability, IL edge presence, env/preview support; any static host works |

### Local libraries — the honest rationale

The delivery environment had **no package-registry access**, and the spec's
hard requirements were a *runnable, tested* application. `react`/`react-dom`
existed locally; `react-router-dom`, `zod`, form/query libs did not and
could not be fetched. Options were (a) import unavailable packages and ship
nothing runnable, or (b) implement small, well-tested local equivalents the
spec explicitly permits for validation/forms/query — and a router with the
same mental model as React Router (`Link`, `useNavigate`, `useParams`,
`useSearchParams`, ranked matching). We chose (b). Migration to
react-router-dom later is mechanical: the API names match; swap imports and
replace `RouteSwitch` with `<Routes>`. Dependency surface shipped: react +
react-dom only — smaller attack/maintenance surface.

## Data-service boundary

`src/services/DataService.ts` is the single interface. Resolution
(`services/index.ts`): Supabase configured → `SupabaseDataService`;
otherwise **demo mode** (`DemoDataService`, localStorage, clearly labeled,
spec §36). Storefront and admin code never know which is active — demo mode
is how the whole store stays inspectable with zero services.

Supabase mode:
- reads: RLS-guarded PostgREST with the anon key / user JWT
- order placement, guest tracking, review intake, admin mutations,
  Sheets sync: **edge functions** (`supabase/functions/`) — they hold
  service-role trust, recompute prices, hash tracking contacts, verify
  webhook signatures, write audit rows
- tables: indexed scalar columns + a `data` jsonb holding the domain object
  (`0001_schema.sql`); deny-by-default RLS (`0002_rls.sql`)

## Security model (spec §35)

UI guards are convenience only. Every privileged path re-authorizes
server-side: RLS role helpers (`current_role()`, `is_staff()`), edge-function
`requireStaff/requireAdminOrOwner`, a DB CHECK constraint enforcing the
product-rights gate, webhook signature verification before any write,
idempotency on `(provider, provider_event_id)`, contact-hash +
constant-time compare for guest tracking, no secrets in frontend env
(`VITE_*` only), CSP + security headers in `vercel.json`.

## SEO rendering strategy (spec §31)

SPA + **build-time prerender**: `scripts/prerender.mjs` serves `dist/`,
renders every public route per locale in headless Chromium and writes the
full HTML (localized title/description, canonical, hreflang ×4, Open Graph,
JSON-LD Organization/Product/BreadcrumbList) to `dist/{locale}/…/index.html`.
Crawlers get real HTML without executing JS; users get the SPA which
hydrates on navigation. `scripts/generate-sitemap.mjs` emits
sitemap.xml (117 URLs incl. hreflang alternates) + robots.txt
(admin/cart/checkout/account disallowed). Verified in this delivery — see
test-report.

## Folder map

```
index.html  vite.config.ts  vercel.json  tsconfig(.sandbox).json
src/
  main.tsx App.tsx           entry + top-level routing (/, /admin, /:locale)
  styles/                    tokens, base, components, utilities, pages
  lib/                       router, schema, env, seo, analytics (PII-free),
                             whatsapp, pricing*, delivery*, i18n (ar/he/en)
  services/                  types, DataService, catalog filters*, store
                             (cart/wishlist/session/settings/toasts),
                             demo/ (seed + service), supabase/ (client + service)
  components/                layout / ui / product / checkout
  pages/storefront/          all 30 customer pages
  pages/admin/               login, dashboard, products, imports, orders,
                             customers, reviews, shipping, payments,
                             translations, settings, audit
supabase/  migrations (schema+RLS), seed.sql (generated), functions/
scripts/   sandbox-build, serve, prerender, sitemap, screenshots, e2e infra,
           demo-images, export-seed
tests/     unit (node:test) + e2e (Playwright)
* = pure logic, directly unit-tested
```

## Storage note (Later)

Product/review images are URL-referenced fields backed by owner-supplied
assets; review photos travel as validated data-URLs into the DB in v1.
Moving both to Supabase Storage buckets with upload UI + MIME/size policies
is the documented next step (`security-checklist.md` flags the policies).

## Feature flags / future

`store_settings.internationalMode` (disabled/waitlist/enabled),
per-payment-method enable+test flags, `featured` curation, abandoned-cart
templates present but the sender is intentionally not scheduled until
consent + provider approval exist (spec §23).
