/**
 * Migration 0007 §2–§5 against the LOCAL stack: customers no longer read raw
 * orders over PostgREST, staff read but cannot PATCH, the idempotency key
 * column + partial unique index, and the service-role-only
 * `patch_order_data` RPC (atomic top-level merge, status coalesce,
 * concurrency).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { guardLocal } from "../../../scripts/local-staging/guard.mjs";
import { psql, psqlRows, psqlScalar } from "../../../scripts/local-staging/local-db.mjs";
import { client, customer, line, orderBody } from "./helpers.mjs";

// Guard FIRST: refuses (throws) before any request unless the stack is provably local.
const stack = guardLocal();
const c = client(stack);

const STAFF = ["contentManager", "orderManager", "admin", "owner"];
let A, B;
const staff = {};
let orderA, orderB;

async function place(token, contact) {
  const r = await c.fn("place-order", orderBody([line("it-retro-regular")], { customer: contact ?? customer() }), token ? { token } : {});
  assert.equal(r.status, 200, `place-order: HTTP ${r.status} ${r.json?.error ?? ""}`);
  return r.json.orderNumber;
}

/** A fresh throwaway order for tests that mutate state. */
const throwaway = () => place(null);

const rpc = (fnClient, args) => fnClient("rpc/patch_order_data", { method: "POST", body: args });

before(async () => {
  A = await c.signIn("customerA");
  B = await c.signIn("customerB");
  for (const k of STAFF) staff[k] = await c.signIn(k);
  orderA = await place(A.token);
  orderB = await place(B.token);
  // Control: these really are A's / B's own orders.
  assert.equal((await c.orderRow(orderA)).customer_id, A.id);
  assert.equal((await c.orderRow(orderB)).customer_id, B.id);
});

const noRows = (r, what) => {
  // RLS hides rows (200 []), or the grant refuses outright (401/403). Either way: nothing readable.
  if (r.status === 200) assert.deepEqual(r.json, [], `${what}: rows were readable`);
  else assert.ok([401, 403].includes(r.status), `${what}: unexpected HTTP ${r.status}`);
};

test("orders RLS: anon cannot read any order", async () => {
  noRows(await c.rest("orders?select=order_number,data"), "anon list");
  noRows(await c.rest(`orders?select=order_number,data&order_number=eq.${orderA}`), "anon by number");
  const all = await c.svc("orders?select=order_number&limit=5");
  assert.ok(all.json.length >= 2, "control: orders exist");
});

test("orders RLS: customer A cannot read raw orders via REST, including A's own", async () => {
  const asA = c.asUser(A.token);
  noRows(await asA("orders?select=order_number,data"), "A list");
  noRows(await asA(`orders?select=order_number,data&order_number=eq.${orderA}`), "A own order");
  noRows(await asA(`orders?select=order_number&customer_id=eq.${A.id}`), "A own by customer_id");
});

test("orders RLS: customer A cannot read customer B's order", async () => {
  noRows(await c.asUser(A.token)(`orders?select=order_number,data&order_number=eq.${orderB}`), "A reading B");
  noRows(await c.asUser(B.token)(`orders?select=order_number,data&order_number=eq.${orderA}`), "B reading A");
});

test("orders RLS: staff read works for every staff role (content_manager, order_manager, admin, owner)", async () => {
  for (const k of STAFF) {
    const r = await c.asUser(staff[k].token)(`orders?select=order_number,data&order_number=in.(${orderA},${orderB})`);
    assert.equal(r.status, 200, `${k}: HTTP ${r.status}`);
    assert.deepEqual(r.json.map((o) => o.order_number).sort(), [orderA, orderB].sort(), `${k} must read both orders`);
    assert.ok(r.json.every((o) => o.data && o.data.orderNumber), `${k}: data readable`);
  }
});

