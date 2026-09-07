-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 — Configurable product sales
--
-- Adds owner-managed sale configuration to products. The regular price
-- (`data->>'basePriceIls'`) is NEVER touched by this migration or by any sale:
-- a sale is configuration layered on top, and ending it restores the regular
-- price with no further action.
--
-- Storage decision: the sale lives in the existing `products.data` jsonb
-- rather than a separate promotions table. Reasons: pricing is always
-- computed from a product row that is already being read (storefront and
-- place-order both fetch it), so this adds no join to the hot path; it stays
-- atomic with the product it belongs to; and it matches how availability and
-- badge settings are already stored. The resolver in src/lib/sales.ts takes a
-- SaleConfig value rather than a Product, so a future category-wide or
-- store-wide promotion can produce the same shape and be resolved by the same
-- code without rewriting product pricing.
--
-- Scope: products.data only, plus one reporting index and one settings field.
-- Nothing here touches authentication, roles, RLS policies,
-- profiles_role_guard, prevent_role_escalation, any other trigger, payment
-- logic, orders, or the owner account. No table is truncated, no product is
-- deleted, and no placed order's stored price is modified.
--
-- Safe to re-run: every statement is `if not exists` or a targeted UPDATE
-- guarded so it only fills values that are still missing.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Every existing product defaults to no sale ─────────────────────────
-- Explicitly disabled rather than absent, so the state is unambiguous in the
-- database and in Admin. Products that already carry a sale are left alone.
update public.products
set data = data || jsonb_build_object('sale', jsonb_build_object('enabled', false, 'type', 'none'))
where data->'sale' is null;

-- ── 2. Disable any stored sale that could not be applied safely ───────────
-- Mirrors the validation in src/lib/sales.ts. A configuration that would be
-- rejected at runtime is turned off here too, so Admin shows the truth rather
-- than an "active" sale the storefront silently ignores. The regular price is
-- untouched in every branch.
update public.products
set data = jsonb_set(data, '{sale,enabled}', 'false'::jsonb)
where coalesce((data->'sale'->>'enabled')::boolean, false)
  and (
       -- percentage outside 0 < p ≤ 100
       (data->'sale'->>'type' = 'percentage'
         and (data->'sale'->>'percentOff' is null
              or (data->'sale'->>'percentOff')::numeric <= 0
              or (data->'sale'->>'percentOff')::numeric > 100))
       -- fixed amount not below the base price
    or (data->'sale'->>'type' = 'fixed_amount'
         and (data->'sale'->>'amountOffIls' is null
              or (data->'sale'->>'amountOffIls')::numeric <= 0
              or (data->'sale'->>'amountOffIls')::numeric > (data->>'basePriceIls')::numeric))
       -- sale price at or above the regular price, or negative
    or (data->'sale'->>'type' = 'fixed_price'
         and (data->'sale'->>'salePriceIls' is null
              or (data->'sale'->>'salePriceIls')::numeric < 0
              or (data->'sale'->>'salePriceIls')::numeric >= (data->>'basePriceIls')::numeric))
       -- an end that is not after the start
    or (data->'sale'->>'startsAt' is not null
         and data->'sale'->>'endsAt' is not null
         and (data->'sale'->>'endsAt')::timestamptz <= (data->'sale'->>'startsAt')::timestamptz)
  );

-- ── 3. Reporting index ────────────────────────────────────────────────────
-- Lets the owner list products with a sale switched on without scanning the
-- whole catalog. Sale *activity* still depends on the clock and is resolved
-- in application code, so it is deliberately not indexed as a boolean.
create index if not exists products_sale_enabled_idx
  on public.products ((data->'sale'->>'enabled'))
  where data->'sale'->>'enabled' = 'true';

-- ── 4. Store timezone for entering schedules ──────────────────────────────
-- Timestamps themselves are always stored in UTC. This only tells Admin which
-- wall clock to show and interpret. Existing settings are otherwise untouched.
update public.store_settings
set data = data || jsonb_build_object('timezone', 'Asia/Jerusalem')
where id = 'main' and data->'timezone' is null;

commit;

-- ── Post-migration owner checklist ────────────────────────────────────────
-- 1. Confirm the store timezone under Admin → Settings if it is not
--    Asia/Jerusalem.
-- 2. Sales are per product: open a product and use its Sale section. Nothing
--    is discounted until you switch one on — this migration starts every
--    product at "no sale".
-- 3. Redeploy the place-order edge function so order creation validates and
--    calculates the sale server-side.
-- 4. A sale starts and ends on its own schedule. No commit, push or redeploy
--    is needed at either boundary.
