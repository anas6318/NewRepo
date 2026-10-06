# Deployment Guide

## 1 · Supabase

1. Create a project (region: closest to Israel, currently eu-central).
2. SQL editor → run every migration, in filename order:
   `0001_schema.sql`, `0002_rls.sql`,
   `0003_size_charts_and_supplier_availability.sql`,
   `0004_configurable_badge_options.sql`,
   `0005_configurable_product_sales.sql`,
   `0006_second_item_promotion.sql`,
   `0007_commerce_hardening.sql` (on an EXISTING project follow the
   deploy order in "Commerce hardening (0007)" below),
   `0008_order_transition_atomicity.sql` (on an EXISTING project apply it
   BEFORE deploying the new `admin-actions` / `place-order` — see "Order
   transition atomicity (0008)" below).
   Each is idempotent, but run them in order on a fresh project.
3. Staging/dev only: run `supabase/seed.sql` (demo-labeled data — never in
   production).
4. Auth → URL configuration: set site URL + redirect URLs to your domain.
   **Password recovery needs the three localized reset pages in the redirect
   allow-list**, or Supabase silently sends the user to the Site URL instead
   of the reset form:

   ```
   Site URL:       https://yourdomain.tld
   Redirect URLs:  https://yourdomain.tld/ar/reset-password
                   https://yourdomain.tld/he/reset-password
                   https://yourdomain.tld/en/reset-password
   ```

   A single wildcard (`https://yourdomain.tld/*`) also works. The app builds
   the `redirect_to` value itself from `window.location.origin` plus the
   active locale (`src/lib/auth-recovery.ts` → `resetRedirectUrl`), so it is
   always same-origin and always the language the visitor was already using.

   Also check **Auth → Emails → Reset Password**: the default template is
   English-only. Supabase sends one template for every locale, so either keep
   it neutral or write it trilingually — the *page* the link lands on is
   already localized, the email is not.
5. Copy the project URL + anon key (frontend) — the service-role key is
   used only by edge functions (auto-injected there).

## 2 · Edge functions

```bash
supabase functions deploy place-order track-order submit-review \
  payments-webhook sheets-sync admin-actions my-orders
supabase secrets set TRACKING_HASH_SECRET=$(openssl rand -hex 32) \
  EMAIL_PROVIDER=console ALLOWED_ORIGIN=https://yourdomain.tld
# later, as each service is onboarded:
# supabase secrets set RESEND_API_KEY=… EMAIL_PROVIDER=resend EMAIL_FROM=…
# supabase secrets set GOOGLE_SHEET_ID=… GOOGLE_SERVICE_ACCOUNT_EMAIL=… GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=…
# supabase secrets set ISRAELI_GATEWAY_API_KEY=… ISRAELI_GATEWAY_WEBHOOK_SECRET=…
#   ↑ NOT yet: no real payment provider until payments-webhook is hardened
#     (see "Production deployment sequence (commerce hardening)").
```

This one-shot deploy is for a NEW project whose migrations (§1, through
0008) are already applied. On an EXISTING project follow
"Production deployment sequence (commerce hardening)" instead.

### Email (customer status updates + owner "new order" alert)

The same four secrets drive BOTH: the customer's order-status emails and the
owner alert. Until they are set, nobody is emailed about anything — you have
to open Admin → Orders to see a new order, and the customer hears nothing.
Set all four:

```bash
supabase secrets set EMAIL_PROVIDER=resend \
  RESEND_API_KEY=re_… \
  EMAIL_FROM=orders@yourdomain.tld \
  ORDER_NOTIFICATION_EMAIL=you@yourdomain.tld
# optional: a direct Admin link inside the alert
supabase secrets set ADMIN_BASE_URL=https://yourdomain.tld
```

`EMAIL_FROM` must be on a domain you have verified in Resend, or every send
is rejected with a 403. These are edge-function secrets only — never `VITE_`
variables, and never reachable from the browser.

**Customer status emails.** Changing a status in Admin → Orders is the
trigger. Each milestone produces exactly one email, in the order's own
language (AR / HE / EN):

| Customer milestone | Fulfilment statuses that trigger it |
|---|---|
| Order received | automatic at checkout |
| Payment confirmed | `payment_confirmed`, or payment status → `paid` |
| Processing | `sent_to_supplier`, `production_started`, `supplier_processing`, `quality_inspection` |
| Shipped | `supplier_dispatched`, `in_transit`, `arrived_locally` |
| Out for delivery | `out_for_delivery` |
| Delivered | `delivered` |
| Cancelled | `cancelled`, or payment status → `cancelled` |
| Refunded | `refunded`, or payment status → `refunded` / `partially_refunded` |

Several internal steps share one customer milestone on purpose: moving an
order through four production statuses sends ONE "we're preparing it" email,
not four. `awaiting_supplier_confirmation`, `supplier_unavailable`,
`ready_for_pickup` and `issue_reported` send nothing — those are
conversations a person has.

The shipped email includes the tracking number and a carrier link when you
have entered them; enter them in the same save as the status change and they
are in the email.

Delivery is recorded per milestone on the order and shown in Admin → Orders →
order detail → **Customer emails**, with the attempt count, the address used
and the provider's own error. A milestone marked `sent` is never sent again,
by any trigger. Anything else has a **Retry** button — and the retry is
refused server-side too if the milestone was in fact already delivered.

An email failure never blocks an order update: the status change is saved
either way, and the failure is recorded so you can see it and re-send.

What each state means on an order (Admin → Orders, "Owner alert" column):

| Status | Meaning |
|---|---|
| `sent` | Resend accepted the message. |
| `failed` | An attempt was made and failed — the reason is shown next to it. |
| `disabled` | Nothing was attempted: no `ORDER_NOTIFICATION_EMAIL`, or `EMAIL_PROVIDER` is not `resend`. |
| `pending` | The order was saved but the alert result was never written back (rare — check function logs). |
| `unknown` | Placed before this feature existed. |

The alert always runs **after** the order is committed and never affects the
customer's result: a failed or misconfigured alert leaves a perfectly valid
order, recorded so you can see it and re-send by hand.

### Current verified status (2026-09-14)

| Layer | State |
|---|---|
| Templates, mapping, idempotency, retry, tracking, Admin panel | **Verified** — 262 unit + 167 e2e checks, incl. live-failure handling |
| A real send accepted by Resend | **NOT verified** — no API key has been supplied, and this repo's verification sandbox blocks `api.resend.com` by egress policy |
| Delivery to an arbitrary recipient | **Blocked on domain verification** (expected — see below) |

The one thing standing between here and a verified send is running
`npm run smoke:email` on a machine with network access and a real key. A
domain is NOT required for that first smoke test.

### Verifying email for real — the smoke test

`npm run smoke:email` sends REAL email through the exact modules the edge
functions use, and fails loudly rather than claiming anything it did not
observe. Run it from your own machine (this repo's verification sandbox
blocks outbound calls to `api.resend.com`, so it cannot be run there).

```bash
RESEND_API_KEY=re_… \
EMAIL_FROM=onboarding@resend.dev \
SMOKE_TO=your-resend-account@email.com \
ORDER_NOTIFICATION_EMAIL=your-resend-account@email.com \
npm run smoke:email
```

Optional: `SMOKE_LOCALE=ar|he|en` (default `ar`), `SITE_URL=…` to include the
track-your-order link, `SMOKE_SKIP_OWNER=1` to skip the owner alert.

It walks Order received → Processing → Shipped → Delivered against the live
API and checks, for real: one provider call per milestone; replaying every
milestone twice makes zero further calls; the shipped mail carries the
tracking number and link; the template matches the order's language and
direction; a bad key is recorded as `failed` with a debuggable reason and
does not throw; a retry then succeeds as attempt 2; and the owner alert
sends. Five customer emails plus the owner alert should arrive.

#### The resend.dev sender: what it can and cannot do

`EMAIL_FROM=onboarding@resend.dev` needs **no domain and no DNS**, so you can
verify the whole pipeline today. Its one limitation: Resend only delivers
from that sender to **the email address of your own Resend account**. Any
other recipient is refused with

> You can only send testing emails to your own email address (…). To send
> emails to other recipients, please verify a domain at resend.com/domains,
> and change the `from` address to an email using this domain.

That is expected and is not a bug in this code. Until a domain is verified,
set `SMOKE_TO` and `ORDER_NOTIFICATION_EMAIL` to your own Resend account
address, and do not put a customer's address in a test order.

### Switching to your own domain later

When you buy the domain, the ONLY application change is the value of
`EMAIL_FROM`. The sender is read in exactly one place
(`_shared/email-provider.ts` → `readEmailProviderConfig`) and flows through
config to the single Resend call; a unit test pins this so it stays true.
No code, template, migration or redeploy of application logic is required —
just the secret.

1. Buy the domain and add it at **resend.com/domains → Add Domain**. Use a
   subdomain for transactional mail (e.g. `send.yourdomain.tld`) so store
   email reputation stays separate from your personal mail.
2. Resend shows the DNS records to create at your registrar / DNS host:
   - **SPF** — a `TXT` record on the sending subdomain, typically
     `v=spf1 include:amazonses.com ~all` (copy the exact value Resend shows).
   - **DKIM** — a `TXT` (or `CNAME`, depending on what Resend issues) record
     named like `resend._domainkey`, carrying the public key.
   - **MX** — an `MX` record on the sending subdomain for bounce handling,
     usually `feedback-smtp.<region>.amazonses.com` at priority 10.
   - **DMARC** (recommended, not required by Resend) — a `TXT` record at
     `_dmarc.yourdomain.tld`, starting at `v=DMARC1; p=none; rua=mailto:…`
     so you receive reports before tightening the policy.
   Copy the values from the Resend dashboard rather than from this page —
   the DKIM key and region are specific to your account.
3. Wait for Resend to show the domain as **Verified** (usually minutes; DNS
   propagation can take up to 48h).
4. Swap the secret and redeploy nothing but the functions that read it:
   ```bash
   supabase secrets set EMAIL_FROM=orders@send.yourdomain.tld
   supabase functions deploy place-order admin-actions payments-webhook
   ```
   (Edge functions pick up secrets at invocation, but redeploy if in doubt.)
5. Re-run the smoke test with a recipient that is NOT your Resend account
   address — that is the check that domain verification actually took effect:
   ```bash
   RESEND_API_KEY=re_… EMAIL_FROM=orders@send.yourdomain.tld \
   SMOKE_TO=someone-else@example.com npm run smoke:email
   ```

### Production email checklist

- [ ] Domain shows **Verified** in resend.com/domains, with SPF, DKIM and MX
      all green.
- [ ] `EMAIL_FROM` is on the verified domain; `RESEND_API_KEY` is a
      production key (not a test key); `ORDER_NOTIFICATION_EMAIL` is the
      inbox you actually read.
- [ ] `npm run smoke:email` passes with a recipient outside your Resend
      account — all six emails arrive.
- [ ] A real checkout produces the customer confirmation AND the owner
      alert, and Admin → order detail shows both as `sent`.
- [ ] Walk one order through payment_confirmed → production_started →
      supplier_dispatched (with a tracking number) → out_for_delivery →
      delivered: five emails, each exactly once, each in the order's
      language, the shipped one carrying the tracking link.
- [ ] Re-save a status already passed: no second email, ledger untouched.
- [ ] Break `RESEND_API_KEY` deliberately, change a status: the status still
      saves, the milestone reads `failed` with a reason, and **Retry** works
      once the key is restored.
- [ ] Send a test order in each of ar / he / en and read all three emails —
      RTL layout, no mojibake, no untranslated strings.
- [ ] Check the Resend dashboard's Emails log for bounces or spam
      complaints after the first real orders.
- [ ] DMARC set to at least `p=none` with a reporting address.

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

**Why a script:** every role change is checked by the `profiles_role_guard`
trigger (`prevent_role_escalation`, migration 0002), which only lets an
existing admin/owner change roles. On a new project there is none, and an
SQL-editor session has no signed-in user, so a plain role `update` on
`profiles` is refused. The first owner is therefore created with
[`docs/sql/bootstrap-first-owner.sql`](sql/bootstrap-first-owner.sql), which
in ONE transaction:

1. refuses if any profile already has role `owner` (one-time only);
2. requires exactly one profile with the given email (case-insensitive);
3. disables `profiles_role_guard`, promotes that profile, re-enables the
   trigger, and verifies it is enabled again (`pg_trigger.tgenabled = 'O'`)
   before committing. Any failure rolls the whole transaction back, which
   also leaves the trigger enabled. The trigger and
   `prevent_role_escalation` are never modified.

**Who can run it:** only the owner of `public.profiles` — the `postgres`
role (the Supabase SQL editor runs as postgres). API roles (anon,
authenticated, service_role) cannot disable triggers.

**Steps (one-time):**

1. Register the owner's account normally on the storefront.
2. Edit the one placeholder `REPLACE_WITH_OWNER_EMAIL` on the `set_config`
   line of the file to the account's address, keeping the quotes
   (`'you@yourdomain.tld'`). An unedited file refuses and changes nothing.
   Then, in Supabase Dashboard → SQL editor, paste the whole file and Run
   (or run the edited file with psql as postgres:
   `psql "<connection string>" -v ON_ERROR_STOP=1 -f docs/sql/bootstrap-first-owner.sql`).
3. The final query must list that profile as `owner` with
   `profiles_role_guard_tgenabled = O`. Sign out and back in.

Every later role change is made by the owner in Admin, where the trigger
enforces the rules. Roles: owner, admin, order_manager, content_manager (see
admin-guide).

## 6 · Staging smoke test (required before production)

- [ ] `/ar` `/he` `/en` load; dir/lang correct; no console errors.
- [ ] Register + login works; profile row created by trigger.
- [ ] Create a product (draft) → rights cleared → publish → visible in shop.
- [ ] Guest bank-transfer checkout → order in `/admin/orders` as
      awaiting_payment; confirmation email visible in function logs
      (console mode).
- [ ] Owner alert: with the four secrets set, the order's "Owner alert"
      column reads `sent` and the email arrives. Then deliberately break
      `RESEND_API_KEY` and place another test order — the order must still
      succeed and the column must read `failed` with a reason.
- [ ] Customer emails: place a test order with an address you control. The
      confirmation arrives and "Customer emails → Order received" reads
      `sent`. Walk the order through payment_confirmed → production_started →
      supplier_dispatched (entering a tracking number) → out_for_delivery →
      delivered: five more emails, each once, each in the order's language,
      and the shipped one carrying the tracking number and link.
- [ ] Re-save a status you already passed — no second email, and the ledger
      entry is untouched.
- [ ] Break `RESEND_API_KEY`, change a status: the status still saves, the
      milestone reads `failed` with the reason, and **Retry** re-sends it
      once the key is fixed.
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
      exporting BASE support, or run locally against the STAGING Supabase
      env — never against production data).

