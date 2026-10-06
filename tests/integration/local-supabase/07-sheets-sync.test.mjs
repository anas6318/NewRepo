/**
 * `sheets-sync` on the LOCAL stack, where Google Sheets is deliberately NOT
 * configured (no GOOGLE_* variables in the functions env): it must say so,
 * record the attempt as `disabled`, contact nothing, and never record a
 * false "synced" — on the order, in sheets_sync_log, or in its response.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { guardLocal } from "../../../scripts/local-staging/guard.mjs";
import { client, countRows, customer, line, orderBody, sqlText } from "./helpers.mjs";
import { psqlRows } from "../../../scripts/local-staging/local-db.mjs";

// Guard FIRST: refuses (throws) before any request unless the stack is provably local.
const stack = guardLocal();
const c = client(stack);

const NOT_CONFIGURED = /not configured/i;

async function place() {
  const r = await c.fn("place-order", orderBody([line("it-retro-regular")], { customer: customer() }));
  assert.equal(r.status, 200);
  return r.json.orderNumber;
}

const logRows = (orderNumber) => psqlRows(`select status || '|' || coalesce(last_error, '') from public.sheets_sync_log where order_number = ${sqlText(orderNumber)} order by updated_at;`);

test("sheets-sync: the checkout's own sync attempt is recorded as disabled ('not configured'), never synced", async () => {
  const n = await place();
  const rows = logRows(n);
  assert.equal(rows.length, 1);
  const [status, error] = rows[0].split("|");
  assert.equal(status, "disabled");
  assert.match(error, NOT_CONFIGURED);
  const order = await c.orderRow(n);
  assert.notEqual(order.data.sheetsSync.status, "synced");
});

test("sheets-sync: service-role call returns 'not configured' safely and leaves no synced record", async () => {
  const n = await place();
  const r = await c.fn("sheets-sync", { orderNumber: n }, { token: stack.serviceRoleKey });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, false);
  assert.match(r.json.message, NOT_CONFIGURED);
  assert.ok(logRows(n).every((row) => row.startsWith("disabled|")));
  assert.notEqual((await c.orderRow(n)).data.sheetsSync.status, "synced");
});

test("sheets-sync: staff manual resync also reports 'not configured'; anonymous and customer callers are refused", async () => {
  const n = await place();
  const om = await c.signIn("orderManager");
  const staff = await c.fn("sheets-sync", { orderNumber: n }, { token: om.token });
  assert.equal(staff.status, 200);
  assert.equal(staff.json.ok, false);
  assert.match(staff.json.message, NOT_CONFIGURED);

  const anon = await c.fn("sheets-sync", { orderNumber: n });
  assert.equal(anon.status, 403);
  const a = await c.signIn("customerA");
  const cust = await c.fn("sheets-sync", { orderNumber: n }, { token: a.token });
  assert.equal(cust.status, 403);
  const forged = await c.fn("sheets-sync", { orderNumber: n, drain: true }, { token: stack.anonKey });
  assert.equal(forged.status, 403, "the anon key is not the service bearer");
});

test("sheets-sync: drain never records a false 'synced' anywhere", async () => {
  await place();
  const r = await c.fn("sheets-sync", { drain: true }, { token: stack.serviceRoleKey });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  for (const res of r.json.results) {
    assert.equal(res.ok, false);
    assert.match(res.message, NOT_CONFIGURED);
  }
  assert.equal(countRows("public.sheets_sync_log", "status = 'synced'"), 0);
  assert.equal(countRows("public.orders", "data->'sheetsSync'->>'status' = 'synced'"), 0);
});
