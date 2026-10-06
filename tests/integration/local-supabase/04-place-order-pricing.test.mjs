/**
 * place-order PRICING and TAMPER cases against the LOCAL stack (real Edge
 * Function, real Postgres rows). Every price comes from the seeded it-
 * fixtures (scripts/local-staging/fixtures.mjs):
 *   Retro ₪169 · Retro on sale ₪149 · Fan ₪149 · Player ₪179 · badge ₪12 ·
 *   zone `it-zone` ₪30 · free delivery from 3 qualifying units (store_settings).
 * Accepted orders are checked in the response AND in the stored row; rejected
 * requests are checked to have created no row at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { guardLocal } from "../../../scripts/local-staging/guard.mjs";
import { BADGE_ID, BADGE_PRICE_ILS, BADGE_SUPPLIER_REF, PRICES, PROMO_ID, ZONE_PRICE_ILS } from "../../../scripts/local-staging/fixtures.mjs";
import { assertNoSupplierData, client, countRows, customer, line, orderBody, sqlText } from "./helpers.mjs";

// Guard FIRST: refuses (throws) before any request unless the stack is provably local.
const stack = guardLocal();
const c = client(stack);

const ordersFor = (email) => countRows("public.orders", `data->'customer'->>'email' = ${sqlText(email)}`);

/** Places an order that must succeed; checks response vs stored row. */
async function placeOk(lines, extra = {}) {
  const body = orderBody(lines, { customer: customer(), ...extra });
  const r = await c.fn("place-order", body);
  assert.equal(r.status, 200, `expected 200, got ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(r.json.ok, true);
  const row = await c.orderRow(r.json.orderNumber);
  assert.ok(row, "order row missing");
  assert.equal(Number(row.total_ils), r.json.order.totalIls, "total_ils column = response total");
  assert.equal(row.data.totalIls, r.json.order.totalIls, "stored data.totalIls = response total");
  assert.equal(row.data.subtotalIls, r.json.order.subtotalIls);
  assert.equal(row.data.deliveryIls, r.json.order.deliveryIls);
  assertNoSupplierData(r.json, "place-order response");
  return { order: r.json.order, row, body };
}

/** Sends a request that must be refused with `error`; checks no row was created. */
async function placeRejected(lines, error, extra = {}) {
  const body = orderBody(lines, { customer: customer(), ...extra });
  const email = body.customer?.email;
  const r = await c.fn("place-order", body);
  assert.equal(r.status, 400, `expected 400 ${error}, got ${r.status} ${JSON.stringify(r.json)}`);
  assert.deepEqual(r.json, { ok: false, error });
  if (typeof email === "string") assert.equal(ordersFor(email), 0, `a rejected request (${error}) created an order row`);
  return r;
}

const expectTotals = (order, { subtotal, delivery }) => {
  assert.equal(order.subtotalIls, subtotal, "subtotal");
  assert.equal(order.deliveryIls, delivery, "delivery");
  assert.equal(order.totalIls, subtotal + delivery, "total");
};

/* ── correct prices ──────────────────────────────────────────────────────── */

test("pricing: Retro regular = ₪169 (+ ₪30 zone delivery)", async () => {
  const { order } = await placeOk([line("it-retro-regular")]);
  assert.equal(order.items[0].unitPriceIls, PRICES.retroRegular);
  assert.equal(order.items[0].price.regularUnitPriceIls, PRICES.retroRegular);
  assert.equal(order.items[0].price.saleDiscountIls, 0);
  expectTotals(order, { subtotal: 169, delivery: ZONE_PRICE_ILS });
});

test("pricing: Retro on an active sale = ₪149 (regular ₪169 kept on the line)", async () => {
  const { order } = await placeOk([line("it-retro-sale")]);
  const p = order.items[0].price;
  assert.equal(p.regularUnitPriceIls, PRICES.retroRegular);
  assert.equal(p.saleDiscountIls, PRICES.retroRegular - PRICES.retroSale);
  assert.equal(p.finalUnitPriceIls, PRICES.retroSale);
  assert.equal(p.saleType, "fixed_price");
  expectTotals(order, { subtotal: 149, delivery: ZONE_PRICE_ILS });
});

test("pricing: Fan = ₪149", async () => {
  const { order } = await placeOk([line("it-season", { version: "fan" })]);
  assert.equal(order.items[0].version, "fan");
  assert.equal(order.items[0].unitPriceIls, PRICES.fan);
  expectTotals(order, { subtotal: 149, delivery: ZONE_PRICE_ILS });
});

test("pricing: Player = ₪179", async () => {
  const { order } = await placeOk([line("it-season", { version: "player" })]);
  assert.equal(order.items[0].version, "player");
  assert.equal(order.items[0].price.versionAdjustmentIls, 30);
  assert.equal(order.items[0].unitPriceIls, PRICES.player);
  expectTotals(order, { subtotal: 179, delivery: ZONE_PRICE_ILS });
});

test("pricing: Player 4XL is rejected (invalid_size) while Fan 4XL is accepted", async () => {
  await placeRejected([line("it-season", { version: "player", size: "4XL" })], "invalid_size");
  await placeRejected([line("it-season", { version: "player", size: "3XL" })], "invalid_size");
  const { order } = await placeOk([line("it-season", { version: "fan", size: "4XL" })]);
  assert.equal(order.items[0].size, "4XL");
  assert.equal(order.items[0].unitPriceIls, PRICES.fan);
});

test("pricing: personalization name + number is free", async () => {
  const { order } = await placeOk([line("it-retro-regular", { personalization: { name: "IT TEST", number: "10" } })]);
  assert.deepEqual(order.items[0].personalization, { name: "IT TEST", number: "10" });
  assert.equal(order.items[0].unitPriceIls, PRICES.retroRegular);
  expectTotals(order, { subtotal: 169, delivery: ZONE_PRICE_ILS });
});

test("pricing: badge charged at its catalog price (₪12); supplier ref stored for the owner, never returned", async () => {
  const { order, row } = await placeOk([line("it-retro-regular", { badgeId: BADGE_ID })]);
  assert.equal(order.items[0].price.badgeAdjustmentIls, BADGE_PRICE_ILS);
  assert.equal(order.items[0].unitPriceIls, PRICES.retroRegular + BADGE_PRICE_ILS);
  assert.equal(row.data.items[0].badge.supplierReference, BADGE_SUPPLIER_REF, "control: owner snapshot keeps it");
  assert.equal(order.items[0].badge.supplierReference, undefined);
});

test("pricing: 3 qualifying units earn free delivery for real", async () => {
  const { order } = await placeOk([line("it-retro-regular", { quantity: 3 })]);
  assert.equal(order.freeDelivery, true);
  expectTotals(order, { subtotal: 3 * 169, delivery: 0 });
});

/* ── tampering ───────────────────────────────────────────────────────────── */

test("tamper: fake client price fields are ignored — server price charged", async () => {
  const { order, row } = await placeOk(
    [line("it-retro-regular", { unitPriceIls: 1, lineTotalIls: 1, basePriceIls: 1, finalUnitPriceIls: 1, price: { finalUnitPriceIls: 1, regularUnitPriceIls: 1 } })],
    { subtotalIls: 1, totalIls: 1, total: 1, deliveryIls: 0 },
  );
  assert.equal(order.items[0].unitPriceIls, PRICES.retroRegular);
  expectTotals(order, { subtotal: 169, delivery: ZONE_PRICE_ILS });
  assert.equal(Number(row.total_ils), 199);
});

test("tamper: fake sale on a regular Retro is ignored", async () => {
  const fakeSale = { enabled: true, type: "fixed_price", salePriceIls: 1, startsAt: "2020-01-01T00:00:00Z" };
  const { order } = await placeOk([line("it-retro-regular", { sale: fakeSale, saleDiscountIls: 168, salePriceIls: 1 })], { sale: fakeSale });
  assert.equal(order.items[0].price.saleDiscountIls, 0);
  assert.equal(order.items[0].price.saleType, undefined);
  expectTotals(order, { subtotal: 169, delivery: ZONE_PRICE_ILS });
});

test("tamper: fake promotion (client-sent campaign / disabled campaign id) gives no discount", async () => {
  const fakePromo = { promotionId: PROMO_ID, type: "second_item_percentage", enabled: true, discountPercent: 100, discountIls: 169, minimumQuantity: 2 };
  const { order, row } = await placeOk([line("it-retro-regular", { quantity: 2, promotionId: PROMO_ID })], {
    promotionId: PROMO_ID,
    promotion: fakePromo,
    promotions: [fakePromo],
    promotionDiscountIls: 169,
  });
  assert.equal(order.promotion, undefined, "no campaign may be applied from the client");
  assert.equal(order.promotionDiscountIls, undefined);
  assert.equal(row.data.promotion, undefined);
  expectTotals(order, { subtotal: 2 * 169, delivery: ZONE_PRICE_ILS });
});

test("tamper: fake free shipping is ignored (1–2 units pay the zone fee)", async () => {
  for (const qty of [1, 2]) {
    const { order } = await placeOk([line("it-retro-regular", { quantity: qty })], { freeDelivery: true, deliveryIls: 0, freeDeliveryMinItems: 1 });
    assert.equal(order.freeDelivery, false);
    expectTotals(order, { subtotal: qty * 169, delivery: ZONE_PRICE_ILS });
  }
});

test("tamper: fake badge price is ignored (charged ₪12, not the client's ₪0)", async () => {
  const { order } = await placeOk([
    line("it-retro-regular", { badgeId: BADGE_ID, badgePriceIls: 0, badge: { badgeId: BADGE_ID, priceIls: 0 }, price: { badgeAdjustmentIls: 0 } }),
  ]);
  assert.equal(order.items[0].badge.priceIls, BADGE_PRICE_ILS);
  assert.equal(order.items[0].unitPriceIls, PRICES.retroRegular + BADGE_PRICE_ILS);
  expectTotals(order, { subtotal: 181, delivery: ZONE_PRICE_ILS });
  await placeRejected([line("it-retro-regular", { badgeId: "it-fake-badge" })], "invalid_badge");
});

/* ── validation ──────────────────────────────────────────────────────────── */

test("validation: invalid version rejected (unknown version; version on a product without versions)", async () => {
  await placeRejected([line("it-season", { version: "goalkeeper" })], "invalid_version");
  await placeRejected([line("it-season")], "invalid_version");
  await placeRejected([line("it-retro-regular", { version: "player" })], "invalid_version");
});

test("validation: invalid size rejected", async () => {
  await placeRejected([line("it-retro-regular", { size: "5XL" })], "invalid_size");
  await placeRejected([line("it-retro-regular", { size: "4XL" })], "invalid_size");
  await placeRejected([line("it-retro-regular", { size: undefined })], "invalid_size");
});

test("validation: quantity 0 (and other non-positive / non-integer quantities) rejected", async () => {
  for (const quantity of [0, -1, 1.5, "2", null]) await placeRejected([line("it-retro-regular", { quantity })], "invalid_quantity");
});

test("validation: quantity above 10 rejected (11); 10 accepted", async () => {
  await placeRejected([line("it-retro-regular", { quantity: 11 })], "invalid_quantity");
  await placeRejected([line("it-retro-regular", { quantity: 1000 })], "invalid_quantity");
  const { order } = await placeOk([line("it-retro-regular", { quantity: 10 })]);
  expectTotals(order, { subtotal: 1690, delivery: 0 });
});

test("validation: more than 30 lines rejected (too_many_lines); 30 accepted", async () => {
  await placeRejected(Array.from({ length: 31 }, () => line("it-retro-regular")), "too_many_lines");
  await placeRejected(Array.from({ length: 200 }, () => line("it-retro-regular")), "too_many_lines");
  const { order } = await placeOk(Array.from({ length: 30 }, () => line("it-retro-regular")));
  assert.equal(order.items.length, 30);
  expectTotals(order, { subtotal: 30 * 169, delivery: 0 });
});

test("validation: invalid locale rejected", async () => {
  for (const locale of ["fr", "", "EN", null]) await placeRejected([line("it-retro-regular")], "invalid_locale", { locale });
});

test("validation: oversized fields rejected (customer fields, notes, personalization)", async () => {
  const base = customer();
  const over = [
    [{ ...base, name: "N".repeat(61) }, "invalid_customer"],
    [{ ...base, address: "A".repeat(161) }, "invalid_customer"],
    [{ ...base, city: "C".repeat(41) }, "invalid_customer"],
    [{ ...base, notes: "n".repeat(501) }, "invalid_customer"],
    [{ ...base, email: `${"e".repeat(250)}@example.test` }, "invalid_customer"],
    [{ ...base, phone: "0".repeat(19) }, "invalid_customer"],
  ];
  for (const [cust, error] of over) await placeRejected([line("it-retro-regular")], error, { customer: cust });
  await placeRejected([line("it-retro-regular", { personalization: { name: "ABCDEFGHIJKLMNO" } })], "invalid_personalization");
  await placeRejected([line("it-retro-regular", { personalization: { number: "123" } })], "invalid_personalization");
  // Boundary: exactly at the limits is accepted.
  const { order } = await placeOk([line("it-retro-regular", { personalization: { name: "ABCDEFGHIJKLMN", number: "99" } })], {
    customer: { ...base, name: "N".repeat(60), address: "A".repeat(160), notes: "n".repeat(500) },
  });
  assert.equal(order.customer.name.length, 60);
});

test("validation: unknown, draft and archived products rejected (product_unavailable)", async () => {
  for (const id of ["it-does-not-exist", "it-draft", "it-archived"]) await placeRejected([line(id)], "product_unavailable");
});