## Production deployment sequence (commerce hardening)

The authoritative order for an EXISTING production project. Rehearse the
whole sequence on staging first, applying migrations strictly in filename
order (0001 → … → 0006 → 0007 → 0008) and verifying each before the next.
Every command below targets the hosted project you are deploying to; never
reuse anything from the local-only stack (`supabase/config.toml` project
`crowned-local`, `supabase/functions/.env.staging.local`,
`.claude/local-staging/`, `127.0.0.1:54321`, `npm run local:*`,
`supabase db reset --local`).

1. **Deploy `my-orders` and the new frontend.**
   `supabase functions deploy my-orders`, then deploy the frontend (§3). The
   frontend falls back to the legacy reads while `products_public` does not
   exist yet. Do NOT apply 0007 before this frontend is live.
2. **Apply `0007_commerce_hardening.sql`** (SQL editor), run the 0007
   verification below; then **apply `0008_order_transition_atomicity.sql`**
   and run the 0008 verification. Do not continue if either fails.
3. **Only after BOTH migrations succeeded, deploy the commerce functions that
   depend on them** (each bundles `supabase/functions/_shared/`):
   `supabase functions deploy admin-actions place-order track-order sheets-sync`.
4. Run the smoke test (§6) and the 0008 "double-click mark paid" check.

