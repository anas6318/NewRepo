/**
 * place-order IDEMPOTENCY against the LOCAL stack: one checkout attempt
 * (one `idempotencyKey`) creates at most one order — on retry, on a changed
 * body, and under 2× / 5× near-simultaneous requests racing on the unique
 * index `orders_idempotency_key_uidx`.
 *
 * "One set of side effects" is checked on every channel the function writes:
 * the orders row, `sheets_sync_log`, `audit_log` (order_created), `leads`
 * (marketing consent), the order's own customer-email ledger and the owner
 * alert bookkeeping, and the console-mode email lines in the functions log
 * (each test's customer address sits on its own example.test subdomain so
 * those lines can be attributed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { guardLocal } from "../../../scripts/local-staging/guard.mjs";
import { DB_CONTAINER } from "../../../scripts/local-staging/local-db.mjs";
import { client, countRows, customer, functionLogLines, line, orderBody, sleep, sqlText, uniqueTag, waitFor } from "./helpers.mjs";

// Guard FIRST: refuses (throws) before any request unless the stack is provably local.
const stack = guardLocal();
const c = client(stack);

function attempt() {
  const domainTag = uniqueTag("idem");
  const body = orderBody([line("it-retro-regular", { quantity: 2 }), line("it-season", { version: "fan" })], {
    customer: customer({ domainTag }),
    marketingConsent: true,
    idempotencyKey: randomUUID(),
  });
  return { body, domainTag, key: body.idempotencyKey, email: body.customer.email };
}

const send = (body) => c.fn("place-order", body);
const emailLines = (domainTag) => functionLogLines().filter((l) => l.includes(`@${domainTag}.example.test`) && l.includes("[customer-email:"));

/** Exactly one order and exactly one of every downstream side effect. */
async function assertSingleOrderEffects({ key, email, domainTag }, orderNumber) {
  assert.equal(countRows("public.orders", `idempotency_key = ${sqlText(key)}`), 1, "orders rows for the key");
  assert.equal(countRows("public.orders", `data->'customer'->>'email' = ${sqlText(email)}`), 1, "orders rows for the customer");
  assert.equal(countRows("public.sheets_sync_log", `order_number = ${sqlText(orderNumber)}`), 1, "sheets_sync_log rows");
  assert.equal(countRows("public.audit_log", `action = 'order_created' and target = ${sqlText(orderNumber)}`), 1, "audit order_created rows");
  assert.equal(countRows("public.leads", `value = ${sqlText(email)}`), 1, "leads rows (marketing consent)");

  const row = await c.orderRow(orderNumber);
  assert.equal(row.idempotency_key, key);
  assert.equal(row.data.idempotency?.key, key);
  assert.deepEqual(Object.keys(row.data.customerEmails ?? {}), ["order_received"], "customer-email ledger events");
  assert.equal(row.data.customerEmails.order_received.attempts, 1, "order_received attempted exactly once");
  assert.notEqual(row.data.notification?.status, "pending", "owner alert attempted (and recorded) once");

  // Console-mode email lines: wait for the log to flush, then require exactly one.
  await waitFor(() => emailLines(domainTag).length >= 1, { timeoutMs: 8000 });
  await sleep(1000);
  const lines = emailLines(domainTag);
  assert.equal(lines.length, 1, `console email lines for this attempt: ${lines.length}`);
  assert.ok(lines[0].includes("[customer-email:order_received:console]"));
}

test("idempotency: first request with a key creates exactly one order", async () => {
  const a = attempt();
  const r = await send(a.body);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.duplicate, undefined);
  await assertSingleOrderEffects(a, r.json.orderNumber);
});

