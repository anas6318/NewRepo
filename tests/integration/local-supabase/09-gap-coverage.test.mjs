/**
 * Commerce gap coverage against the LOCAL stack (real place-order Edge
 * Function, real Postgres): zone and payment-method refusals, stale supplier
 * availability, signed-in same-key concurrency, staff direct inserts, the
 * 0006 second-item promotion computed server-side, and the merge-only
 * place-order bookkeeping writes (0008).
 *
 * Every test that changes a GLOBAL setting (store_settings, a promotion, a
 * temporary product or trigger) snapshots it first and restores it in
 * `finally`, then asserts the restore.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardLocal } from "../../../scripts/local-staging/guard.mjs";
import { dollarQuote, psql, psqlScalar } from "../../../scripts/local-staging/local-db.mjs";
import { PROMO_ID, PRICES, ZONE_PRICE_ILS, productFixtures } from "../../../scripts/local-staging/fixtures.mjs";
import { client, countRows, customer, line, orderBody, sqlText, uniqueTag } from "./helpers.mjs";

// Guard FIRST: refuses (throws) before any request unless the stack is provably local.
const stack = guardLocal();
const c = client(stack);

const S = {};
before(async () => {
  for (const k of ["customerA", "contentManager", "orderManager", "admin", "owner"]) S[k] = await c.signIn(k);
});

const place = (body, opts) => c.fn("place-order", body, opts);
const ordersFor = (email) => countRows("public.orders", `data->'customer'->>'email' = ${sqlText(email)}`);

async function settingsData() {
  const r = await c.svc("store_settings?select=data&id=eq.main");
  assert.equal(r.status, 200);
  return r.json[0].data;
}
function writeSettings(data) {
  psql(`update public.store_settings set data = ${dollarQuote(JSON.stringify(data))}::jsonb where id = 'main';`);
}

/* ── 1 · zone ─────────────────────────────────────────────────────────── */

test("gap 1: unknown or tampered zoneId → rejected, no order row", async () => {
  for (const zoneId of ["it-no-such-zone", "it-zone' or '1'='1", "it-zone,it-other", "*", "", "IT-ZONE", 42, null]) {
    const body = orderBody([line("it-retro-regular")], { zoneId });
    const r = await place(body);
    assert.ok(r.status >= 400 && r.status < 500, `zoneId ${JSON.stringify(zoneId)}: HTTP ${r.status}`);
    assert.equal(r.json?.ok, false);
    assert.equal(r.json.error, "zone_unavailable", `zoneId ${JSON.stringify(zoneId)}`);
    assert.equal(ordersFor(body.customer.email), 0, `zoneId ${JSON.stringify(zoneId)} created an order`);
  }
  // Control: the real zone works.
  const ok = await place(orderBody([line("it-retro-regular")]));
  assert.equal(ok.status, 200);
});

/* ── 2 · payment method ───────────────────────────────────────────────── */

test("gap 2: disabled or unconfigured payment method → rejected (payment_method_unavailable), no order row; settings restored", async () => {
  const original = await settingsData();
  const withMethod = (id, change) => ({
    ...original,
    paymentMethods: original.paymentMethods.map((m) => (m.id === id ? { ...m, ...change } : m)),
  });
  try {
    // Seeded state: card is disabled and unconfigured.
    let body = orderBody([line("it-retro-regular")], { paymentMethod: "card" });
    let r = await place(body);
    assert.equal(r.status, 400, `card (seeded off): HTTP ${r.status}`);
    assert.equal(r.json.error, "payment_method_unavailable");
    assert.equal(ordersFor(body.customer.email), 0);

    // Enabled but NOT configured.
    writeSettings(withMethod("card", { enabled: true, configured: false }));
    body = orderBody([line("it-retro-regular")], { paymentMethod: "card" });
    r = await place(body);
    assert.equal(r.status, 400, `card enabled/unconfigured: HTTP ${r.status}`);
    assert.equal(r.json.error, "payment_method_unavailable");
    assert.equal(ordersFor(body.customer.email), 0);

    // The normally-working method, switched off.
    writeSettings(withMethod("bank_transfer", { enabled: false }));
    body = orderBody([line("it-retro-regular")], { paymentMethod: "bank_transfer" });
    r = await place(body);
    assert.equal(r.status, 400, `bank_transfer disabled: HTTP ${r.status}`);
    assert.equal(r.json.error, "payment_method_unavailable");
    assert.equal(ordersFor(body.customer.email), 0);

    // Unknown method id.
    writeSettings(original);
    body = orderBody([line("it-retro-regular")], { paymentMethod: "it-free-money" });
    r = await place(body);
    assert.equal(r.status, 400);
    assert.equal(ordersFor(body.customer.email), 0);
  } finally {
    writeSettings(original);
  }
  assert.deepEqual(await settingsData(), original, "store_settings restored");
});

/* ── 3 · stale supplier availability ──────────────────────────────────── */

