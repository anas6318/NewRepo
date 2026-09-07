import { test } from "node:test";
import assert from "node:assert/strict";
import { priceLine, cartSubtotal, PricingError } from "../../src/lib/pricing.ts";

test("the badge adjustment is whatever the caller resolved — no built-in value", () => {
  // The ₪5 legacy price is data now; pricing simply applies what it is given.
  assert.equal(priceLine({ basePriceIls: 170, badgePriceIls: 5, quantity: 1 }).unitPriceIls, 175);
  assert.equal(priceLine({ basePriceIls: 170, badgePriceIls: 10, quantity: 1 }).unitPriceIls, 180);
  assert.equal(priceLine({ basePriceIls: 170, badgePriceIls: 0, quantity: 1 }).unitPriceIls, 170);
  assert.equal(priceLine({ basePriceIls: 170, quantity: 1 }).unitPriceIls, 170);
});

test("a negative badge adjustment is refused", () => {
  assert.throws(() => priceLine({ basePriceIls: 170, badgePriceIls: -5, quantity: 1 }), PricingError);
});

test("quantity multiplies the badge adjustment", () => {
  // (170 + 12) x 3
  assert.equal(priceLine({ basePriceIls: 170, badgePriceIls: 12, quantity: 3 }).lineTotalIls, 546);
});

test("name/number never affects price — no field for it exists", () => {
  assert.equal(priceLine({ basePriceIls: 140, quantity: 1 }).unitPriceIls, 140);
});

test("version adjustment applies (fan→player +20)", () => {
  assert.equal(priceLine({ basePriceIls: 140, adjustmentsIls: [20], quantity: 1 }).unitPriceIls, 160);
});

test("long-sleeve + badge stack correctly", () => {
  assert.equal(priceLine({ basePriceIls: 140, adjustmentsIls: [20, 15], badgePriceIls: 5, quantity: 2 }).lineTotalIls, 360);
});

test("quantity multiplies", () => {
  assert.equal(priceLine({ basePriceIls: 170, quantity: 3 }).lineTotalIls, 510);
});

test("cartSubtotal sums lines", () => {
  assert.equal(cartSubtotal([{ lineTotalIls: 510 }, { lineTotalIls: 175 }]), 685);
});

test("negative base price throws", () => {
  assert.throws(() => priceLine({ basePriceIls: -1, quantity: 1 }), PricingError);
});

test("negative adjusted price throws", () => {
  assert.throws(() => priceLine({ basePriceIls: 10, adjustmentsIls: [-20], quantity: 1 }), PricingError);
});

test("zero / fractional quantity throws", () => {
  assert.throws(() => priceLine({ basePriceIls: 100, quantity: 0 }), PricingError);
  assert.throws(() => priceLine({ basePriceIls: 100, quantity: 1.5 }), PricingError);
});

test("spec default prices land correctly", () => {
  for (const [base, expected] of [
    [140, 140],
    [160, 160],
    [170, 170],
    [175, 175],
    [250, 250],
  ] as const) {
    assert.equal(priceLine({ basePriceIls: base, quantity: 1 }).unitPriceIls, expected);
  }
});
