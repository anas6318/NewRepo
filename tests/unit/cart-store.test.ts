/**
 * Cart-line store logic (A1-B1..B4): merge-on-re-add refresh, the shared
 * quantity cap, and malformed/stale localStorage recovery. The functions
 * under test live in src/lib/schema.ts (not the .tsx store module) so they
 * can be imported directly by the plain node:test runner — see the comment
 * in src/services/store.tsx.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampQuantity, hasValidCartLineShape, mergeCartLine, sanitizeCartLines } from "../../src/lib/schema.ts";
import { MAX_LINE_QUANTITY } from "../../src/lib/pricing.ts";
import type { CartLine } from "../../src/services/types.ts";

const NAME = { ar: "قميص", he: "חולצה", en: "Shirt" };

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    key: "p1|||L||",
    productId: "p1",
    slug: "p1-slug",
    title: NAME,
    image: "/demo/p1.webp",
    size: "L",
    quantity: 1,
    unitPriceIls: 100,
    qualifiesForFreeDelivery: true,
    isDemo: true,
    ...overrides,
  };
}

/* ── A1-B2/A1-B3: clampQuantity ───────────────────────────────────────── */

test("clampQuantity keeps in-range integers unchanged", () => {
  assert.equal(clampQuantity(1), 1);
  assert.equal(clampQuantity(5), 5);
  assert.equal(clampQuantity(MAX_LINE_QUANTITY), MAX_LINE_QUANTITY);
});

test("clampQuantity floors at 1, never removes via a low value", () => {
  assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(-5), 1);
});

test("clampQuantity caps at MAX_LINE_QUANTITY", () => {
  assert.equal(clampQuantity(11), MAX_LINE_QUANTITY);
  assert.equal(clampQuantity(999), MAX_LINE_QUANTITY);
});

test("clampQuantity rounds fractional input", () => {
  assert.equal(clampQuantity(2.4), 2);
  assert.equal(clampQuantity(2.6), 3);
});

/* ── A1-B1: mergeCartLine ─────────────────────────────────────────────── */

test("re-adding an identical configuration adds quantity and refreshes price", () => {
  const existing = line({
    quantity: 1,
    unitPriceIls: 170,
    price: { regularBasePriceIls: 170, versionAdjustmentIls: 0, optionAdjustmentsIls: 0, badgeAdjustmentIls: 0, regularUnitPriceIls: 170, saleDiscountIls: 0, finalUnitPriceIls: 170 },
  });
  // A sale started between the first and second add: the incoming line
  // carries the discounted price.
  const incoming: Omit<CartLine, "key"> = {
    ...line({
      quantity: 1,
      unitPriceIls: 136,
      price: { regularBasePriceIls: 170, versionAdjustmentIls: 0, optionAdjustmentsIls: 0, badgeAdjustmentIls: 0, regularUnitPriceIls: 170, saleDiscountIls: 34, finalUnitPriceIls: 136 },
    }),
  };
  const merged = mergeCartLine(existing, incoming);
  assert.equal(merged.key, existing.key, "the line identity never changes");
  assert.equal(merged.quantity, 2, "quantity is additive");
  assert.equal(merged.unitPriceIls, 136, "unitPriceIls is refreshed from the incoming line, not kept stale");
  assert.equal(merged.price?.saleDiscountIls, 34, "the price snapshot is refreshed too");
});

test("re-adding refreshes the badge snapshot from the incoming line", () => {
  const existing = line({ badge: { badgeId: "old", code: "old", name: NAME, label: "Old", priceIls: 5 } });
  const incoming = line({ badge: { badgeId: "new", code: "new", name: NAME, label: "New", priceIls: 12 } });
  const merged = mergeCartLine(existing, incoming);
  assert.equal(merged.badge?.badgeId, "new");
  assert.equal(merged.badge?.priceIls, 12);
});

test("merging caps the combined quantity at MAX_LINE_QUANTITY", () => {
  const existing = line({ quantity: 8 });
  const incoming = line({ quantity: 5 });
  const merged = mergeCartLine(existing, incoming);
  assert.equal(merged.quantity, MAX_LINE_QUANTITY);
});

/* ── A1-B4: hasValidCartLineShape / sanitizeCartLines ───────────────────── */

test("a well-formed line passes the shape check", () => {
  assert.equal(hasValidCartLineShape(line()), true);
});

test("non-array storage content is treated as an empty cart", () => {
  assert.deepEqual(sanitizeCartLines(undefined), []);
  assert.deepEqual(sanitizeCartLines(null), []);
  assert.deepEqual(sanitizeCartLines("garbage"), []);
  assert.deepEqual(sanitizeCartLines({ not: "an array" }), []);
  assert.deepEqual(sanitizeCartLines(42), []);
});

test("a malformed entry (missing required field) is dropped, valid ones survive", () => {
  const good = line({ key: "good" });
  const missingProductId = { ...line({ key: "bad1" }), productId: undefined };
  const nanPrice = { ...line({ key: "bad2" }), unitPriceIls: NaN };
  const badTitle = { ...line({ key: "bad3" }), title: "not localized" };
  const out = sanitizeCartLines([good, missingProductId, nanPrice, badTitle]);
  assert.deepEqual(out.map((l) => l.key), ["good"]);
});

test("a malformed nested price snapshot drops the line", () => {
  const badPrice = { ...line(), price: { regularBasePriceIls: 100 } }; // missing other required numeric keys
  assert.deepEqual(sanitizeCartLines([badPrice]), []);
});

test("a malformed nested badge snapshot drops the line", () => {
  const badBadge = { ...line(), badge: { badgeId: "x" } }; // missing code/name/label/priceIls
  assert.deepEqual(sanitizeCartLines([badBadge]), []);
});

test("an out-of-range quantity is clamped, not dropped", () => {
  const over = line({ key: "over", quantity: 999 });
  const under = line({ key: "under", quantity: -3 });
  const out = sanitizeCartLines([over, under]);
  assert.equal(out.find((l) => l.key === "over")?.quantity, MAX_LINE_QUANTITY);
  assert.equal(out.find((l) => l.key === "under")?.quantity, 1);
});

test("a line with no price/badge snapshot (never customized) is still valid", () => {
  const minimal = line();
  assert.deepEqual(sanitizeCartLines([minimal]).length, 1);
});

test("sanitizing never renders ₪NaN: every surviving unitPriceIls is finite", () => {
  const junk = [line({ key: "ok" }), { hello: "world" }, 12345, null, { ...line({ key: "bad" }), unitPriceIls: "not a number" }];
  const out = sanitizeCartLines(junk);
  assert.ok(out.every((l) => Number.isFinite(l.unitPriceIls)));
  assert.deepEqual(out.map((l) => l.key), ["ok"]);
});
