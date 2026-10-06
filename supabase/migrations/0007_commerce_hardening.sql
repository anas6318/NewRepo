-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 — Commerce hardening: storefront/customer data exposure + order writes
--
-- PURPOSE
--   A2 audit findings A2-S1, A2-S2, A2-S4 and the groundwork for A2-B6 / A2-S3:
--   1. `products_public` view: the storefront reads products through a view
--      that removes supplier/internal fields server-side. Previously anon
--      read raw `products.data` (supplier sku/reference/costUsd and every
--      availability `supplierNote`) and only the browser stripped them.
--   2. Customers no longer read raw `orders.data` over PostgREST. Account
--      history is served by the `my-orders` edge function, which sanitizes
--      with supabase/functions/_shared/customer-order.ts on the server.
--   3. `orders.idempotency_key` + partial unique index (checkout retries).
--   4. `patch_order_data(...)`: one atomic, server-side jsonb merge for order
--      updates, replacing whole-document read-modify-write (A2-B6).
--   5. Staff can no longer PATCH `orders` directly via PostgREST; the
--      admin-actions edge function (service role, audited) is the only
--      order write path.
--
-- NOT APPLIED AUTOMATICALLY. Apply by hand, staging first.
--
-- REQUIRED DEPLOY ORDER (see docs/deployment-guide.md "Commerce hardening (0007)")
--   1. Deploy the `my-orders` edge function and the updated shared sanitizer
--      (place-order, track-order, admin-actions redeploy).
--   2. Deploy the frontend. It reads `products_public` and calls `my-orders`,
--      and falls back to the legacy reads while this migration is missing,
--      so steps 1–2 are safe before step 3.
--   3. Apply this migration (staging, verify, then production).
--   Applying the migration BEFORE the new frontend/function is live would
--   empty the storefront catalog and account history for old clients.
--
-- Scope: products/orders policies and grants, one view, one column, one
-- index, one function. Nothing here touches authentication, roles,
-- profiles_role_guard, prevent_role_escalation, payment logic, or the data
-- of any existing row. No table is truncated and no row is modified.
--
-- Safe to re-run: `if exists` / `if not exists` / `create or replace`
-- throughout; grants and revokes are idempotent.
--
-- ROLLBACK (manual, in one transaction):
--   drop view if exists public.products_public;
--   drop policy if exists products_public_read on public.products;
--   create policy products_public_read on public.products
--     for select using (status not in ('draft', 'archived') or public.is_staff());
--   grant select on public.products to anon;
--   drop policy if exists orders_staff_read on public.orders;
--   create policy orders_own_read on public.orders
--     for select using (customer_id = auth.uid() or public.is_staff());
--   create policy orders_staff_update on public.orders
--     for update using (public.is_staff()) with check (public.is_staff());
--   drop function if exists public.patch_order_data(text, jsonb, text, text);
--   -- Keep idempotency_key/its index unless no deployed code writes it:
--   -- drop index if exists public.orders_idempotency_key_uidx;
--   -- alter table public.orders drop column if exists idempotency_key;
--   Rolling back re-opens A2-S1/S2/S4; the frontend keeps working either way.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Products: raw rows are staff-only; the storefront reads a view ─────
-- Supplier-only / internal keys removed from `products.data` by the view
-- (src/services/types.ts Product + AvailabilityRecord, and the client-side
-- stripper src/services/sizing.ts toPublicProduct):
--   • data.supplier                         { sku, reference, costUsd }
--   • data.availability.supplierNote
--   • data.versionAvailability.<v>.supplierNote
--   • data.sizeAvailability.<key>.supplierNote
--   • defensively, top-level supplierNote / supplierReference / internalNotes
--     (not in the Product type today; removed so a stray admin write cannot
--     leak them).
-- Availability records are rebuilt from an ALLOWLIST (status, lastCheckedAt
-- when non-empty) exactly like toPublicProduct, so any future internal key
-- inside a record is dropped by default.
--
-- View semantics: this is deliberately NOT `security_invoker` (the Postgres
-- 15 default, security_invoker = false, is kept). The view runs with its
-- owner's rights; the owner (the migration role) owns `products`, so the
-- view reads rows regardless of RLS, which is required because the anon
-- policy below no longer exposes `data`. The view therefore re-applies the
-- publication predicate itself (status not in draft/archived) — the same
-- predicate the old public policy used for non-staff. `security_barrier`
-- stops caller-supplied filters/functions from being evaluated before that
-- predicate, so draft/archived rows cannot be probed through the view.
create or replace view public.products_public
with (security_barrier = true)
as
select
  p.id,
  p.slug,
  p.status,
  p.category_slug,
  (p.data - array['supplier', 'supplierNote', 'supplierReference', 'internalNotes',
                  'availability', 'versionAvailability', 'sizeAvailability'])
  || case
       when jsonb_typeof(p.data -> 'availability') = 'object' then jsonb_build_object(
         'availability',
         jsonb_strip_nulls(jsonb_build_object(
           'status', p.data -> 'availability' -> 'status',
           'lastCheckedAt', to_jsonb(nullif(p.data -> 'availability' ->> 'lastCheckedAt', ''))
         )))
       else '{}'::jsonb
     end
  || case
       when jsonb_typeof(p.data -> 'versionAvailability') = 'object' then jsonb_build_object(
         'versionAvailability',
         (select coalesce(jsonb_object_agg(va.key, jsonb_strip_nulls(jsonb_build_object(
                    'status', va.value -> 'status',
                    'lastCheckedAt', to_jsonb(nullif(va.value ->> 'lastCheckedAt', ''))
                  ))), '{}'::jsonb)
            from jsonb_each(p.data -> 'versionAvailability') as va))
       else '{}'::jsonb
     end
  || case
       when jsonb_typeof(p.data -> 'sizeAvailability') = 'object' then jsonb_build_object(
         'sizeAvailability',
         (select coalesce(jsonb_object_agg(sa.key, jsonb_strip_nulls(jsonb_build_object(
                    'status', sa.value -> 'status',
                    'lastCheckedAt', to_jsonb(nullif(sa.value ->> 'lastCheckedAt', ''))
                  ))), '{}'::jsonb)
            from jsonb_each(p.data -> 'sizeAvailability') as sa))
       else '{}'::jsonb
     end
  as data
