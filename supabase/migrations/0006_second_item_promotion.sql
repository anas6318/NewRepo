-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 — Cart promotions (buy N, percentage off the cheaper item)
--
-- Adds a `promotions` table holding owner-managed CART-level campaigns, and
-- seeds the Buy-2 campaign in a DISABLED state. Nothing is discounted until
-- the owner enables it from Admin → Promotions.
--
-- Storage decision: a cart promotion is not a property of any one product,
-- so forcing it into `products.data` (where the product-level `sale` lives)
-- would create confusing semantics — "buy 2 get 15% off the second" is not
-- something a single product can express. A small dedicated table keeps the
-- two ideas separate, lets several campaigns exist, and leaves room for
-- future rules (buy 3, category rules, a fixed second-item amount) without
-- becoming a coupon engine: the rule is identified by `data->>'type'`, and
-- only `second_item_percentage` is implemented today.
--
-- Scope: one new table and its policies. Nothing here touches
-- authentication, roles, existing RLS policies, profiles_role_guard,
-- prevent_role_escalation, any other trigger, payment logic, products,
-- carts, or orders. No table is truncated and no existing row is modified.
--
-- Safe to re-run: `if not exists` throughout, and the seed row is an upsert
-- that never re-enables a campaign the owner has since turned on or off.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Campaign table ─────────────────────────────────────────────────────
-- Mirrors the shape of `patches`: a jsonb payload plus the few scalars worth
-- indexing. `enabled` is a column so a campaign can be switched off with a
-- single cheap predicate, and so RLS/reporting can read it without parsing
-- the payload.
create table if not exists public.promotions (
  id text primary key,
  enabled boolean not null default false,
  sort_order integer not null default 100,
  data jsonb not null
);

create index if not exists promotions_enabled_idx on public.promotions (sort_order) where enabled;

-- ── 2. Row-level security ─────────────────────────────────────────────────
-- Campaign labels are customer-facing, so the storefront must be able to
-- read campaigns to show the cart message. Writes are staff-only, using the
-- same `public.is_staff()` helper every other table already uses — no
-- existing policy is altered and no role check is weakened.
alter table public.promotions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'promotions' and policyname = 'promotions_public_read') then
    create policy promotions_public_read on public.promotions for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'promotions' and policyname = 'promotions_staff_write') then
    create policy promotions_staff_write on public.promotions for all
      using (public.is_staff()) with check (public.is_staff());
  end if;
end $$;

-- Table privileges. RLS decides which ROWS a caller sees; the grant decides
-- whether it may touch the table at all. Granting read explicitly (rather
-- than relying on the project's default privileges for new tables) keeps the
-- storefront working on any project. Writes are NOT granted to the public
-- roles — staff mutate through the admin-actions edge function, and the
-- staff_write policy above covers direct staff JWT access.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on public.promotions to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.promotions to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.promotions to service_role;
  end if;
end $$;

-- ── 3. The Buy-2 campaign, seeded DISABLED ────────────────────────────────
-- `on conflict do nothing` so re-running never resurrects a campaign the
-- owner has since edited, renamed, re-priced or switched on.
insert into public.promotions (id, enabled, sort_order, data) values (
  'second-item-15',
  false,
  10,
  jsonb_build_object(
    'id', 'second-item-15',
    'type', 'second_item_percentage',
    'enabled', false,
    'discountPercent', 15,
    'minimumQuantity', 2,
    'repeatPerPair', true,
    'stackWithProductSales', false,
    'sortOrder', 10,
    'label', jsonb_build_object(
      'ar', 'اشترِ قطعتين واحصل على خصم 15% على القطعة الثانية',
      'he', 'קנו 2 וקבלו 15% הנחה על הפריט השני',
      'en', 'Buy 2, get 15% off the second item'
    )
  )
)
on conflict (id) do nothing;

commit;

-- ── Post-migration owner checklist ────────────────────────────────────────
-- 1. The campaign is present but OFF. Nothing is discounted until you open
--    Admin → Promotions and enable it.
-- 2. Review the percentage, the qualifying quantity, whether it repeats per
--    pair, and which products or categories take part. With no products or
--    categories selected the whole catalog participates.
-- 3. "Allow stacking with product sales" is off: an item already reduced by
--    its own sale will not also receive this discount. Turn it on only if
--    you genuinely want both discounts on one item.
-- 4. Redeploy the place-order and admin-actions edge functions so order
--    creation validates and calculates the promotion server-side.
-- 5. The campaign starts and ends on its own schedule. No commit, push or
--    redeploy is needed at either boundary.
