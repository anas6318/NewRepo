-- ═══════════════════════════════════════════════════════════════════════════
-- bootstrap-first-owner.sql — make the FIRST owner account (one-time)
--
-- WHY THIS IS NEEDED
--   Roles live in public.profiles.role. The 0002 trigger `profiles_role_guard`
--   (function prevent_role_escalation) refuses every role change unless the
--   caller is already an admin/owner. On a new project nobody is, and an
--   SQL-editor / service-role session has no auth.uid(), so a bare
--   `update profiles set role = 'owner' …` is refused too. This script is the
--   one sanctioned bypass: inside ONE transaction it briefly disables that
--   trigger, promotes exactly one existing profile, re-enables the trigger
--   and verifies it is enabled again before committing.
--
-- WHO CAN RUN IT
--   Only the owner of public.profiles — the `postgres` role (the Supabase SQL
--   editor runs as postgres). `alter table … disable trigger` is refused for
--   anyone else, so the anon / authenticated / service_role API roles cannot
--   use it.
--
-- ONE-TIME
--   It refuses (and changes nothing) if ANY profile already has role 'owner'.
--   After the first owner exists, all further role changes go through Admin
--   (owner/admin), where the trigger enforces the rules.
--
-- SAFETY
--   * Refuses unless exactly one profile matches the email (case-insensitive).
--   * Takes a lock on public.profiles first, so two concurrent runs cannot
--     both see "no owner yet".
--   * `alter table … disable/enable trigger` is transactional: on ANY error
--     the whole transaction rolls back and the trigger is enabled exactly as
--     before. The trigger definition and prevent_role_escalation are never
--     modified.
--
-- HOW TO RUN
--   1. Register the account on the storefront first (this creates its
--      profile row with role 'customer').
--   2. Edit the ONE placeholder  REPLACE_WITH_OWNER_EMAIL  (in the set_config
--      line below) to the account's address, keeping the quotes, e.g.
--      'you@yourdomain.tld'. Then either paste the whole file into Supabase
--      Dashboard → SQL editor and Run, or run it as postgres with psql:
--         psql "<connection string>" -v ON_ERROR_STOP=1 -f docs/sql/bootstrap-first-owner.sql
--      An unedited file refuses (the placeholder has no '@') and changes nothing.
--   3. Expect the final SELECT to show the profile with role = owner and
--      profiles_role_guard tgenabled = 'O'. Sign out and in again.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- The address to promote: replace the placeholder text between the quotes.
select set_config('crowned.bootstrap_owner_email', 'REPLACE_WITH_OWNER_EMAIL', true);

do $$
declare
  v_email text := lower(btrim(coalesce(current_setting('crowned.bootstrap_owner_email', true), '')));
  v_matches integer;
  v_owners integer;
  v_updated integer;
  v_enabled "char";
begin
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'bootstrap-first-owner: no valid owner email given (edit REPLACE_WITH_OWNER_EMAIL)';
  end if;

  -- Serialize against a concurrent run / role change before deciding.
  lock table public.profiles in share row exclusive mode;

  select count(*) into v_owners from public.profiles where role = 'owner';
  if v_owners > 0 then
    raise exception 'bootstrap-first-owner: an owner already exists (% profile(s)) — refusing; use Admin to manage roles', v_owners;
  end if;

  select count(*) into v_matches from public.profiles where lower(btrim(email)) = v_email;
  if v_matches <> 1 then
    raise exception 'bootstrap-first-owner: expected exactly one profile for that email, found % — register the account first', v_matches;
  end if;

  alter table public.profiles disable trigger profiles_role_guard;

  update public.profiles set role = 'owner' where lower(btrim(email)) = v_email;
  get diagnostics v_updated = row_count;

  alter table public.profiles enable trigger profiles_role_guard;

  if v_updated <> 1 then
    raise exception 'bootstrap-first-owner: updated % rows, expected 1 — rolled back', v_updated;
  end if;

  -- The guard must be enabled again ('O' = enabled, origin/local) before commit.
  select t.tgenabled into v_enabled
    from pg_trigger t
   where t.tgname = 'profiles_role_guard'
     and t.tgrelid = 'public.profiles'::regclass;
  if v_enabled is distinct from 'O' then
    raise exception 'bootstrap-first-owner: profiles_role_guard is not enabled (tgenabled=%) — rolled back', coalesce(v_enabled::text, 'missing');
  end if;
end
$$;

commit;

-- Verification (read-only).
select p.email, p.role,
       (select t.tgenabled from pg_trigger t
         where t.tgname = 'profiles_role_guard'
           and t.tgrelid = 'public.profiles'::regclass) as profiles_role_guard_tgenabled
  from public.profiles p
 where p.role = 'owner';