from public.products p
where p.status not in ('draft', 'archived');

comment on view public.products_public is
  'Storefront-safe product rows (0007). Supplier/internal keys removed; published rows only. Owner-rights view — see migration 0007 §1.';

-- Supabase's default privileges grant ALL on new relations in `public` to
-- anon/authenticated. A single-table view is auto-updatable, and with owner
-- rights an UPDATE/DELETE through it would bypass the products RLS. So
-- revoke everything first, then grant read only.
revoke all on public.products_public from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.products_public from anon;
    grant select on public.products_public to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.products_public from authenticated;
    grant select on public.products_public to authenticated;
  end if;
end $$;

-- Raw table, non-staff: the old policy let anon and every signed-in
-- customer read full `data`. Replace it with an anon-only row policy and
-- withhold the `data` column from anon with column privileges (precedent:
-- 0004 `patches.supplier_ref`). anon keeps only the scalar columns, so the
-- build-time sitemap (`products?select=slug`) keeps working, but
-- `select=data` / `select=*` is refused (42501).
-- Signed-in customers share the `authenticated` role with staff, so a column
-- revoke there would break Admin; instead no row policy is granted to
-- non-staff authenticated users at all. Staff keep full read (and write)
-- through the unchanged `products_staff_write` policy (FOR ALL using
-- is_staff()), which Admin → Catalog relies on. Service role bypasses RLS.
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon
  using (status not in ('draft', 'archived'));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke select on public.products from anon;
    grant select (id, slug, status, category_slug, created_at) on public.products to anon;
  end if;
end $$;

