-- CROWNED — Row Level Security. Deny-by-default: RLS is enabled on every
-- table; anything not explicitly granted is blocked. Edge functions using
-- the service-role key bypass RLS by design (they perform their own checks).

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.patches enable row level security;
alter table public.size_charts enable row level security;
alter table public.shipping_zones enable row level security;
alter table public.orders enable row level security;
alter table public.payment_events enable row level security;
alter table public.sheets_sync_log enable row level security;
alter table public.reviews enable row level security;
alter table public.wishlists enable row level security;
alter table public.leads enable row level security;
alter table public.issue_reports enable row level security;
alter table public.store_settings enable row level security;
alter table public.audit_log enable row level security;

-- profiles: users read/update themselves; staff read all; role changes are
-- service-role-only (no update policy grants role edits — the column is
-- guarded by the trigger below as defense in depth).
create policy profiles_self_read on public.profiles
  for select using (id = auth.uid() or public.is_staff());

create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin_or_owner() then
    raise exception 'role changes require admin/owner';
  end if;
  return new;
end;
$$;

create trigger profiles_role_guard
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- catalog: public reads (published products only for anon), staff writes.
create policy categories_public_read on public.categories for select using (true);
create policy categories_staff_write on public.categories for all
  using (public.is_staff()) with check (public.is_staff());

create policy products_public_read on public.products
  for select using (status not in ('draft', 'archived') or public.is_staff());

create policy products_staff_write on public.products for all
  using (public.is_staff()) with check (public.is_staff());

create policy patches_public_read on public.patches for select using (active or public.is_staff());
create policy patches_staff_write on public.patches for all
  using (public.is_staff()) with check (public.is_staff());

create policy size_charts_public_read on public.size_charts for select using (true);
create policy size_charts_staff_write on public.size_charts for all
  using (public.is_staff()) with check (public.is_staff());

create policy zones_public_read on public.shipping_zones for select using (active or public.is_staff());
create policy zones_staff_write on public.shipping_zones for all
  using (public.is_staff()) with check (public.is_staff());

-- orders: customers read their own; staff read/update all. INSERTS happen
-- only via the place-order edge function (service role) — no insert policy.
-- Guest tracking also goes through an edge function (contact-hash check),
-- never direct table reads.
create policy orders_own_read on public.orders
  for select using (customer_id = auth.uid() or public.is_staff());

create policy orders_staff_update on public.orders
  for update using (public.is_staff()) with check (public.is_staff());

-- payment events / sheets log / audit: staff read; writes via service role only.
create policy payment_events_staff_read on public.payment_events for select using (public.is_staff());
create policy sheets_log_staff_read on public.sheets_sync_log for select using (public.is_staff());
create policy audit_staff_read on public.audit_log for select using (public.is_admin_or_owner());

-- reviews: public sees approved; staff sees/moderates all; submission goes
-- through the submit-review edge function (rate-limited, validated).
create policy reviews_public_read on public.reviews
  for select using (status = 'approved' or public.is_staff());

create policy reviews_staff_write on public.reviews for update
  using (public.is_staff()) with check (public.is_staff());

-- wishlists: strictly own rows.
create policy wishlists_own on public.wishlists for all
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());

-- leads: anonymous inserts allowed (signup forms); reads staff-only.
create policy leads_insert on public.leads for insert with check (true);
create policy leads_staff_read on public.leads for select using (public.is_staff());

-- issue reports: anonymous inserts (problem form); staff read/update.
create policy issues_insert on public.issue_reports for insert with check (true);
create policy issues_staff_read on public.issue_reports for select using (public.is_staff());
create policy issues_staff_update on public.issue_reports for update
  using (public.is_staff()) with check (public.is_staff());

-- settings: public read (storefront needs texts/payment labels — the data
-- object contains no secrets by design); admin/owner writes via edge fn.
create policy settings_public_read on public.store_settings for select using (true);