Order-of-operations warnings:

- 0007 before step 1 → empty catalog/account history for the old frontend.
- New `place-order` / `sheets-sync` before 0007 → checkout and Sheets writes
  fail (`idempotency_key`, `patch_order_data` missing).
- New `admin-actions` before 0008 → every Admin order update and resend
  returns 500; new `place-order` before 0008 loses the `order_received`
  ledger entry.
- **Rollback is the reverse order:** redeploy the PREVIOUS `place-order`,
  `admin-actions`, `track-order`, `sheets-sync` → run the 0008 ROLLBACK block
  → only if needed, the 0007 ROLLBACK block (the frontend keeps working via
  its fallbacks). Never roll back 0007 while 0008 or the new functions are
  live.

Payments: **do not enable a real payment provider yet** (no
`ISRAELI_GATEWAY_*` / `PAYPAL_*` secrets, no live webhook URL at a gateway).
`payments-webhook` still rewrites the whole order document and decides its
email from a stale read; before real payments it must be moved onto
`transition_order_data` (version compare-and-set) with event idempotency, or
a webhook racing an Admin "mark paid" can revert a change or send a second
payment email. Leave it on its current deployed version until then.

## Commerce hardening (0007)

Migration `supabase/migrations/0007_commerce_hardening.sql` is **not applied
automatically**. It closes three exposures from the commerce audit:

