/**
 * Tamper suite for the order-creation security boundary.
 *
 * Calls the pure server core `validateAndPriceOrder` directly — the exact
 * function place-order runs — with realistic CROWNED product rows:
 *   Retro regular ₪169 + active Retro-only sale to ₪149 (S–2XL),
 *   current-season Fan ₪149 (S–4XL) / Player ₪179 (S–2XL),
 *   personalization free.
 * Every attack below sends what a hostile browser could send; the server
 * must either ignore it (price/total fields) or refuse the order.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_LIMITS,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  validateAndPriceOrder,
  type PricedOrder,
  type PricingResult,
} from "../../supabase/functions/_shared/order-pricing.ts";
import { CUSTOMER, SALE_END, body, db, line, promo, type OrderFixture, type Row } from "./fixtures/order-pricing-cases.ts";
import { pricingInput } from "./fixtures/order-pricing-input.ts";

const price = (b: unknown, fixture?: OrderFixture, nowIso?: string): PricingResult => validateAndPriceOrder(pricingInput(b, fixture, nowIso));

function ok(r: PricingResult): PricedOrder {
  if (!r.ok) assert.fail(`expected a priced order, got ${r.status} ${r.error}`);
  return r;
}
function rejected(r: PricingResult, error: string, status = 400) {
  assert.equal(r.ok, false, `expected ${error}`);
  if (!r.ok) {
    assert.equal(r.error, error);
    assert.equal(r.status, status);
  }
}
const item = (r: PricedOrder, i = 0) => r.items[i] as Row & { price: Row };

/** Everything a tampering client might attach to a line. */
const FAKE_LINE_PRICES = {
  unitPriceIls: 1,
  lineTotalIls: 1,
  basePriceIls: 1,
  regularUnitPriceIls: 1,
  finalUnitPriceIls: 1,
  versionAdjustmentIls: 0,
  badgePriceIls: 0,
  saleDiscountIls: 168,
  price: { regularBasePriceIls: 1, finalUnitPriceIls: 1, saleDiscountIls: 168 },
};

test("fake low unit / line price fields on a line are ignored", () => {
  const clean = ok(price(body([line("retro-1", { quantity: 2 })])));
  const forged = ok(price(body([line("retro-1", { quantity: 2, ...FAKE_LINE_PRICES })])));
  assert.equal(item(forged).unitPriceIls, 149);
  assert.equal(item(forged).lineTotalIls, 298);
  assert.deepEqual(forged.items, clean.items);
  assert.equal(forged.totalIls, clean.totalIls);
});

test("Player at Fan price: fan price fields with version=player are charged ₪179", () => {
  const r = ok(price(body([line("season-1", { version: "player", sleeve: "short", unitPriceIls: 149, versionAdjustmentIls: 0, price: { versionAdjustmentIls: 0, finalUnitPriceIls: 149 } })])));
  assert.equal(item(r).version, "player");
  assert.equal(item(r).unitPriceIls, 179);
  assert.equal(item(r).price.versionAdjustmentIls, 30);
});

test("manipulated Retro sale fields are ignored; the sale never reaches a non-Retro product", () => {
  const fakeSale = { sale: { enabled: true, type: "percentage", percentOff: 100 }, saleDiscountIls: 169, finalUnitPriceIls: 0, onSale: true, salePriceIls: 1 };
  const retro = ok(price(body([line("retro-1", fakeSale)])));
  assert.equal(item(retro).unitPriceIls, 149, "Retro stays at its real sale price");
  assert.equal(item(retro).price.saleDiscountIls, 20);

  // Retro-only sale: the current-season product has no sale configured, so
  // client sale fields cannot create one.
  const fan = ok(price(body([line("season-1", { version: "fan", sleeve: "short", ...fakeSale })])));
  assert.equal(item(fan).unitPriceIls, 149);
  assert.equal(item(fan).price.saleDiscountIls, 0);
  assert.equal(item(fan).price.saleType, undefined);
  const player = ok(price(body([line("season-1", { version: "player", sleeve: "short", ...fakeSale })])));
  assert.equal(item(player).unitPriceIls, 179);
  assert.equal(item(player).price.saleDiscountIls, 0);
});

