/**
 * `npm run local:seed` — loads SYNTHETIC data into the LOCAL Supabase stack.
 * Idempotent: a second run leaves the same rows (the summary checksum proves
 * it). Refuses to run unless the local-staging guard accepts the stack.
 *
 *  1. Demo catalog from supabase/seed.sql, applied WITHOUT editing that file:
 *     every single-line `insert … ;` is rewritten in memory to
 *     `… on conflict do nothing;` (the generated file re-inserts size_charts
 *     rows that migration 0003 already created, which aborts a plain run).
 *  2. `it-` fixtures (scripts/local-staging/fixtures.mjs): products with every
 *     supplier/internal key populated by SUPPLIER-SENTINEL values, a badge, a
 *     shipping zone and a disabled promotion — upserted on their primary key.
 *  3. Auth users through the local Auth admin API (service role): customer A,
 *     customer B, content_manager, order_manager, admin, owner. Passwords
 *     are random (or reused from the previous run) and written ONLY to
 *     .claude/local-staging/users.json, which must be git-ignored.
 *
 * Nothing secret is printed: the summary has counts, ids, roles and a hash.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { guardLocal, REPO_ROOT } from "./guard.mjs";
import { dollarQuote, psql, psqlRows, psqlScalar, sqlText } from "./local-db.mjs";
import { badgeFixture, productFixtures, promotionFixture, USERS, USERS_FILE_REL, zoneFixture } from "./fixtures.mjs";

const stack = guardLocal(); // throws before any request if the stack is not provably local
const log = (...args) => console.log("[local:seed]", ...args);

/* ── 1. demo catalog (supabase/seed.sql, made idempotent in memory) ──────── */

function idempotentSeedSql(text) {
  let rewritten = 0;
  const lines = text.split(/\r?\n/).map((line) => {
    if (/^\s*insert\s+into\s+public\.\w+\s/i.test(line) && !/on\s+conflict/i.test(line)) {
      if (!/;\s*$/.test(line)) throw new Error("seed.sql: multi-line INSERT found — the in-memory rewrite only handles one statement per line");
      rewritten++;
      return line.replace(/;\s*$/, " on conflict do nothing;");
    }
    return line;
  });
  const out = lines.join("\n");
  // Every INSERT must now be conflict-safe, or a re-run would abort.
  const unsafe = out.split("\n").filter((l) => /^\s*insert\s+into/i.test(l) && !/on\s+conflict/i.test(l));
  if (unsafe.length) throw new Error(`seed.sql: ${unsafe.length} INSERT statement(s) left without ON CONFLICT`);
  return { sql: out, rewritten };
}

function applyDemoCatalog() {
  const raw = readFileSync(join(REPO_ROOT, "supabase", "seed.sql"), "utf8");
  const { sql, rewritten } = idempotentSeedSql(raw);
  psql(sql);
  log(`demo catalog: supabase/seed.sql applied (${rewritten} INSERTs made ON CONFLICT DO NOTHING in memory; file untouched)`);
}

/* ── 2. it- fixtures ─────────────────────────────────────────────────────── */