- **Supplier data in public product reads (A2-S2).** The storefront now reads
  the `products_public` view, which removes `data.supplier`
  (sku/reference/costUsd) and every availability `supplierNote`. `anon`
  loses the `data` column on raw `products` (it keeps
  `id, slug, status, category_slug, created_at`, so the sitemap still
  works); signed-in non-staff users lose raw `products` rows entirely.
  Staff keep full access through `products_staff_write`.
- **Raw order documents in account history (A2-S1).** `orders_own_read` is
  replaced by `orders_staff_read`. Customers get their history from the
  `my-orders` edge function, which sanitizes with the allowlist in
  `supabase/functions/_shared/customer-order.ts`.
- **Direct staff order PATCH (A2-S4).** `orders_staff_update` is dropped;
  `admin-actions` (service role, audited) is the only order write path.

It also adds `orders.idempotency_key` + `orders_idempotency_key_uidx` and the
service-role-only RPC `patch_order_data(...)` (atomic jsonb merge).

### Deploy order (staging first, then production)

Follow **"Production deployment sequence (commerce hardening)"** below; the
0007-specific part is:

1. Deploy ONLY the new `my-orders` function:
   `supabase functions deploy my-orders`.
2. Deploy the frontend. It reads `products_public` and calls `my-orders`,
   and falls back to the legacy reads (with a one-time console warning) while
   the view is missing, so it is safe to ship before step 3.
