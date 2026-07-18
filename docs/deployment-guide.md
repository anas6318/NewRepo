# Deployment Guide

## 1 · Supabase

1. Create a project (region: closest to Israel, currently eu-central).
2. SQL editor → run `supabase/migrations/0001_schema.sql`, then
   `0002_rls.sql`.
3. Staging/dev only: run `supabase/seed.sql` (demo-labeled data — never in
   production).
4. Auth → URL configuration: set site URL + redirect URLs to your domain.
5. Copy the project URL + anon key (frontend) — the service-role key is
   used only by edge functions (auto-injected there).

## 2 · Edge functions

```bash
supabase functions deploy place-order track-order submit-review \
  payments-webhook sheets-sync admin-actions
supabase secrets set TRACKING_HASH_SECRET=$(openssl rand -hex 32) \
  EMAIL_PROVIDER=console ALLOWED_ORIGIN=https://yourdomain.tld
# later, as each service is onboarded:
# supabase secrets set RESEND_API_KEY=… EMAIL_PROVIDER=resend EMAIL_FROM=…
# supabase secrets set GOOGLE_SHEET_ID=… GOOGLE_SERVICE_ACCOUNT_EMAIL=… GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=…
# supabase secrets set ISRAELI_GATEWAY_API_KEY=… ISRAELI_GATEWAY_WEBHOOK_SECRET=…
```

Schedule the Sheets retry drain (Dashboard → Edge Functions → cron, or
pg_cron): POST `sheets-sync` with body `{"drain":true}` every 15 min using
the service-role key.

## 3 · Frontend (Vercel)

1. Import the repo; framework preset **Vite**; build `npm run build`,
   output `dist` (`vercel.json` already carries SPA rewrites + CSP/security
   headers + immutable asset caching).
2. Env vars (Production + Preview): everything in `.env.example`'s VITE_
   section — at minimum `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_SITE_URL`. Leave `VITE_DEMO_MODE` empty (auto-off once Supabase is
   set). WhatsApp/Instagram/analytics IDs when available.
3. Deploy. **This is the first real `npm install` + Vite build — read the
   log** (see test-report provenance note).

Any static host works instead: build, upload `dist/`, add SPA fallback
rewrites equivalent to `vercel.json` + the same headers.

## 4 · Domain

Add the domain in Vercel → set `VITE_SITE_URL` to the final URL → redeploy
(it's baked into canonical/hreflang/sitemap/JSON-LD) → update Supabase Auth
URLs + edge `ALLOWED_ORIGIN`.

## 5 · First owner account

Register normally on the storefront, then in SQL:
`update profiles set role='owner' where email='you@…';`
Roles: owner, admin, order_manager, content_manager (see admin-guide).

## 6 · Staging smoke test (required before production)

- [ ] `/ar` `/he` `/en` load; dir/lang correct; no console errors.
- [ ] Register + login works; profile row created by trigger.
- [ ] Create a product (draft) → rights cleared → publish → visible in shop.
- [ ] Guest bank-transfer checkout → order in `/admin/orders` as
      awaiting_payment; confirmation email visible in function logs
      (console mode).
- [ ] Tracking: number+email works; number+wrong contact yields the same
      generic failure.
- [ ] Admin: set payment paid → timeline gains payment_confirmed; resync →
      sheets_sync_log row transitions (disabled until Google is set,
      synced after).
- [ ] RLS spot-check with two accounts: A cannot read B's orders/wishlist
      (try direct PostgREST calls with A's JWT).
- [ ] `/sitemap.xml`, `/robots.txt`, one prerendered product URL served
      statically (curl it — HTML must contain the product name).
- [ ] `npm run test:e2e` against the deployed URL
      (`E2E_BASE=https://… node tests/e2e/run-e2e.mjs --skip-build` after
      exporting BASE support, or run locally against prod Supabase env).

## 7 · Backup & recovery

Supabase: enable PITR (paid) or schedule `pg_dump` via GitHub Action;
export `store_settings`/`products` JSON monthly (admin CSV export covers
orders). Frontend is stateless — redeploy from git. Secrets live in
Supabase/Vercel — document owners in your password manager.