function applyFixtures() {
  const statements = [];
  for (const p of productFixtures()) {
    statements.push(
      `insert into public.products (id, slug, status, rights_status, category_slug, data) values (` +
        `${sqlText(p.id)}, ${sqlText(p.slug)}, ${sqlText(p.status)}, ${sqlText(p.rights_status)}, ${sqlText(p.category_slug)}, ${dollarQuote(JSON.stringify(p.data))}::jsonb) ` +
        `on conflict (id) do update set slug = excluded.slug, status = excluded.status, rights_status = excluded.rights_status, ` +
        `category_slug = excluded.category_slug, data = excluded.data;`,
    );
  }
  const b = badgeFixture();
  statements.push(
    `insert into public.patches (id, active, sort_order, supplier_ref, data) values (${sqlText(b.id)}, ${b.active}, ${b.sort_order}, ${sqlText(b.supplier_ref)}, ${dollarQuote(JSON.stringify(b.data))}::jsonb) ` +
      `on conflict (id) do update set active = excluded.active, sort_order = excluded.sort_order, supplier_ref = excluded.supplier_ref, data = excluded.data;`,
  );
  const z = zoneFixture();
  statements.push(
    `insert into public.shipping_zones (id, active, data) values (${sqlText(z.id)}, ${z.active}, ${dollarQuote(JSON.stringify(z.data))}::jsonb) ` +
      `on conflict (id) do update set active = excluded.active, data = excluded.data;`,
  );
  const pr = promotionFixture();
  statements.push(
    `insert into public.promotions (id, enabled, sort_order, data) values (${sqlText(pr.id)}, ${pr.enabled}, ${pr.sort_order}, ${dollarQuote(JSON.stringify(pr.data))}::jsonb) ` +
      `on conflict (id) do update set enabled = excluded.enabled, sort_order = excluded.sort_order, data = excluded.data;`,
  );
  psql(`begin;\n${statements.join("\n")}\ncommit;`);
  log(`it- fixtures upserted: ${productFixtures().length} products, 1 badge, 1 zone, 1 promotion (disabled)`);
}

/* ── 3. auth users ───────────────────────────────────────────────────────── */

const usersPath = join(REPO_ROOT, USERS_FILE_REL);

function assertGitIgnored(relPath) {
  const res = spawnSync("git", ["check-ignore", "-q", relPath], { cwd: REPO_ROOT, windowsHide: true });
  if (res.status !== 0) throw new Error(`${relPath} is not git-ignored — refusing to write credentials there`);
}

function previousPasswords() {
  if (!existsSync(usersPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(usersPath, "utf8"));
    const out = {};
    for (const [k, v] of Object.entries(parsed.users ?? {})) if (typeof v?.password === "string" && v.password.length >= 20) out[k] = v.password;
    return out;
  } catch {
    return {};
  }
}

async function authAdmin(path, init = {}) {
  const res = await fetch(`${stack.authUrl}/admin/${path}`, {
    ...init,
    headers: { apikey: stack.serviceRoleKey, Authorization: `Bearer ${stack.serviceRoleKey}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`auth admin ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Sets profiles.role. Tries the documented service-role path first; the
 * 0002 trigger `prevent_role_escalation` refuses any role change whose
 * caller is not an admin/owner (auth.uid() is NULL for the service role and
 * for SQL sessions), so the bootstrap falls back to a local superuser
 * statement with triggers suspended for that one transaction. */
async function setRoles(idsByRole) {
  const results = { rest: 0, sqlBootstrap: 0, restError: "" };
  for (const { id, role, name } of idsByRole) {
    const current = psqlScalar(`select role from public.profiles where id = ${sqlText(id)};`);
    if (current === role) continue;
    const res = await fetch(`${stack.restUrl}/profiles?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { apikey: stack.serviceRoleKey, Authorization: `Bearer ${stack.serviceRoleKey}`, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ role, name }),
    });
    if (res.ok) {
      results.rest++;
      continue;
    }
    results.restError = `${res.status} ${(await res.text()).slice(0, 160)}`;
    psql(
      `begin;\nset local session_replication_role = replica;\n` +
        `update public.profiles set role = ${sqlText(role)}, name = ${sqlText(name)} where id = ${sqlText(id)};\ncommit;`,
    );
    results.sqlBootstrap++;
  }
  return results;
}

async function applyUsers() {
  assertGitIgnored(USERS_FILE_REL);
  const prev = previousPasswords();
  const listed = await authAdmin("users?page=1&per_page=1000");
  const byEmail = new Map((listed?.users ?? []).map((u) => [String(u.email).toLowerCase(), u]));

  const out = {};
  const idsByRole = [];
  let created = 0;
  let updated = 0;
  for (const [key, spec] of Object.entries(USERS)) {
    const password = prev[key] ?? randomBytes(24).toString("base64url");
    const existing = byEmail.get(spec.email);
    let id;
    if (existing) {
      await authAdmin(`users/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ password, email_confirm: true, user_metadata: { name: spec.name } }),
      });
      id = existing.id;
      updated++;
    } else {
      const user = await authAdmin("users", {
        method: "POST",
        body: JSON.stringify({ email: spec.email, password, email_confirm: true, user_metadata: { name: spec.name } }),
      });
      id = user.id;
      created++;
    }
    out[key] = { id, email: spec.email, role: spec.role, password };
    idsByRole.push({ id, role: spec.role, name: spec.name });
  }

  const roles = await setRoles(idsByRole);
  mkdirSync(dirname(usersPath), { recursive: true });
  writeFileSync(usersPath, `${JSON.stringify({ note: "LOCAL-ONLY synthetic users for the crowned-local stack. Never commit.", users: out }, null, 2)}\n`, { mode: 0o600 });

  // Verify what the database now says (profiles row comes from the auth trigger).
  const rows = psqlRows(
    `select email || '=' || role from public.profiles where id in (${Object.values(out)
      .map((u) => sqlText(u.id))
      .join(",")}) order by email;`,
  );
  for (const [key, u] of Object.entries(out)) {
    if (!rows.includes(`${u.email}=${u.role}`)) throw new Error(`profile role for ${key} is not ${u.role}`);
  }
  log(`auth users: ${created} created, ${updated} updated (passwords ${Object.keys(prev).length ? "reused" : "generated"}; stored only in ${USERS_FILE_REL})`);
  log(`profiles.role: ${roles.rest} set via service-role REST, ${roles.sqlBootstrap} via local SQL bootstrap${roles.restError ? ` (service-role REST refused: ${roles.restError})` : ""}`);
  for (const r of rows) log(`  profile ${r}`);
}