3. Apply `0007_commerce_hardening.sql` in the SQL editor on **staging**, run
   the checks below, then repeat on production.

Applying the migration before steps 1–2 would empty the catalog and account
history for clients still running the old frontend. Do NOT deploy the updated
`place-order` / `sheets-sync` / `admin-actions` / `track-order` before 0007
(and 0008) are applied: the new `place-order` writes
`orders.idempotency_key` and calls `patch_order_data`, and `sheets-sync` calls
`patch_order_data` — both exist only after 0007.

### Verification (staging, after applying)

```sql
-- published products visible through the view, none carrying supplier data
select count(*) from public.products_public;
select count(*) from public.products_public
 where data ? 'supplier' or data::text like '%supplierNote%';            -- 0
select has_column_privilege('anon', 'public.products', 'data', 'select'); -- false
select has_table_privilege('anon', 'public.products_public', 'update');   -- false
-- orders policies: only orders_staff_read (no own read, no staff update)
select polname, polcmd from pg_policy where polrelid = 'public.orders'::regclass;
select has_function_privilege('authenticated',
  'public.patch_order_data(text, jsonb, text, text)', 'execute');          -- false
select has_function_privilege('service_role',
  'public.patch_order_data(text, jsonb, text, text)', 'execute');          -- true
```

HTTP checks with the anon key / a customer JWT:

- `GET /rest/v1/products_public?select=id,data&limit=1` (anon) → 200, no
  `supplier` / `supplierNote` in the body.
- `GET /rest/v1/products?select=data` (anon) → 401/403 permission denied;
  `GET /rest/v1/products?select=slug` (anon) → 200 (sitemap).
- `GET /rest/v1/orders?select=data` with a customer JWT → `[]`.
- `PATCH /rest/v1/orders?order_number=eq.…` with a staff JWT → no row updated.
- `POST /rest/v1/rpc/patch_order_data` with anon or customer JWT → permission
  denied.