test("idempotency: retry with the same key and body returns the same order (duplicate: true) and repeats no side effect", async () => {
  const a = attempt();
  const first = await send(a.body);
  assert.equal(first.status, 200);
  for (let i = 0; i < 2; i++) {
    const again = await send(a.body);
    assert.equal(again.status, 200);
    assert.equal(again.json.ok, true);
    assert.equal(again.json.duplicate, true);
    assert.equal(again.json.orderNumber, first.json.orderNumber);
    assert.deepEqual(again.json.order, first.json.order, "replay returns the same (sanitized) order");
  }
  // Same key, different spelling of the UUID → still the same attempt.
  const upper = await send({ ...a.body, idempotencyKey: a.key.toUpperCase() });
  assert.equal(upper.json.orderNumber, first.json.orderNumber);
  assert.equal(upper.json.duplicate, true);
  await assertSingleOrderEffects(a, first.json.orderNumber);
});

test("idempotency: same key with a changed body → 409 idempotency_conflict, reveals nothing, still one order", async () => {
  const a = attempt();
  const first = await send(a.body);
  assert.equal(first.status, 200);
  const changed = [
    { ...a.body, lines: [line("it-retro-regular", { quantity: 3 })] },
    { ...a.body, zoneId: "center" },
    { ...a.body, customer: { ...a.body.customer, address: "2 Other Street" } },
    // A different contact can never use the key to read someone's order.
    { ...a.body, customer: { ...a.body.customer, email: `it-${uniqueTag("x")}@example.test` } },
  ];
  for (const body of changed) {
    const r = await send(body);
    assert.equal(r.status, 409, `changed body: HTTP ${r.status}`);
    assert.deepEqual(r.json, { ok: false, error: "idempotency_conflict" });
  }
  await assertSingleOrderEffects(a, first.json.orderNumber);
});

test("idempotency: malformed keys are refused before anything is written", async () => {
  for (const idempotencyKey of ["not-a-uuid", "", 42, "6fa459ea-ee8a-3ca4-894e-db77e160355e" /* v3 */]) {
    const a = attempt();
    const r = await send({ ...a.body, idempotencyKey });
    assert.equal(r.status, 400, `${JSON.stringify(idempotencyKey)}: HTTP ${r.status}`);
    assert.deepEqual(r.json, { ok: false, error: "invalid_idempotency_key" });
    assert.equal(countRows("public.orders", `data->'customer'->>'email' = ${sqlText(a.email)}`), 0);
  }
});

/** Unique-index losses Postgres logged so far (diagnostic: proves the race
 * really reached the INSERT, rather than every loser replaying early). */
function uniqueIndexRaces() {
  const r = spawnSync("docker", ["logs", DB_CONTAINER], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.split(/\r?\n/).filter((l) => l.includes('unique constraint "orders_idempotency_key_uidx"')).length;
}

async function burst(n, t) {
  const racesBefore = uniqueIndexRaces();
  const a = attempt();
  const results = await Promise.all(Array.from({ length: n }, () => send(a.body)));
  for (const r of results) {
    assert.equal(r.status, 200, `concurrent request: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.ok, true);
  }
  const numbers = new Set(results.map((r) => r.json.orderNumber));
  assert.equal(numbers.size, 1, `${n} concurrent same-key requests produced ${numbers.size} order numbers`);
  const fresh = results.filter((r) => r.json.duplicate !== true);
  assert.equal(fresh.length, 1, "exactly one request created the order; the rest replayed it");
  await assertSingleOrderEffects(a, [...numbers][0]);
  t.diagnostic(`${n}x burst: ${n - 1} replays; unique-index races logged by Postgres: ${uniqueIndexRaces() - racesBefore}`);
}

test("idempotency concurrency: 2 near-simultaneous same-key requests → exactly one order row, one set of side effects", async (t) => {
  await burst(2, t);
  await burst(2, t);
});

test("idempotency concurrency: 5 near-simultaneous same-key requests → exactly one order row, one set of side effects", async (t) => {
  await burst(5, t);
  await burst(5, t);
});

test("idempotency: requests without a key keep the legacy path (each creates its own order)", async () => {
  const a = attempt();
  const legacy = { ...a.body };
  delete legacy.idempotencyKey;
  const r1 = await send(legacy);
  const r2 = await send(legacy);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.notEqual(r1.json.orderNumber, r2.json.orderNumber);
  assert.equal(countRows("public.orders", `data->'customer'->>'email' = ${sqlText(a.email)} and idempotency_key is null`), 2);
});
