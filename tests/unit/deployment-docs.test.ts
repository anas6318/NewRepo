/**
 * Static checks on the deployment docs: the first-owner procedure is the
 * guarded bootstrap script (not a bare role UPDATE that the 0002 trigger
 * refuses), and 0008 is documented next to 0007. The script itself is
 * executed against the local database by
 * tests/integration/local-supabase/08-first-owner-bootstrap.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const guide = readFileSync("docs/deployment-guide.md", "utf8");
const sql = readFileSync("docs/sql/bootstrap-first-owner.sql", "utf8");

/** SQL with `--` comments removed, so assertions see statements only. */
const statements = sql
  .split(/\r?\n/)
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

test("deployment guide: first owner is made with docs/sql/bootstrap-first-owner.sql", () => {
  assert.ok(guide.includes("docs/sql/bootstrap-first-owner.sql"), "the guide must reference the bootstrap script");
  const section = guide.slice(guide.indexOf("## 5 · First owner account"), guide.indexOf("## 6 ·"));
  assert.ok(section.includes("bootstrap-first-owner.sql"), "§5 must point at the script");
  assert.match(section, /postgres/, "§5 must say who can run it");
  assert.match(section, /one-time/i, "§5 must say it is one-time");
  assert.match(section, /SQL editor/, "§5 must explain the Supabase SQL editor path");
  assert.ok(section.includes("REPLACE_WITH_OWNER_EMAIL") && !section.includes(":'owner_email'"), "§5 must use the editor-safe placeholder");
});

test("deployment guide: the bare `update profiles set role='owner'` instruction is gone", () => {
  assert.ok(!/update\s+(public\.)?profiles\s+set\s+role\s*=\s*'owner'/i.test(guide), "bare owner UPDATE still documented");
});

test("no repo doc gives a bare first-owner role UPDATE (README, guide, other *.md)", () => {
  const bare = /update\s+(public\.)?profiles\s+set\s+role\s*=/i;
  const readme = readFileSync("README.md", "utf8");
  assert.ok(!bare.test(readme), "README documents a bare role UPDATE");
  assert.ok(!bare.test(guide), "guide documents a bare role UPDATE");
  assert.ok(readme.includes("docs/sql/bootstrap-first-owner.sql"), "README must point at the bootstrap script");
  const skip = new Set(["node_modules", "graphify-out", ".claude", ".git", "dist"]);
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (skip.has(e.name) ? [] : walk(`${dir}/${e.name}`)) : e.name.endsWith(".md") ? [`${dir}/${e.name}`] : [],
    );
  for (const f of walk(".")) assert.ok(!bare.test(readFileSync(f, "utf8")), `${f} documents a bare role UPDATE`);
});

test("deployment guide: 0008 is in the migration list, with deploy order and rollback", () => {
  assert.ok(guide.includes("0008_order_transition_atomicity.sql"));
  const section = guide.slice(guide.indexOf("## Order transition atomicity (0008)"), guide.indexOf("## 7 ·"));
  assert.ok(section.length > 0, "0008 section missing");
  assert.match(section, /### Deploy order/);
  assert.match(section, /### Rollback/);
  assert.ok(section.indexOf("Apply `0008_order_transition_atomicity.sql`") < section.indexOf("supabase functions deploy admin-actions place-order"), "0008 must be applied before the functions are deployed");
});

test("bootstrap SQL: one transaction, owner-exists refusal, exact-one-profile check", () => {
  const begin = statements.search(/^\s*begin;\s*$/m);
  const commit = statements.search(/^\s*commit;\s*$/m);
  assert.ok(begin > -1 && commit > begin, "must run in one explicit transaction");
  assert.equal(statements.match(/^\s*begin;\s*$/gm)?.length, 1, "exactly one transaction");
  assert.match(statements, /where role = 'owner'/);
  assert.match(statements, /an owner already exists/);
  assert.match(statements, /expected exactly one profile for that email/);
  assert.match(statements, /'REPLACE_WITH_OWNER_EMAIL'/, "the email is a literal, editor-safe placeholder");
  assert.ok(!"REPLACE_WITH_OWNER_EMAIL".includes("@"), "the placeholder must not look like an address");
  assert.ok(!/:'/.test(sql), "no psql :'var' variable syntax (breaks in the Supabase SQL editor)");
});

test("bootstrap SQL: disables then re-enables profiles_role_guard inside the transaction and verifies tgenabled = 'O' before commit", () => {
  const begin = statements.search(/^\s*begin;\s*$/m);
  const commit = statements.search(/^\s*commit;\s*$/m);
  const disable = statements.indexOf("alter table public.profiles disable trigger profiles_role_guard;");
  const update = statements.indexOf("update public.profiles set role = 'owner'");
  const enable = statements.indexOf("alter table public.profiles enable trigger profiles_role_guard;");
  const verify = statements.indexOf("t.tgname = 'profiles_role_guard'");
  for (const [name, at] of Object.entries({ disable, update, enable, verify })) assert.ok(at > -1, `${name} missing`);
  assert.ok(begin < disable && disable < update && update < enable && enable < verify && verify < commit, "order must be begin → disable → update → enable → verify → commit");
  assert.match(statements.slice(verify, commit), /is distinct from 'O'/);
  // The trigger and its function are used, never redefined.
  assert.ok(!/create\s+(or\s+replace\s+)?(function|trigger)/i.test(statements), "the script must not (re)define functions or triggers");
  assert.ok(!/drop\s+trigger/i.test(statements));
});
