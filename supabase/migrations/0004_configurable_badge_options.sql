-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 — Configurable badge / patch options
--
-- Replaces the single generic patch option (and the ₪5 adjustment that lived
-- in application code) with an owner-managed catalog. After this migration
-- the ₪5 legacy price still exists — but as DATA on the migrated rows, not
-- as a constant anywhere in the application.
--
-- 0003 is dedicated to sizing and supplier availability, so this is a
-- separate migration rather than an edit to it.
--
-- Scope: the existing public.patches table and the `badges` settings inside
-- products.data. Nothing here touches authentication, roles, RLS policies,
-- profiles_role_guard, prevent_role_escalation, any other trigger, payment
-- logic, orders, or the owner account. No table is truncated, no existing
-- product or order row is deleted, and no order's stored price is changed.
--
-- Safe to re-run: every statement is `if not exists`, an upsert, or a
-- targeted UPDATE guarded so it only fills values that are still missing.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Catalog columns ────────────────────────────────────────────────────
-- `patches` already exists with (id, active, data jsonb) and already has RLS
-- enabled with public-read-when-active + staff-write policies from 0002.
-- Those policies are reused unchanged; only columns are added.
--
-- `supplier_ref` is deliberately a COLUMN rather than a field inside `data`,
-- so it can be withheld from the public roles at the database level (step 5).
alter table public.patches add column if not exists sort_order integer;
alter table public.patches add column if not exists supplier_ref text;

-- ── 2. Carry the existing options forward ─────────────────────────────────
-- Every current patch row keeps its own stored price (the legacy ₪5 rows stay
-- ₪5) and gains the fields the configurable model needs. Existing names are
-- untouched. `code` defaults to the row id so imports have something stable
-- to reference; the owner can rename it in Admin afterwards.
with ordered as (
  select id, (row_number() over (order by id)) * 10 as position
  from public.patches
)
update public.patches p
set
  data = p.data
    || jsonb_build_object(
         'id', p.id,
         'code', coalesce(nullif(p.data->>'code', ''), p.id),
         'active', coalesce((p.data->>'active')::boolean, p.active),
         'sortOrder', coalesce((p.data->>'sortOrder')::int, p.sort_order, o.position::int),
         -- priceIls is preserved exactly as stored; 0 only if it was absent.
         'priceIls', coalesce((p.data->>'priceIls')::numeric, 0)
       )
from ordered o
where o.id = p.id
  and (p.data->>'code' is null
    or p.data->>'sortOrder' is null
    or p.data->>'id' is null);

-- Mirror the jsonb sort order into the indexed column for ordered reads.
update public.patches
set sort_order = coalesce((data->>'sortOrder')::int, 100)
where sort_order is distinct from coalesce((data->>'sortOrder')::int, 100);

create index if not exists patches_sort_order_idx on public.patches (sort_order);

-- ── 3. Product-level enablement ───────────────────────────────────────────
-- Products currently express supported options as `patchIds`. Convert each
-- one into an equivalent enabled badge setting at the inherited global price
-- (no override), so customer-visible behaviour is identical the moment this
-- migration lands. `patchIds` is left in place as a fallback for anything
-- not yet redeployed; the application prefers `badges` when present.
update public.products
set data = data || jsonb_build_object(
  'badges',
  coalesce(
    (
      select jsonb_agg(jsonb_build_object('badgeId', pid, 'enabled', true))
      from jsonb_array_elements_text(coalesce(data->'patchIds', '[]'::jsonb)) as t(pid)
      -- Only options that actually exist in the catalog are carried over.
      where exists (select 1 from public.patches p where p.id = pid)
    ),
    '[]'::jsonb
  )
)
where data->'badges' is null;

-- "No badge" stays available unless the owner deliberately turns it off.
update public.products
set data = data || jsonb_build_object('allowNoBadge', true)
where data->'allowNoBadge' is null;

-- ── 4. Guard against invalid stored prices ────────────────────────────────
-- A negative adjustment must never be selectable. This only rewrites rows
-- that are already invalid; valid prices (including ₪5 and ₪0) are untouched.
update public.patches
set
  active = false,
  data = data || jsonb_build_object('active', false)
where (data->>'priceIls')::numeric < 0;

-- ── 5. Keep the supplier reference out of public reads ────────────────────
-- RLS is row-level; column privileges are what withhold a single column.
-- The public roles keep exactly the access they had before (id, active,
-- data, plus the new sort_order) and gain no access to supplier_ref. This
-- tightens the surface — no existing policy is dropped, altered or weakened.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke select on public.patches from anon;
    grant select (id, active, sort_order, data) on public.patches to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke select on public.patches from authenticated;
    grant select (id, active, sort_order, data) on public.patches to authenticated;
  end if;
end $$;

commit;

-- ── Post-migration owner checklist ────────────────────────────────────────
-- 1. Open Admin → Badge / patch options and give each migrated option a
--    meaningful internal code and, where useful, a description and icon.
-- 2. Add the competition badges you actually offer (Champions League, Club
--    World Cup, national-team tournaments) with their real prices.
-- 3. Review each product's Badge / patch options section: enable only the
--    options that shirt genuinely supports, and set a price override where
--    that shirt's badge costs you something different.
-- 4. Redeploy the place-order, admin-actions and track-order edge functions
--    so the server-side pricing and sanitization match this schema.