test("invalid version is refused — on a versioned product and on one without versions", () => {
  rejected(price(body([line("season-1", { version: "legend", sleeve: "short" })])), "invalid_version");
  rejected(price(body([line("season-1", { version: 1, sleeve: "short" })])), "invalid_version");
  rejected(price(body([line("retro-2", { version: "player" })])), "invalid_version");
  // Absent / empty is fine for a product without versions.
  ok(price(body([line("retro-2", { version: "" })])));
  ok(price(body([line("retro-2")])));
});

test("Player + 4XL is rejected; Fan + 4XL is accepted where configured", () => {
  rejected(price(body([line("season-1", { version: "player", sleeve: "short", size: "4XL" })])), "invalid_size");
  rejected(price(body([line("season-1", { version: "player", sleeve: "short", size: "3XL" })])), "invalid_size");
  const fan = ok(price(body([line("season-1", { version: "fan", sleeve: "short", size: "4XL" })])));
  assert.equal(item(fan).size, "4XL");
  assert.equal(item(fan).unitPriceIls, 149);
  // Retro is S–2XL only.
  rejected(price(body([line("retro-1", { size: "4XL" })])), "invalid_size");
});

test("fake free / extra badge: unknown, disabled, drifted or price-forged badges never go through cheaply", () => {
  rejected(price(body([line("retro-1", { badgeId: "free-badge" })])), "invalid_badge");
  rejected(price(body([line("retro-1", { badgeId: "old" })])), "invalid_badge");
  rejected(price(body([line("drift-badge", { badgeId: "drift" })])), "invalid_badge");
  // A badge the product does not enable.
  rejected(price(body([line("season-1", { version: "fan", sleeve: "short", badgeId: "ucl" })])), "invalid_badge");
  // A price field on the badge is ignored; the catalog price applies.
  const r = ok(price(body([line("retro-1", { badgeId: "pl", badgePriceIls: 0, badge: { badgeId: "pl", priceIls: 0 }, patchPriceIls: 0 })])));
  assert.equal((item(r).badge as Row).priceIls, 10);
  assert.equal(item(r).unitPriceIls, 159);
  // One badge per line: a second id in `patchId` cannot add another.
  const two = ok(price(body([line("retro-1", { badgeId: "pl", patchId: "ucl" })])));
  assert.equal((item(two).badge as Row).badgeId, "pl");
  assert.equal(item(two).price.badgeAdjustmentIls, 10);
});

test("fake discount / promotion fields are ignored", () => {
  const fake = {
    promotion: { promotionId: "p1", discountIls: 500 },
    promotionDiscountIls: 500,
    discountCode: "FREE100",
    discountIls: 500,
  };
  const none = ok(price(body([line("made-1", { quantity: 2, promotionDiscountIls: 100, discountIls: 100 })], fake)));
  assert.equal(none.promotion, undefined);
  assert.equal(none.promotionDiscountIls, 0);
  assert.equal(none.subtotalIls, 298);
  assert.equal(none.totalIls, 298 + 35, "2 × ₪149 plus delivery (2 items < free-delivery threshold 3)");
});

test("fake free shipping / zone price is ignored", () => {
  const r = ok(price(body([line("made-1")], { freeDelivery: true, deliveryIls: 0, zone: { id: "north", priceIls: 0 }, freeDeliveryMinItems: 1, shippingIls: 0 })));
  assert.equal(r.freeDelivery, false);
  assert.equal(r.deliveryIls, 35);
  assert.equal(r.totalIls, 184);
  // An inactive or unknown zone cannot be used at any price.
  rejected(price(body([line("made-1")], { zoneId: "eilat" })), "zone_unavailable");
  rejected(price(body([line("made-1")], { zoneId: { id: "north", priceIls: 0 } })), "zone_unavailable");
});

test("quantity must be an integer 1..MAX_LINE_QUANTITY: 0, -1, 1.5, \"2\", 11, 1e9, null are refused", () => {
  assert.equal(MAX_LINE_QUANTITY, 10);
  for (const q of [0, -1, 1.5, "2", 11, 1e9, null, true, [2]]) {
    rejected(price(body([line("retro-1", { quantity: q })])), "invalid_quantity");
  }
  const max = ok(price(body([line("retro-1", { quantity: MAX_LINE_QUANTITY })])));
  assert.equal(item(max).lineTotalIls, 1490);
});

