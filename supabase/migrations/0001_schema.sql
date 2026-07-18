-- CROWNED — core schema.
-- Pattern: scalar columns for anything filtered/indexed/secured + a `data`
-- jsonb column holding the full domain object (src/services/types.ts).
-- Run before 0002_rls.sql.

create extension if not exists pgcrypto;

-- ── profiles (mirrors auth.users; role drives authorization) ───────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  phone text,
  role text not null default 'customer'
    check (role in ('customer', 'owner', 'admin', 'order_manager', 'content_manager')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helper used by RLS policies. SECURITY DEFINER avoids recursive RLS.
create or replace function public.current_role()
returns text
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;

create or replace function public.is_staff()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select public.current_role() in ('owner', 'admin', 'order_manager', 'content_manager');
$$;

create or replace function public.is_admin_or_owner()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select public.current_role() in ('owner', 'admin');
$$;

-- ── catalog ────────────────────────────────────────────────────────────────
create table public.categories (
  id text primary key,
  data jsonb not null
);

create table public.products (
  id text primary key,
  slug text not null unique,
  status text not null default 'draft'
    check (status in ('available', 'made_to_order', 'unavailable', 'draft', 'archived')),
  rights_status text not null default 'pending_review'
    check (rights_status in ('pending_review', 'cleared', 'blocked')),
  category_slug text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  -- Products may not be published until rights are cleared (spec §30).
  constraint rights_gate check (
    status in ('draft', 'archived') or rights_status = 'cleared'
  )
);

create index products_status_idx on public.products (status);
create index products_category_idx on public.products (category_slug);

create table public.patches (
  id text primary key,
  active boolean not null default true,
  data jsonb not null
);

create table public.size_charts (
  id text primary key,
  data jsonb not null
);

-- ── commerce ───────────────────────────────────────────────────────────────
create table public.shipping_zones (
  id text primary key,
  active boolean not null default true,
  data jsonb not null
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid references public.profiles (id) on delete set null,
  contact_hash text not null,          -- sha256(secret + normalized email/phone)
  payment_status text not null default 'pending',
  fulfillment_status text not null default 'order_received',
  total_ils numeric(10, 2) not null check (total_ils >= 0),
  locale text not null default 'ar' check (locale in ('ar', 'he', 'en')),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index orders_customer_idx on public.orders (customer_id);
create index orders_payment_idx on public.orders (payment_status);
create index orders_fulfillment_idx on public.orders (fulfillment_status);

-- Payment events (webhook idempotency: unique provider event).
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  order_number text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- Google Sheets sync queue/log (Postgres remains source of truth — spec §24).
create table public.sheets_sync_log (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed', 'disabled')),
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

create index sheets_sync_pending_idx on public.sheets_sync_log (status) where status = 'pending';

-- ── engagement ─────────────────────────────────────────────────────────────
create table public.reviews (
  id text primary key,
  product_slug text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'hidden')),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index reviews_status_idx on public.reviews (status, product_slug);

create table public.wishlists (
  customer_id uuid not null references public.profiles (id) on delete cascade,
  product_slug text not null,
  created_at timestamptz not null default now(),
  primary key (customer_id, product_slug)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('email', 'whatsapp')),
  value text not null,
  consent boolean not null default false,
  consent_source text not null default '',
  created_at timestamptz not null default now()
);

create table public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- ── ops ────────────────────────────────────────────────────────────────────
create table public.store_settings (
  id text primary key default 'main',
  data jsonb not null
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text not null,
  detail text
);

-- Non-sequential public order numbers (unguessable, spec §16).
create or replace function public.generate_order_number()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text;
  i int;
begin
  loop
    result := 'CR-';
    for i in 1..6 loop
      result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from public.orders where order_number = result);
  end loop;
  return result;
end;
$$;