test("orders RLS: direct PATCH/DELETE on orders by staff (and customer) JWTs is blocked; the service role can write", async () => {
  const t = await throwaway();
  const before0 = await c.orderRow(t);
  const actors = [...STAFF.map((k) => [k, staff[k].token]), ["customerA", A.token]];
  for (const [k, token] of actors) {
    const p = await c.asUser(token)(`orders?order_number=eq.${t}`, {
      method: "PATCH",
      body: { fulfillment_status: "cancelled", locale: "he", data: { hacked: true } },
      headers: { Prefer: "return=representation" },
    });
    if (p.status === 200) assert.deepEqual(p.json, [], `${k}: PATCH returned rows`);
    else assert.ok([204, 401, 403, 404].includes(p.status), `${k}: PATCH HTTP ${p.status}`);
    const d = await c.asUser(token)(`orders?order_number=eq.${t}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    if (d.status === 200) assert.deepEqual(d.json, [], `${k}: DELETE returned rows`);
    else assert.ok([204, 401, 403, 404].includes(d.status), `${k}: DELETE HTTP ${d.status}`);
  }
  const after = await c.orderRow(t);
  assert.deepEqual(after, before0, "order changed by a non-service-role PATCH/DELETE");

  const s = await c.svc(`orders?order_number=eq.${t}`, { method: "PATCH", body: { locale: "he" }, headers: { Prefer: "return=representation" } });
  assert.equal(s.status, 200);
  assert.equal(s.json.length, 1);
  assert.equal((await c.orderRow(t)).locale, "he", "service role write must land");
  // Customers cannot insert orders directly either.
  const ins = await c.asUser(A.token)("orders", {
    method: "POST",
    body: { order_number: "IT-DIRECT-1", contact_hash: "x", total_ils: 1, data: {} },
  });
  assert.ok([401, 403].includes(ins.status), `direct insert HTTP ${ins.status}`);
  assert.equal(psqlScalar("select count(*) from public.orders where order_number = 'IT-DIRECT-1';"), "0");
});

test("orders policies: only orders_staff_read remains (catalog)", () => {
  const policies = psqlRows("select polname || ':' || polcmd::text from pg_policy where polrelid = 'public.orders'::regclass order by polname;");
  assert.deepEqual(policies, ["orders_staff_read:r"]);
});

test("idempotency_key: column and partial unique index exist (catalog)", () => {
  assert.equal(
    psqlScalar("select data_type || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'idempotency_key';"),
    "text:YES",
  );
  const idx = psqlScalar(`
    select i.indisunique || '|' || pg_get_expr(i.indpred, i.indrelid) || '|' || a.attname
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where ic.relname = 'orders_idempotency_key_uidx' and i.indrelid = 'public.orders'::regclass;`);
  assert.equal(idx, "true|(idempotency_key IS NOT NULL)|idempotency_key");
});

test("idempotency_key: a second row with the same non-null key raises 23505; NULL keys are allowed many times", () => {
  // One transaction, rolled back: nothing persists.
  const out = psql(`
    begin;
    create temp table it_idx_result (k text, v text) on commit drop;
    do $$
    declare st text := 'none'; cn text := 'none';
    begin
      insert into public.orders (order_number, contact_hash, total_ils, data, idempotency_key)
        values ('IT-IDX-1', 'x', 0, '{}', 'it-dup-key-1');
      begin
        insert into public.orders (order_number, contact_hash, total_ils, data, idempotency_key)
          values ('IT-IDX-2', 'x', 0, '{}', 'it-dup-key-1');
      exception when others then
        get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
      end;
      insert into it_idx_result values ('dup_sqlstate', st), ('dup_constraint', cn);
      insert into public.orders (order_number, contact_hash, total_ils, data, idempotency_key) values
        ('IT-IDX-3', 'x', 0, '{}', null), ('IT-IDX-4', 'x', 0, '{}', null), ('IT-IDX-5', 'x', 0, '{}', null);
      insert into it_idx_result select 'null_rows', count(*)::text from public.orders where order_number like 'IT-IDX-%' and idempotency_key is null;
      insert into it_idx_result select 'key_rows', count(*)::text from public.orders where idempotency_key = 'it-dup-key-1';
    end $$;
    select k || '=' || v from it_idx_result order by k;
    rollback;`).stdout;
  const got = Object.fromEntries(
    out
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => l.trim().split("=")),
  );
  assert.equal(got.dup_sqlstate, "23505");
  assert.equal(got.dup_constraint, "orders_idempotency_key_uidx");
  assert.equal(got.null_rows, "3");
  assert.equal(got.key_rows, "1");
  assert.equal(psqlScalar("select count(*) from public.orders where order_number like 'IT-IDX-%';"), "0", "test rows must be rolled back");
});

test("patch_order_data: EXECUTE denied for anon and authenticated (RPC 401/403, 42501); granted to service_role only", async () => {
  const t = await throwaway();
  const before0 = await c.orderRow(t);
  const callers = [
    ["anon", c.rest],
    ["customerA", c.asUser(A.token)],
    ...STAFF.map((k) => [k, c.asUser(staff[k].token)]),
  ];
  for (const [who, fnClient] of callers) {
    const r = await rpc(fnClient, { p_order_number: t, p_patch: { itHacked: who }, p_payment_status: "paid", p_fulfillment_status: "delivered" });
    assert.ok([401, 403].includes(r.status), `${who}: expected 401/403, got ${r.status}`);
    assert.equal(r.json?.code, "42501", `${who}: expected permission denied`);
  }
  assert.deepEqual(await c.orderRow(t), before0, "a refused RPC changed the order");

  const q = (sql) => psqlScalar(`select ${sql};`);
  const sig = "'public.patch_order_data(text, jsonb, text, text)'";
  assert.equal(q(`has_function_privilege('anon', ${sig}, 'EXECUTE')`), "f");
  assert.equal(q(`has_function_privilege('authenticated', ${sig}, 'EXECUTE')`), "f");
  assert.equal(q(`has_function_privilege('service_role', ${sig}, 'EXECUTE')`), "t");
  // No PUBLIC (empty grantee) entry in the ACL.
  assert.equal(q("exists (select 1 from pg_proc p, unnest(p.proacl) a where p.proname = 'patch_order_data' and a::text like '=%')"), "f");
  assert.equal(q("(select prosecdef from pg_proc where proname = 'patch_order_data')"), "t");
});

test("patch_order_data (service role): merges top-level keys atomically, preserves unrelated keys, coalesces status columns", async () => {
  const t = await throwaway();
  const row0 = await c.orderRow(t);

  const r1 = await rpc(c.svc, { p_order_number: t, p_patch: { itMergeOne: 1, itNested: { a: 1 } } });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.json, { ...row0.data, itMergeOne: 1, itNested: { a: 1 } }, "returned data = old data ∪ patch");
  const row1 = await c.orderRow(t);
  assert.deepEqual(row1.data, r1.json);
  assert.equal(row1.payment_status, row0.payment_status, "NULL p_payment_status must keep the column");
  assert.equal(row1.fulfillment_status, row0.fulfillment_status, "NULL p_fulfillment_status must keep the column");

  // Top-level merge: a nested object in the patch replaces that key; other keys stay.
  const r2 = await rpc(c.svc, { p_order_number: t, p_patch: { itNested: { b: 2 } }, p_payment_status: null, p_fulfillment_status: null });
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.json.itNested, { b: 2 });
  assert.equal(r2.json.itMergeOne, 1);
  assert.deepEqual(r2.json.items, row0.data.items);
  assert.deepEqual(r2.json.customer, row0.data.customer);

  const r3 = await rpc(c.svc, { p_order_number: t, p_patch: {}, p_payment_status: "under_review" });
  assert.equal(r3.status, 200);
  let row = await c.orderRow(t);
  assert.equal(row.payment_status, "under_review");
  assert.equal(row.fulfillment_status, row0.fulfillment_status);

  const r4 = await rpc(c.svc, { p_order_number: t, p_patch: {}, p_fulfillment_status: "issue_reported" });
  assert.equal(r4.status, 200);
  row = await c.orderRow(t);
  assert.equal(row.payment_status, "under_review", "payment column kept when only fulfillment is passed");
  assert.equal(row.fulfillment_status, "issue_reported");
  assert.equal(row.total_ils, row0.total_ils);

  // Unknown order → NULL, nothing created.
  const r5 = await rpc(c.svc, { p_order_number: "CR-NOPE00", p_patch: { x: 1 } });
  assert.equal(r5.status, 200);
  assert.equal(r5.json, null);
  // A non-object patch is refused (22023) and changes nothing.
  for (const bad of [[1, 2], "text", 5]) {
    const r6 = await rpc(c.svc, { p_order_number: t, p_patch: bad });
    assert.equal(r6.status, 400, `patch ${JSON.stringify(bad)}: HTTP ${r6.status}`);
    assert.equal(r6.json?.code, "22023");
  }
  assert.deepEqual((await c.orderRow(t)).data, r2.json);
});

test("patch_order_data concurrency: 5 parallel service-role patches of disjoint keys all land (no lost update)", async () => {
  for (let round = 0; round < 3; round++) {
    const t = await throwaway();
    const row0 = await c.orderRow(t);
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => rpc(c.svc, { p_order_number: t, p_patch: { [`itConc${i}`]: { round, i } }, ...(i === 2 ? { p_payment_status: "under_review" } : {}) })),
    );
    for (const r of results) assert.equal(r.status, 200);
    const row = await c.orderRow(t);
    for (let i = 0; i < 5; i++) assert.deepEqual(row.data[`itConc${i}`], { round, i }, `round ${round}: key itConc${i} lost`);
    for (const k of Object.keys(row0.data)) assert.deepEqual(row.data[k], row0.data[k], `round ${round}: unrelated key ${k} changed`);
    assert.equal(row.payment_status, "under_review");
    assert.equal(row.fulfillment_status, row0.fulfillment_status);
  }
});