test("31 lines are refused; 30 are accepted", () => {
  assert.equal(MAX_ORDER_LINES, 30);
  rejected(price(body(Array.from({ length: MAX_ORDER_LINES + 1 }, () => line("made-1")))), "too_many_lines");
  ok(price(body(Array.from({ length: MAX_ORDER_LINES }, () => line("made-1")))));
});

test("altered subtotal / delivery / total are ignored — server totals win", () => {
  const r = ok(price(body([line("retro-1"), line("made-1")], { subtotalIls: 1, deliveryIls: 0, totalIls: 1, total: 1, merchandiseIls: 1 })));
  assert.equal(r.subtotalIls, 298);
  assert.equal(r.deliveryIls, 35);
  assert.equal(r.totalIls, 333);
});

test("stale snapshot: a client-sent old price is ignored both ways", () => {
  // Cart saved before the sale opened (₪169) — the current sale applies.
  const during = ok(price(body([line("retro-1", { unitPriceIls: 169, price: { finalUnitPriceIls: 169, saleDiscountIls: 0 } })])));
  assert.equal(item(during).unitPriceIls, 149);
  // Cart saved during the sale (₪149) but submitted after it ended — ₪169.
  const after = ok(price(body([line("retro-1", { unitPriceIls: 149, price: { finalUnitPriceIls: 149, saleDiscountIls: 20 } })]), db(), SALE_END));
  assert.equal(item(after).unitPriceIls, 169);
  assert.equal(item(after).price.saleDiscountIls, 0);
});

test("extra customer and personalization keys are dropped", () => {
  const r = ok(
    price(
      body([line("retro-2", { personalization: { name: "DANA", number: "7", priceIls: -50, __proto__x: 1, html: "<b>x</b>" } })], {
        customer: { ...CUSTOMER, isAdmin: true, role: "owner", customerId: "someone-else", totalIls: 0 },
      }),
    ),
  );
  assert.deepEqual(Object.keys(r.customer).sort(), ["address", "city", "email", "name", "phone"]);
  assert.deepEqual(item(r).personalization, { name: "DANA", number: "7" });
});

test("over-length or malformed customer / personalization fields are refused", () => {
  const L = CUSTOMER_LIMITS;
  const bad: Row[] = [
    { name: "x".repeat(L.nameMax + 1) },
    { name: "x" },
    { email: `${"a".repeat(L.emailMax)}@example.com` },
    { phone: "1".repeat(19) },
    { city: "c".repeat(L.cityMax + 1) },
    { address: "a".repeat(L.addressMax + 1) },
    { notes: "n".repeat(L.notesMax + 1) },
    { notes: 42 },
    { name: 12345 },
  ];
  for (const patch of bad) rejected(price(body([line("retro-2")], { customer: { ...CUSTOMER, ...patch } })), "invalid_customer");
  for (const p of [{ name: "ABCDEFGHIJKLMNO" }, { name: "<script>" }, { number: "123" }, { number: 7 }, "DANA", ["DANA"]]) {
    rejected(price(body([line("retro-2", { personalization: p })])), "invalid_personalization");
  }
});

test("personalization is free — it never changes a price", () => {
  const plain = ok(price(body([line("retro-2", { quantity: 3 })])));
  const named = ok(price(body([line("retro-2", { quantity: 3, personalization: { name: "Salah", number: "11" } })])));
  assert.equal(item(named).unitPriceIls, item(plain).unitPriceIls);
  assert.equal(named.totalIls, plain.totalIls);
  assert.deepEqual(item(named).price, item(plain).price);
});

test("a promotion is recomputed from the stored campaign, not the request", () => {
  const fixture = db({ promotions: [promo("p1", 10)] });
  const r = ok(price(body([line("made-1", { quantity: 2 })], { promotion: { discountPercent: 100 }, promotionDiscountIls: 298 }), fixture));
  assert.equal(r.promotionDiscountIls, 22.35); // 15% of one ₪149 unit
  assert.equal(r.totalIls, 298 - 22.35 + 35);
});
