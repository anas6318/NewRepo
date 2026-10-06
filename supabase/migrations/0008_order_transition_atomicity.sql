-- ═══════════════════════════════════════════════════════════════════════════
-- 0008 — Order transition atomicity: compare-and-set order updates
--
-- PURPOSE
--   `patch_order_data` (0007) merges atomically, but it merges
--   UNCONDITIONALLY. admin-actions `update-order` reads the order, decides
--   the change (lifecycle checks, email decision, appended paymentHistory /
--   tracking arrays) from that snapshot, then merges. N near-simultaneous
--   identical requests ("mark paid" double-click, two tabs, two staff) all
--   pass the lifecycle check on the same snapshot and all "win": each sends
--   the customer email, each appends its own history entry onto a stale
--   array and the last whole-`customerEmails` write hides the others.
--   This migration adds the database half of compare-and-set:
--   1. `orders.version` — a row version bumped by a BEFORE UPDATE trigger on
--      EVERY update, whoever the writer is (patch_order_data, sheets-sync,
--      payments-webhook, place-order, the functions below). Callers cannot
--      set it: the trigger always writes old.version + 1.
--   2. `transition_order_data(...)` — ONE conditional UPDATE: the patch and
--      status columns land only if the row still has the version the caller
--      planned from. Exactly one of N concurrent callers with the same
--      expected version gets `applied: true`; the rest get `applied: false`
--      and the current version, re-read, and re-plan.
--   3. `record_order_customer_email(...)` — sets ONLY
--      `data.customerEmails.<event>` in one statement, so recording one
--      milestone's delivery never rewrites (or reverts) another's.
--   `patch_order_data` is NOT modified.
--
-- LOCAL / STAGING FIRST. NOT APPLIED AUTOMATICALLY to hosted projects:
--   apply by hand, staging first, verify, then production.
--
-- REQUIRED DEPLOY ORDER (see docs/deployment-guide.md "Order transition
-- atomicity (0008)")
--   1. Apply THIS migration (staging, verify, then production).
--   2. Then deploy the updated `admin-actions` and `place-order` edge
--      functions — they call transition_order_data /
--      record_order_customer_email. Without them admin-actions returns 500;
--      place-order swallows the RPC error and loses only the order_received
--      ledger entry (the order is still placed).
--   The migration is purely additive, so the currently deployed (old)
--   functions keep working unchanged after step 1: they never read
--   `version`, and the trigger only increments it.
--
-- Scope: one column, one trigger function + trigger, two functions, their
-- grants. Nothing here touches authentication, roles, profiles_role_guard,
-- prevent_role_escalation, RLS policies, or the data of any existing row
-- (existing rows get version 0). No table is truncated.
--
-- Safe to re-run: `if not exists` / `create or replace` /
-- `drop trigger if exists`; grants and revokes are idempotent.
--
-- ROLLBACK (manual, in one transaction; redeploy the PREVIOUS admin-actions
-- and place-order FIRST, because the new ones call these functions):
--   begin;
--   drop function if exists public.record_order_customer_email(text, text, jsonb);
--   drop function if exists public.transition_order_data(text, bigint, jsonb, text, text);
--   drop trigger if exists orders_bump_version on public.orders;
--   drop function if exists public.orders_bump_version();
--   alter table public.orders drop column if exists version;
--   commit;
--   Rolling back re-opens the concurrent "mark paid" duplicate-email race.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Row version ────────────────────────────────────────────────────────
alter table public.orders add column if not exists version bigint not null default 0;

comment on column public.orders.version is
  'Row version (0008). Bumped by trigger orders_bump_version on every UPDATE; compare-and-set token for transition_order_data.';

-- Every UPDATE, every writer: the new version is always old + 1, so a caller
-- can neither skip nor forge a version (an explicit `version = …` in an
-- UPDATE is overwritten here).
create or replace function public.orders_bump_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

comment on function public.orders_bump_version() is
  'BEFORE UPDATE trigger on public.orders: version := old.version + 1 (0008).';

revoke all on function public.orders_bump_version() from public;

drop trigger if exists orders_bump_version on public.orders;
create trigger orders_bump_version
  before update on public.orders
  for each row
  execute function public.orders_bump_version();

-- ── 2. Compare-and-set transition ─────────────────────────────────────────
-- ONE statement decides and writes: `… where order_number = $1 and
-- version = $2`. Under READ COMMITTED a second concurrent UPDATE waits for
-- the first's row lock, then re-checks its WHERE against the committed row
-- — whose version has moved — and matches nothing. No read-then-write.
-- Same merge semantics as patch_order_data: top-level keys of p_patch
-- replace the stored keys; status columns change only when passed.
-- Returns {applied: true, data, version} on success, otherwise
-- {applied: false, version} with the CURRENT version (null when no order
-- has that number) so the caller can re-read and re-plan.
-- SECURITY DEFINER + fixed search_path, EXECUTE service_role only: this
-- bypasses every business rule, which lives in the edge functions.
create or replace function public.transition_order_data(
  p_order_number text,
  p_expected_version bigint,
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
  v_version bigint;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'transition_order_data: p_patch must be a jsonb object'
      using errcode = '22023';
  end if;
  if p_expected_version is null then
    raise exception 'transition_order_data: p_expected_version is required'
      using errcode = '22023';
  end if;

  update public.orders o
     set data = coalesce(o.data, '{}'::jsonb) || p_patch,
         payment_status = coalesce(p_payment_status, o.payment_status),
         fulfillment_status = coalesce(p_fulfillment_status, o.fulfillment_status)
   where o.order_number = p_order_number
     and o.version = p_expected_version
  returning o.data, o.version into v_data, v_version;

  if found then
    return jsonb_build_object('applied', true, 'data', v_data, 'version', v_version);
  end if;

  -- Not applied: report the current version (informational only — nothing
  -- is written on this path).
  select o.version into v_version from public.orders o where o.order_number = p_order_number;
  return jsonb_build_object('applied', false, 'version', v_version);
end;
$$;

comment on function public.transition_order_data(text, bigint, jsonb, text, text) is
  'Compare-and-set order update (0008): merge p_patch + optional status columns only if orders.version = p_expected_version. service_role only.';

-- ── 3. Ledger write for one email milestone ───────────────────────────────
-- Sets data.customerEmails.<p_event> := p_record and nothing else, in one
-- UPDATE (row lock), so two writers recording different milestones — or a
-- status change racing a ledger write — never revert each other.
-- Returns the stored data, or NULL when no order has that number.
create or replace function public.record_order_customer_email(
  p_order_number text,
  p_event text,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'record_order_customer_email: p_record must be a jsonb object'
      using errcode = '22023';
  end if;
  if p_event is null or length(btrim(p_event)) = 0 then
    raise exception 'record_order_customer_email: p_event is required'
      using errcode = '22023';
  end if;

  update public.orders o
     set data = jsonb_set(
           coalesce(o.data, '{}'::jsonb),
           '{customerEmails}',
           (case when jsonb_typeof(o.data -> 'customerEmails') = 'object'
                 then o.data -> 'customerEmails'
                 else '{}'::jsonb end)
             || jsonb_build_object(p_event, p_record),
           true)
   where o.order_number = p_order_number
  returning o.data into v_data;

  return v_data;
end;
$$;

comment on function public.record_order_customer_email(text, text, jsonb) is
  'Atomic write of data.customerEmails.<event> only (0008). service_role only.';

-- ── 4. EXECUTE: service_role only ─────────────────────────────────────────
-- Functions are EXECUTE-able by PUBLIC by default and Supabase's default
-- privileges also grant anon/authenticated explicitly: revoke both.
revoke all on function public.transition_order_data(text, bigint, jsonb, text, text) from public;
revoke all on function public.record_order_customer_email(text, text, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.transition_order_data(text, bigint, jsonb, text, text) from anon;
    revoke all on function public.record_order_customer_email(text, text, jsonb) from anon;
    revoke all on function public.orders_bump_version() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.transition_order_data(text, bigint, jsonb, text, text) from authenticated;
    revoke all on function public.record_order_customer_email(text, text, jsonb) from authenticated;
    revoke all on function public.orders_bump_version() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.transition_order_data(text, bigint, jsonb, text, text) to service_role;
    grant execute on function public.record_order_customer_email(text, text, jsonb) to service_role;
  end if;
end $$;

commit;

-- ── Post-migration verification (staging) ─────────────────────────────────
--   select count(*) from public.orders where version is null;          -- 0
--   select tgenabled from pg_trigger
--    where tgname = 'orders_bump_version'
--      and tgrelid = 'public.orders'::regclass;                         -- 'O'
--   select has_function_privilege('authenticated',
--     'public.transition_order_data(text, bigint, jsonb, text, text)', 'execute');  -- false
--   select has_function_privilege('anon',
--     'public.record_order_customer_email(text, text, jsonb)', 'execute');          -- false
--   select has_function_privilege('service_role',
--     'public.transition_order_data(text, bigint, jsonb, text, text)', 'execute');  -- true
--   -- CAS smoke on a throwaway staging order (version v):
--   --   select public.transition_order_data('<order>', v, '{}'::jsonb);  -- applied true
--   --   select public.transition_order_data('<order>', v, '{}'::jsonb);  -- applied false
