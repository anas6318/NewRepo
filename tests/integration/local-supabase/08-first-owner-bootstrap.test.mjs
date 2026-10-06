/**
 * First-owner bootstrap: runs the ACTUAL docs/sql/bootstrap-first-owner.sql
 * as `postgres` in the LOCAL database (psql inside the db container, the
 * placeholder replaced in-process, the file on stdin).
 *
 * Isolation: the seed already has an owner (it-owner@example.test), and the
 * script refuses whenever one exists. `before` therefore records every
 * current owner and demotes them to `admin` (local superuser session with
 * session_replication_role = replica — the seed's own bootstrap path); the
 * promoted throwaway user is deleted and every recorded owner is restored in
 * `after`, so later test files see exactly the seeded roles again.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { guardLocal, REPO_ROOT } from "../../../scripts/local-staging/guard.mjs";
import { DB_CONTAINER, psql, psqlRows, psqlScalar } from "../../../scripts/local-staging/local-db.mjs";
import { client, sqlText, uniqueTag } from "./helpers.mjs";

// Guard FIRST: refuses (throws) before any request unless the stack is provably local.
const stack = guardLocal();
const c = client(stack);

const SCRIPT = readFileSync(join(REPO_ROOT, "docs", "sql", "bootstrap-first-owner.sql"), "utf8");

const PLACEHOLDER = "REPLACE_WITH_OWNER_EMAIL";

/** Runs the bootstrap file as documented: edit the placeholder (in-process string replace), then run it. */
function runBootstrap(email) {
  assert.ok(SCRIPT.includes(`'${PLACEHOLDER}'`), "the file must contain the quoted placeholder");
  const sql = email === undefined ? SCRIPT : SCRIPT.replace(`'${PLACEHOLDER}'`, () => sqlText(email));
  const args = ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"];
  const r = spawnSync("docker", args, { input: sql, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const triggerEnabled = () => psqlScalar("select tgenabled from pg_trigger where tgname = 'profiles_role_guard' and tgrelid = 'public.profiles'::regclass;");
const roleOf = (id) => psqlScalar(`select role from public.profiles where id = ${sqlText(id)};`);
const ownerIds = () => psqlRows("select id from public.profiles where role = 'owner' order by id;");
const profilesDigest = () => psqlScalar("select md5(string_agg(id::text || ':' || role, ',' order by id)) from public.profiles;");

/** Superuser role write that bypasses the guard trigger for test setup only. */
function setRoleAsSuperuser(ids, role) {
  if (!ids.length) return;
  psql(`begin;\nset local session_replication_role = replica;\nupdate public.profiles set role = ${sqlText(role)} where id in (${ids.map(sqlText).join(", ")});\ncommit;`);
}

async function authAdmin(path, init = {}) {
  const res = await fetch(`${stack.authUrl}/admin/${path}`, {
    ...init,
    headers: { apikey: stack.serviceRoleKey, Authorization: `Bearer ${stack.serviceRoleKey}`, "content-type": "application/json" },
  });
  const text = await res.text();
  assert.ok(res.ok, `auth admin ${init.method ?? "GET"} ${path.split("?")[0]}: HTTP ${res.status}`);
  return text ? JSON.parse(text) : null;
}

let seededOwners = [];
let candidate; // { id, email, password }

before(async () => {
  assert.equal(triggerEnabled(), "O", "precondition: profiles_role_guard enabled");
  seededOwners = ownerIds();
  const email = `it-${uniqueTag("boot")}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const u = await authAdmin("users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: "IT Bootstrap" } }) });
  candidate = { id: u.id, email, password };
  assert.equal(roleOf(candidate.id), "customer", "a fresh profile starts as customer");
  setRoleAsSuperuser(seededOwners, "admin");
  assert.deepEqual(ownerIds(), [], "setup: no owner left");
});

after(async () => {
  try {
    if (candidate) await authAdmin(`users/${candidate.id}`, { method: "DELETE" });
  } finally {
    setRoleAsSuperuser(seededOwners, "owner");
    assert.deepEqual(ownerIds(), [...seededOwners].sort(), "teardown: seeded owners restored");
    assert.equal(triggerEnabled(), "O");
  }
});

test("first-owner bootstrap: unknown email refuses, changes nothing, trigger stays enabled", () => {
  const digest0 = profilesDigest();
  const r = runBootstrap(`it-nobody-${uniqueTag("x")}@example.test`);
  assert.notEqual(r.status, 0, "an unknown email must fail");
  assert.match(r.out, /expected exactly one profile for that email, found 0/);
  assert.equal(profilesDigest(), digest0, "a refused run changed profiles");
  assert.equal(triggerEnabled(), "O");
  assert.deepEqual(ownerIds(), []);

  const noVar = runBootstrap(undefined);
  assert.notEqual(noVar.status, 0, "an UNEDITED file must refuse");
  assert.match(noVar.out, /no valid owner email given/);
  assert.equal(profilesDigest(), digest0);
  assert.equal(triggerEnabled(), "O");
});

test("first-owner bootstrap: promotes exactly the given profile to owner and re-enables the guard", () => {
  const digest0 = psqlScalar(`select md5(string_agg(id::text || ':' || role, ',' order by id)) from public.profiles where id <> ${sqlText(candidate.id)};`);
  // Mixed case + spaces: the match is case-insensitive and trimmed.
  const r = runBootstrap(`  ${candidate.email.toUpperCase()} `);
  assert.equal(r.status, 0, `bootstrap failed: ${r.out.slice(0, 400)}`);
  assert.match(r.out, /COMMIT/);
  assert.equal(roleOf(candidate.id), "owner");
  assert.deepEqual(ownerIds(), [candidate.id]);
  assert.equal(triggerEnabled(), "O", "profiles_role_guard must be enabled after the run");
  const after0 = psqlScalar(`select md5(string_agg(id::text || ':' || role, ',' order by id)) from public.profiles where id <> ${sqlText(candidate.id)};`);
  assert.equal(after0, digest0, "no other profile changed");
});

test("first-owner bootstrap: a second run refuses (owner exists) and changes nothing", async () => {
  const other = await c.signIn("customerB");
  const digest0 = profilesDigest();
  const r = runBootstrap(other.email);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /an owner already exists/);
  assert.equal(roleOf(other.id), "customer");
  assert.equal(profilesDigest(), digest0);
  assert.equal(triggerEnabled(), "O");
});

test("first-owner bootstrap: the guard still blocks an ordinary user changing their own role via REST", async () => {
  const a = await c.signIn("customerA");
  const asA = c.asUser(a.token);
  for (const role of ["owner", "admin"]) {
    const r = await asA(`profiles?id=eq.${a.id}`, { method: "PATCH", body: { role }, headers: { Prefer: "return=representation" } });
    assert.ok(r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0), `self-promotion to ${role}: HTTP ${r.status}`);
    assert.equal(roleOf(a.id), "customer", `customer A became ${role}`);
  }
  assert.equal(triggerEnabled(), "O");
});