test("gap 3: stale supplier availability (lastCheckedAt older than the 7-day window) → order held for supplier confirmation, never confirmed", async () => {
  const id = `it-stale-${uniqueTag("p")}`;
  const staleAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // order-pricing.ts FRESH_MS = 7 days
  const base = productFixtures().find((p) => p.id === "it-retro-regular").data;
  const data = {
    ...base,
    id,
    slug: id,
    availability: { status: "available", lastCheckedAt: staleAt },
    sizeAvailability: { "*:M": { status: "available", lastCheckedAt: staleAt } },
  };
  psql(
    `insert into public.products (id, slug, status, rights_status, category_slug, data) values (` +
      `${sqlText(id)}, ${sqlText(id)}, 'available', 'cleared', 'retro', ${dollarQuote(JSON.stringify(data))}::jsonb);`,
  );
  try {
    const body = orderBody([line(id)]);
    const r = await place(body);
    assert.equal(r.status, 200, `place-order: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.order.fulfillmentStatus, "awaiting_supplier_confirmation");
    assert.equal(r.json.order.paymentStatus, "awaiting_payment");
    assert.deepEqual(r.json.order.supplierConfirmation, { required: true, status: "pending", items: [{ slug: id, size: "M" }] });
    const row = await c.orderRow(r.json.orderNumber);
    assert.equal(row.fulfillment_status, "awaiting_supplier_confirmation");
    assert.equal(row.data.supplierConfirmation.status, "pending");
    assert.ok(!row.data.tracking.some((t) => ["payment_confirmed", "awaiting_payment"].includes(t.status)), "a held order is never moved on");
    assert.equal(row.data.subtotalIls, PRICES.retroRegular, "priced normally; only the fulfilment is held");

    // Control: the same product with a FRESH check is not held.
    const fresh = new Date().toISOString();
    psql(
      `update public.products set data = data || jsonb_build_object('availability', jsonb_build_object('status','available','lastCheckedAt',${sqlText(fresh)}), ` +
        `'sizeAvailability', jsonb_build_object('*:M', jsonb_build_object('status','available','lastCheckedAt',${sqlText(fresh)}))) where id = ${sqlText(id)};`,
    );
    const r2 = await place(orderBody([line(id)]));
    assert.equal(r2.status, 200);
    assert.equal(r2.json.order.fulfillmentStatus, "awaiting_payment");
  } finally {
    psql(`delete from public.products where id = ${sqlText(id)};`);
  }
  assert.equal(psqlScalar(`select count(*) from public.products where id = ${sqlText(id)};`), "0");
});

/* ── 4 · signed-in customer, same key, concurrent ─────────────────────── */

async function signedInBurst(n) {
  const body = orderBody([line("it-retro-regular")], { customer: customer(), idempotencyKey: randomUUID() });
  const results = await Promise.all(Array.from({ length: n }, () => place(body, { token: S.customerA.token })));
  for (const r of results) {
    assert.equal(r.status, 200, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.ok, true);
  }
  const numbers = new Set(results.map((r) => r.json.orderNumber));
  assert.equal(numbers.size, 1, `${n}x: ${numbers.size} order numbers`);
  assert.equal(results.filter((r) => r.json.duplicate !== true).length, 1, `${n}x: exactly one fresh response`);
  assert.equal(countRows("public.orders", `idempotency_key = ${sqlText(body.idempotencyKey)}`), 1, `${n}x: rows for the key`);
  assert.equal(ordersFor(body.customer.email), 1);
  const row = await c.orderRow([...numbers][0]);
  assert.equal(row.customer_id, S.customerA.id, "the order belongs to the signed-in customer");
  assert.equal(row.data.customer.customerId, S.customerA.id);
}

test("gap 4: signed-in customer A, same idempotency key 2x and 5x concurrently → one row with customer_id = A, one order number", async () => {
  await signedInBurst(2);
  await signedInBurst(5);
});

/* ── 5 · staff cannot insert orders directly ──────────────────────────── */

test("gap 5: staff JWTs (every staff role) and a customer cannot POST /rest/v1/orders directly — refused, 0 rows", async () => {
  for (const who of ["contentManager", "orderManager", "admin", "owner", "customerA"]) {
    const orderNumber = `IT-DIRECT-${uniqueTag("o").toUpperCase()}`;
    const r = await c.asUser(S[who].token)("orders", {
      method: "POST",
      body: { order_number: orderNumber, contact_hash: "it-hash", payment_status: "paid", fulfillment_status: "delivered", total_ils: 1, locale: "en", data: { orderNumber, itDirectInsert: who } },
      headers: { Prefer: "return=minimal" },
    });
    assert.ok([401, 403].includes(r.status), `${who}: HTTP ${r.status}`);
    assert.equal(r.json?.code, "42501", `${who}: expected an RLS / permission refusal`);
    assert.equal(countRows("public.orders", `order_number = ${sqlText(orderNumber)}`), 0, `${who} inserted an order`);
  }
});

/* ── 6 · second-item promotion (0006), server-authoritative ───────────── */

test("gap 6: enabled second-item promotion → server applies the exact discount (response + stored row); a client-claimed discount is ignored; promotion restored", async () => {
  const snap = (await c.svc(`promotions?select=id,enabled,data&id=eq.${PROMO_ID}`)).json[0];
  assert.ok(snap && snap.enabled === false, "precondition: the seeded campaign is disabled");
  try {
    psql(
      `update public.promotions set enabled = true, data = data || '{"enabled": true}'::jsonb where id = ${sqlText(PROMO_ID)};`,
    );
    // Retro regular ₪169 + Fan ₪149: one pair → 50% off the cheaper unit (₪149) = ₪74.50.
    const body = orderBody([line("it-retro-regular"), line("it-season", { version: "fan" })], {
      // Client claims — all must be ignored.
      promotionDiscountIls: 200,
      discountIls: 200,
      totalIls: 1,
      subtotalIls: 1,
      promotion: { promotionId: PROMO_ID, discountIls: 200, discountPercent: 100 },
    });
    const r = await place(body);
    assert.equal(r.status, 200, `place-order: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    const expected = { subtotal: PRICES.retroRegular + PRICES.fan, discount: 74.5, delivery: ZONE_PRICE_ILS };
    const total = expected.subtotal - expected.discount + expected.delivery; // 318 − 74.5 + 30 = 273.5
    const o = r.json.order;
    assert.equal(o.subtotalIls, expected.subtotal);
    assert.equal(o.promotionDiscountIls, expected.discount);
    assert.equal(o.deliveryIls, expected.delivery);
    assert.equal(o.totalIls, total);
    assert.equal(o.promotion.promotionId, PROMO_ID);
    assert.equal(o.promotion.discountIls, expected.discount);
    const row = await c.orderRow(r.json.orderNumber);
    assert.equal(Number(row.total_ils), total, "stored total_ils");
    assert.equal(row.data.totalIls, total);
    assert.equal(row.data.promotionDiscountIls, expected.discount);
    assert.equal(row.data.promotion.discountPercent, 50, "the stored campaign percent, not the client's");
    assert.deepEqual(row.data.promotion.items.map((i) => [i.productId, i.discountIls]), [["it-season", 74.5]]);
  } finally {
    psql(`update public.promotions set enabled = ${snap.enabled}, data = ${dollarQuote(JSON.stringify(snap.data))}::jsonb where id = ${sqlText(PROMO_ID)};`);
  }
  assert.deepEqual((await c.svc(`promotions?select=id,enabled,data&id=eq.${PROMO_ID}`)).json[0], snap, "promotion restored");
  // Disabled again → no discount.
  const off = await place(orderBody([line("it-retro-regular"), line("it-season", { version: "fan" })]));
  assert.equal(off.json.order.promotionDiscountIls ?? 0, 0);
});

/* ── place-order bookkeeping writes are merge-only (0008) ──────────────── */

test("place-order: the order_received ledger and owner-alert writes are merge-only — an Admin change committed right after the insert survives", async () => {
  const domainTag = uniqueTag("merge");
  // Simulates a concurrent Admin change landing between the insert and the
  // alert write: an AFTER INSERT trigger (this test only, this address only)
  // merges an internal note onto the new row in the insert's own transaction.
  psql(`
    create or replace function public.it_concurrent_admin_change() returns trigger language plpgsql as $f$
    begin
      update public.orders set data = data || '{"internalNotes": "IT concurrent admin note"}'::jsonb where id = new.id;
      return null;
    end $f$;
    drop trigger if exists it_concurrent_admin_change on public.orders;
    create trigger it_concurrent_admin_change after insert on public.orders for each row
      when (new.data->'customer'->>'email' like ${sqlText(`%@${domainTag}.example.test`)})
      execute function public.it_concurrent_admin_change();`);
  let orderNumber;
  try {
    const r = await place(orderBody([line("it-retro-regular")], { customer: customer({ domainTag }) }));
    assert.equal(r.status, 200, `place-order: HTTP ${r.status}`);
    orderNumber = r.json.orderNumber;
  } finally {
    psql("drop trigger if exists it_concurrent_admin_change on public.orders; drop function if exists public.it_concurrent_admin_change();");
  }
  const row = await c.orderRow(orderNumber);
  assert.equal(row.data.internalNotes, "IT concurrent admin note", "the alert / ledger write reverted a concurrent change");
  assert.notEqual(row.data.notification?.status, "pending", "owner alert result recorded");
  assert.equal(row.data.customerEmails?.order_received?.attempts, 1, "order_received ledger recorded");
  assert.deepEqual(Object.keys(row.data.customerEmails), ["order_received"]);
  assert.ok(row.data.sheetsSync, "sheets-sync status kept");
  assert.equal(psqlScalar("select count(*) from pg_trigger where tgname = 'it_concurrent_admin_change';"), "0", "test trigger removed");
});