- `POST /functions/v1/my-orders` without a user JWT → 401; with a customer
  JWT → only that customer's orders, with no `internalNotes`,
  `supplierReference`, `trackingNumber`, `notification`, `customerEmails`
  or badge `supplierReference`.
- Storefront: catalog, product page, search and Account → Orders render; the
  browser console shows no fallback warning.
- Admin: Catalog list/edit and Orders list/update still work.

### Rollback

The migration header lists the exact statements (recreate
`products_public_read` for all roles, re-grant `select on products to anon`,
recreate `orders_own_read` and `orders_staff_update`, drop the view and the
function). The frontend keeps working after a rollback (it falls back to the
legacy reads), but the audit findings re-open. Keep `idempotency_key` unless
no deployed code writes it.
If 0008 is applied, roll it back FIRST (see "Order transition atomicity
(0008)" → Rollback): the 0008 functions are called by the current
`admin-actions` / `place-order`.

## Order transition atomicity (0008)

Migration `supabase/migrations/0008_order_transition_atomicity.sql` is **not
applied automatically**. It fixes a race in Admin order updates: N
near-simultaneous identical requests (a double-clicked "mark paid", two tabs,
two staff) all passed the lifecycle check on the same snapshot, so each sent
the "payment confirmed" email and the ledger hid the duplicates. It adds,
additively:

- `orders.version` (bigint, default 0), bumped by the BEFORE UPDATE trigger
  `orders_bump_version` on every update by any writer;
- `transition_order_data(order_number, expected_version, patch,
  payment_status, fulfillment_status)` — ONE conditional UPDATE
  (compare-and-set on `version`); exactly one concurrent caller gets
  `applied: true`;
- `record_order_customer_email(order_number, event, record)` — writes only
  `data.customerEmails.<event>`.

Both functions are SECURITY DEFINER with EXECUTE for `service_role` only.
`patch_order_data` (0007) is unchanged. The new `admin-actions` uses them so
only the winning request emails, audits and queues a Sheets row (the others
get `200 { ok: true, alreadyApplied: true }`, or `409 concurrent_update`
after 3 lost attempts); `resend-customer-email` claims a resend atomically
before sending; `place-order` records its ledger entry and owner-alert result
merge-only.

### Deploy order (staging first, then production)

Follow **"Production deployment sequence (commerce hardening)"** below; the
0008-specific part is:

1. Apply `0008_order_transition_atomicity.sql` in the SQL editor, AFTER
   0007 has been applied successfully. Run the checks below (staging first).
2. Only then deploy the commerce functions that depend on 0007 + 0008:
   `supabase functions deploy admin-actions place-order track-order sheets-sync`.
3. Repeat 1–2 on production.

0008 must exist before the new atomic Admin transition code
(`admin-actions`) is used. The migration is additive: the currently
deployed (old) functions keep working after step 1. Deploying the new functions BEFORE the migration
makes every Admin order update and resend fail (`admin-actions` returns 500).
`place-order` swallows the RPC error: the order is still placed, and only its
`order_received` ledger entry is lost.

### Verification (staging, after applying)

```sql
select count(*) from public.orders where version is null;                 -- 0
select tgenabled from pg_trigger
 where tgname = 'orders_bump_version' and tgrelid = 'public.orders'::regclass;  -- O
select has_function_privilege('authenticated',
  'public.transition_order_data(text, bigint, jsonb, text, text)', 'execute');  -- false
select has_function_privilege('anon',
  'public.record_order_customer_email(text, text, jsonb)', 'execute');          -- false
select has_function_privilege('service_role',
  'public.transition_order_data(text, bigint, jsonb, text, text)', 'execute');  -- true
```

Then in Admin, double-click "mark paid" on a test order: one
`payment_confirmed` timeline entry, one email, one `order_updated` audit row.

### Rollback

Redeploy the PREVIOUS `admin-actions` and `place-order` first (the new ones
call these functions), then run the ROLLBACK block from the migration header
(drop the two functions, the trigger and its function, then
`orders.version`). Rolling back re-opens the duplicate-email race.

## 7 · Backup & recovery

Supabase: enable PITR (paid) or schedule `pg_dump` via GitHub Action;
export `store_settings`/`products` JSON monthly (admin CSV export covers
orders). Frontend is stateless — redeploy from git. Secrets live in
Supabase/Vercel — document owners in your password manager.