-- ── 2. Orders: customers no longer read raw order documents (A2-S1) ───────
-- RLS is row-level and cannot hide keys inside `data`; a column revoke on
-- `data` would also blind staff (same `authenticated` role). So the
-- customer arm of the read policy is removed entirely: customers get their
-- history from the `my-orders` edge function, which reads with the service
-- role (by the caller's verified user id) and returns only the allowlisted
-- customer view (_shared/customer-order.ts). Staff read is unchanged.
drop policy if exists orders_own_read on public.orders;
drop policy if exists orders_staff_read on public.orders;
create policy orders_staff_read on public.orders
  for select using (public.is_staff());

-- ── 3. Staff cannot PATCH orders directly (A2-S4) ─────────────────────────
-- `orders_staff_update` let any staff role (incl. content_manager) rewrite
-- any order key over PostgREST, skipping admin-actions' role gates,
-- lifecycle checks and audit log. Nothing in the app writes orders over
-- PostgREST (Admin uses admin-actions?action=update-order). With no UPDATE
-- policy, RLS denies every non-service-role UPDATE; the service role used
-- by the edge functions bypasses RLS and remains the only write path.
drop policy if exists orders_staff_update on public.orders;

-- ── 4. Checkout idempotency key ───────────────────────────────────────────
-- Written by place-order (see _shared/order-idempotency.ts). NULL for legacy
-- orders and for requests without a key, which the partial index ignores.
alter table public.orders add column if not exists idempotency_key text;
create unique index if not exists orders_idempotency_key_uidx
  on public.orders (idempotency_key) where idempotency_key is not null;

-- ── 5. Atomic order patch ─────────────────────────────────────────────────
-- `data = data || p_patch` merges TOP-LEVEL keys in one UPDATE, so two
-- writers touching different keys (a sheets drain and an Admin status
-- change) can no longer overwrite each other with stale copies (A2-B6).
-- Nested objects in p_patch replace the stored value for that key.
-- Status columns change only when a value is passed (coalesce).
-- Returns the new `data`, or NULL when no order has that number.
--
-- SECURITY DEFINER so it runs with the owner's rights regardless of the
-- (now absent) UPDATE policy; `search_path = public` and schema-qualified
-- names so a caller cannot shadow objects. EXECUTE is service_role only:
-- this bypasses every business rule, which lives in the edge functions.
create or replace function public.patch_order_data(
  p_order_number text,
  p_patch jsonb,
  p_payment_status text default null,
  p_fulfillment_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch_order_data: p_patch must be a jsonb object'
      using errcode = '22023';
  end if;

  -- A single UPDATE takes the row lock, so concurrent patches serialize and
  -- each merges onto the other's committed result.
  update public.orders o
     set data = o.data || p_patch,
         payment_status = coalesce(p_payment_status, o.payment_status),
         fulfillment_status = coalesce(p_fulfillment_status, o.fulfillment_status)
   where o.order_number = p_order_number
  returning o.data into v_data;

  return v_data;
end;
$$;

comment on function public.patch_order_data(text, jsonb, text, text) is
  'Atomic top-level jsonb merge into orders.data plus optional status columns (0007). service_role only.';

-- Functions are EXECUTE-able by PUBLIC by default, and Supabase's default
-- privileges also grant EXECUTE to anon/authenticated explicitly; revoke
-- both, then grant to service_role only.
revoke all on function public.patch_order_data(text, jsonb, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.patch_order_data(text, jsonb, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.patch_order_data(text, jsonb, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.patch_order_data(text, jsonb, text, text) to service_role;
  end if;
end $$;

commit;

-- ── Post-migration verification (staging) ─────────────────────────────────
-- See docs/deployment-guide.md "Commerce hardening (0007)" for the full list.
--   select count(*) from public.products_public;            -- = published count
--   select count(*) from public.products_public
--    where data ? 'supplier' or data::text like '%supplierNote%';  -- = 0
--   select has_column_privilege('anon', 'public.products', 'data', 'select'); -- false
--   select has_function_privilege('authenticated',
--     'public.patch_order_data(text, jsonb, text, text)', 'execute');         -- false
--   select polname from pg_policy where polrelid = 'public.orders'::regclass;
--     -- orders_staff_read only (no orders_own_read, no orders_staff_update)