/* ── summary: proves idempotence across runs ─────────────────────────────── */

function summary() {
  const counts = psqlRows(`
    select 'products=' || count(*) from public.products
    union all select 'products_published=' || count(*) from public.products where status not in ('draft','archived')
    union all select 'it_products=' || count(*) from public.products where id like 'it-%'
    union all select 'patches=' || count(*) from public.patches
    union all select 'shipping_zones=' || count(*) from public.shipping_zones
    union all select 'promotions=' || count(*) from public.promotions
    union all select 'promotions_enabled=' || count(*) from public.promotions where enabled or (data->>'enabled')::boolean
    union all select 'size_charts=' || count(*) from public.size_charts
    union all select 'categories=' || count(*) from public.categories
    union all select 'reviews=' || count(*) from public.reviews
    union all select 'store_settings=' || count(*) from public.store_settings
    union all select 'it_users=' || count(*) from auth.users where email like 'it-%@example.test';`);
  const digest = psqlScalar(`
    select md5(string_agg(x, '|' order by x)) from (
      select 'p:' || id || ':' || status || ':' || md5(data::text) as x from public.products
      union all select 'b:' || id || ':' || active || ':' || coalesce(supplier_ref,'') || ':' || md5(data::text) from public.patches
      union all select 'z:' || id || ':' || active || ':' || md5(data::text) from public.shipping_zones
      union all select 'pr:' || id || ':' || enabled || ':' || md5(data::text) from public.promotions
      union all select 'sc:' || id || ':' || md5(data::text) from public.size_charts
      union all select 'c:' || id || ':' || md5(data::text) from public.categories
      union all select 's:' || id || ':' || md5(data::text) from public.store_settings
      union all select 'u:' || u.id || ':' || u.email || ':' || p.role from auth.users u join public.profiles p on p.id = u.id where u.email like 'it-%@example.test'
    ) t;`);
  for (const c of counts) log(`  ${c}`);
  log(`state digest (catalog + it- users/roles): ${digest}`);
}

applyDemoCatalog();
applyFixtures();
await applyUsers();
summary();
log("done (LOCAL stack only; synthetic data only)");
