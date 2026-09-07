/**
 * Configurable product sales — the contract the storefront resolver and the
 * place-order edge function both implement.
 *
 * Every price here comes from configuration. Nothing in the application may
 * assume a discount, and the regular price is never rewritten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIMEZONE,
  discountableAmount,
  isDiscounting,
  percentLabel,
  priceValidUntil,
  productDiscountable,
  resolveProductSale,
  resolveSale,
  saleLabelIn,
  saleStatus,
  validateSale,
} from "../../src/lib/sales.ts";
import { priceLine, priceSnapshot, cartSubtotal } from "../../src/lib/pricing.ts";
import type { Product, SaleConfig } from "../../src/services/types.ts";

const L = (ar: string, he: string, en: string) => ({ ar, he, en });

/** Fixed instants so nothing here depends on when the suite runs. */
const NOW = Date.parse("2026-08-06T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const RUNNING = { startsAt: at(-2 * DAY), endsAt: at(5 * DAY) };

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    slug: "sale-shirt",
    categorySlug: "current-season",
    name: L("قميص", "חולצה", "Shirt"),
    description: L("", "", ""),
    details: L("", "", ""),
    seoTitle: L("", "", ""),
    seoDescription: L("", "", ""),
    status: "made_to_order",
    basePriceIls: 140,
    versions: [
      { version: "fan", adjustmentIls: 0 },
      { version: "player", adjustmentIls: 20 },
    ],
    sleeves: ["short"],
    longSleeveAdjustmentIls: 0,
    sizes: ["S", "M", "L"],
    personalizable: true,
    patchIds: [],
    qualifiesForFreeDelivery: true,
    featured: false,
    images: [],
    relatedSlugs: [],
    tags: [],
    rightsStatus: "cleared",
    isDemo: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ── 1–3. the three sale types calculate correctly ────────────────────── */

test("a percentage sale calculates correctly", () => {
  const sale: SaleConfig = { enabled: true, type: "percentage", percentOff: 20, ...RUNNING };
  const resolved = resolveSale(sale, 140, NOW);
  assert.equal(resolved?.status, "active");
  assert.equal(resolved?.discountIls, 28);
  assert.equal(priceLine({ basePriceIls: 140, sale: resolved, quantity: 1 }).unitPriceIls, 112);
});

test("a fixed-amount sale calculates correctly", () => {
  const sale: SaleConfig = { enabled: true, type: "fixed_amount", amountOffIls: 15, ...RUNNING };
  const resolved = resolveSale(sale, 140, NOW);
  assert.equal(resolved?.discountIls, 15);
  assert.equal(priceLine({ basePriceIls: 140, sale: resolved, quantity: 1 }).unitPriceIls, 125);
});

test("a fixed-price sale calculates correctly", () => {
  const sale: SaleConfig = { enabled: true, type: "fixed_price", salePriceIls: 119, ...RUNNING };
  const resolved = resolveSale(sale, 140, NOW);
  assert.equal(resolved?.discountIls, 21);
  assert.equal(priceLine({ basePriceIls: 140, sale: resolved, quantity: 1 }).unitPriceIls, 119);
});

/* ── 4. the regular price is never overwritten ────────────────────────── */

test("a sale never overwrites the regular price", () => {
  const product = makeProduct({ sale: { enabled: true, type: "percentage", percentOff: 20, ...RUNNING } });
  const before = product.basePriceIls;
  const resolved = resolveProductSale(product, NOW);
  const line = priceLine({ basePriceIls: product.basePriceIls, sale: resolved, quantity: 1 });

  assert.equal(product.basePriceIls, before, "the stored regular price is untouched");
  assert.equal(line.regularUnitPriceIls, 140, "the struck-through figure is the real regular price");
  assert.equal(line.unitPriceIls, 112);

  // Switching the sale off restores the regular price with no other change.
  const off = makeProduct({ ...product, sale: { ...product.sale!, enabled: false } });
  assert.equal(priceLine({ basePriceIls: off.basePriceIls, sale: resolveProductSale(off, NOW), quantity: 1 }).unitPriceIls, 140);
});

/* ── 5–8. schedule ────────────────────────────────────────────────────── */

test("a future sale is not active", () => {
  const sale: SaleConfig = { enabled: true, type: "percentage", percentOff: 20, startsAt: at(DAY), endsAt: at(5 * DAY) };
  assert.equal(saleStatus(sale, 140, NOW), "scheduled");
  assert.equal(priceLine({ basePriceIls: 140, sale: resolveSale(sale, 140, NOW), quantity: 1 }).unitPriceIls, 140);
});

test("a scheduled sale is hidden entirely unless the owner opts in", () => {
  const hidden: SaleConfig = { enabled: true, type: "percentage", percentOff: 20, startsAt: at(DAY) };
  assert.equal(resolveSale(hidden, 140, NOW), undefined);

  const announced = resolveSale({ ...hidden, showBeforeStart: true }, 140, NOW);
  assert.equal(announced?.status, "scheduled");
  assert.equal(announced?.discountIls, 0, "no discount is ever shown before the start");
});

test("an active sale applies", () => {
  const sale: SaleConfig = { enabled: true, type: "percentage", percentOff: 20, ...RUNNING };
  assert.equal(saleStatus(sale, 140, NOW), "active");
  assert.ok(isDiscounting(resolveSale(sale, 140, NOW)));
});

test("an expired sale does not apply and shows nothing", () => {
  const sale: SaleConfig = { enabled: true, type: "percentage", percentOff: 20, startsAt: at(-10 * DAY), endsAt: at(-DAY) };
  assert.equal(saleStatus(sale, 140, NOW), "expired");
  assert.equal(resolveSale(sale, 140, NOW), undefined, "an ended sale simply stops existing");
  assert.equal(priceLine({ basePriceIls: 140, sale: resolveSale(sale, 140, NOW), quantity: 1 }).unitPriceIls, 140);
});

test("start is inclusive and end is exclusive, consistently", () => {
  const sale: SaleConfig = { enabled: true, type: "percentage", percentOff: 20, startsAt: at(0), endsAt: at(DAY) };
  assert.equal(saleStatus(sale, 140, NOW - 1), "scheduled", "one millisecond before the start");
  assert.equal(saleStatus(sale, 140, NOW), "active", "exactly at the start → active");
  assert.equal(saleStatus(sale, 140, NOW + DAY - 1), "active", "one millisecond before the end");
  assert.equal(saleStatus(sale, 140, NOW + DAY), "expired", "exactly at the end → over");
});

test("open-ended schedules behave sensibly", () => {
  assert.equal(saleStatus({ enabled: true, type: "percentage", percentOff: 10 }, 140, NOW), "active", "no dates → runs until switched off");
  assert.equal(saleStatus({ enabled: true, type: "percentage", percentOff: 10, endsAt: at(DAY) }, 140, NOW), "active");
  assert.equal(saleStatus({ enabled: true, type: "percentage", percentOff: 10, startsAt: at(-DAY) }, 140, NOW), "active");
});

/* ── 9. add-ons stay outside the sale unless enabled ──────────────────── */

test("the badge price is not discounted by default", () => {
  // The worked example from the brief: ₪140 fan shirt, 20% off, ₪10 badge.
  const sale = resolveSale({ enabled: true, type: "percentage", percentOff: 20, ...RUNNING }, 140, NOW);
  const line = priceLine({ basePriceIls: 140, badgePriceIls: 10, sale, quantity: 1 });
  assert.equal(line.regularUnitPriceIls, 150);
  assert.equal(line.saleDiscountIls, 28, "20% of ₪140, not of ₪150");
  assert.equal(line.unitPriceIls, 122);
});

test("add-ons are discounted only when the owner explicitly enables it", () => {
  const config: SaleConfig = { enabled: true, type: "percentage", percentOff: 20, includeAddOns: true, ...RUNNING };
  const discountable = discountableAmount({ basePriceIls: 140, badgePriceIls: 10 }, true);
  assert.equal(discountable, 150);
  const line = priceLine({ basePriceIls: 140, badgePriceIls: 10, sale: resolveSale(config, discountable, NOW), quantity: 1 });
  assert.equal(line.saleDiscountIls, 30, "20% of ₪150");
  assert.equal(line.unitPriceIls, 120);
});

test("the version adjustment is inside the sale; the long-sleeve upcharge is not", () => {
  const product = makeProduct({ longSleeveAdjustmentIls: 15, sale: { enabled: true, type: "percentage", percentOff: 20, ...RUNNING } });
  const discountable = productDiscountable(product, "player");
  assert.equal(discountable, 160, "base 140 + player 20");
  const line = priceLine({
    basePriceIls: 140,
    versionAdjustmentIls: 20,
    adjustmentsIls: [15],
    sale: resolveSale(product.sale, discountable, NOW),
    quantity: 1,
  });
  assert.equal(line.regularUnitPriceIls, 175);
  assert.equal(line.saleDiscountIls, 32, "20% of ₪160");
  assert.equal(line.unitPriceIls, 143);
});

/* ── 10. quantity ─────────────────────────────────────────────────────── */

test("quantity multiplies the final item price", () => {
  const sale = resolveSale({ enabled: true, type: "percentage", percentOff: 20, ...RUNNING }, 140, NOW);
  const line = priceLine({ basePriceIls: 140, badgePriceIls: 10, sale, quantity: 3 });
  assert.equal(line.unitPriceIls, 122);
  assert.equal(line.lineTotalIls, 366);
  assert.equal(cartSubtotal([{ lineTotalIls: line.lineTotalIls }, { lineTotalIls: 140 }]), 506);
});

/* ── 11. browser-submitted values are ignored ─────────────────────────── */

test("a sale price submitted by the browser cannot influence what is charged", () => {
  const product = makeProduct({ sale: { enabled: true, type: "percentage", percentOff: 20, ...RUNNING } });
  // A tampered payload: there is simply no parameter through which any of
  // this could reach the calculation.
  const tampered = { salePriceIls: 1, discountPercent: 99, discountIls: 139, saleActive: true, onSale: true };
  const resolved = resolveSale(product.sale, productDiscountable(product, "fan"), NOW);
  const line = priceLine({ basePriceIls: product.basePriceIls, sale: resolved, quantity: 1 });
  assert.equal(line.unitPriceIls, 112, "the configured 20%, not the submitted 99%");
  assert.notEqual(line.unitPriceIls, tampered.salePriceIls);
});

test("an expired sale cannot be revived by a client claiming it is active", () => {
  const expired: SaleConfig = { enabled: true, type: "percentage", percentOff: 50, startsAt: at(-10 * DAY), endsAt: at(-DAY) };
  const resolved = resolveSale(expired, 140, NOW);
  assert.equal(resolved, undefined);
  // Even handed a hand-built "active" object, pricing clamps to the amount
  // that was actually resolved against the line.
  const forged = { status: "active" as const, type: "percentage" as const, value: 50, discountIls: 999, label: L("", "", "x"), includeAddOns: false };
  assert.equal(priceLine({ basePriceIls: 140, sale: forged, quantity: 1 }).unitPriceIls, 0, "clamped to the discountable amount, never negative");
});

/* ── 12. order snapshots are immutable ────────────────────────────────── */

test("an existing order snapshot does not change after the sale is edited", () => {
  const sale = resolveSale({ enabled: true, type: "percentage", percentOff: 20, ...RUNNING, autoPercentLabel: true }, 140, NOW);
  const opts = { basePriceIls: 140, badgePriceIls: 10, sale, quantity: 2 };
  const line = priceLine(opts);
  const snapshot = priceSnapshot(opts, line, "en", priceValidUntil(sale));
  const frozen = structuredClone(snapshot);

  assert.equal(snapshot.regularBasePriceIls, 140);
  assert.equal(snapshot.badgeAdjustmentIls, 10);
  assert.equal(snapshot.regularUnitPriceIls, 150);
  assert.equal(snapshot.saleType, "percentage");
  assert.equal(snapshot.saleValue, 20);
  assert.equal(snapshot.saleDiscountIls, 28);
  assert.equal(snapshot.finalUnitPriceIls, 122);
  assert.equal(snapshot.saleLabel, "20% off");
  assert.equal(snapshot.saleEndsAt, RUNNING.endsAt);

  // The owner now deepens the sale, renames it, then ends it entirely.
  const deeper = resolveSale({ enabled: true, type: "percentage", percentOff: 60, ...RUNNING, label: L("جديد", "חדש", "Bigger sale") }, 140, NOW);
  assert.equal(priceLine({ ...opts, sale: deeper }).unitPriceIls, 66, "new orders use the new sale");
  const ended = resolveSale({ enabled: false, type: "none" }, 140, NOW);
  assert.equal(priceLine({ ...opts, sale: ended }).unitPriceIls, 150, "and later none at all");

  assert.deepEqual(snapshot, frozen, "the stored snapshot never moved");
});

test("a line with no sale records a clean, honest snapshot", () => {
  const opts = { basePriceIls: 140, badgePriceIls: 10, quantity: 1 };
  const snapshot = priceSnapshot(opts, priceLine(opts), "en");
  assert.equal(snapshot.saleDiscountIls, 0);
  assert.equal(snapshot.saleType, undefined);
  assert.equal(snapshot.saleLabel, undefined);
  assert.equal(snapshot.finalUnitPriceIls, 150);
  assert.equal(snapshot.regularUnitPriceIls, 150);
});

/* ── 13. a sale is not an availability claim ──────────────────────────── */

test("a sale says nothing about supplier availability", () => {
  const product = makeProduct({
    sale: { enabled: true, type: "percentage", percentOff: 20, ...RUNNING },
    availability: { status: "confirmation_required" },
  });
  const resolved = resolveProductSale(product, NOW);
  assert.ok(isDiscounting(resolved), "the sale runs");
  assert.equal(product.availability?.status, "confirmation_required", "and availability is unaffected by it");
  // The sale resolver has no access to availability at all — the two systems
  // never read each other.
  assert.equal("availability" in (resolved ?? {}), false);
});

test("a held request records when the sale price stops being guaranteed", () => {
  const sale = resolveSale({ enabled: true, type: "percentage", percentOff: 20, ...RUNNING }, 140, NOW);
  assert.equal(priceValidUntil(sale), RUNNING.endsAt, "exactly the sale's own end — never an invented extension");
  const openEnded = resolveSale({ enabled: true, type: "percentage", percentOff: 20 }, 140, NOW);
  assert.equal(priceValidUntil(openEnded), undefined, "no end date → no expiry claim");
  assert.equal(priceValidUntil(undefined), undefined);
});

/* ── 14. trilingual labels ────────────────────────────────────────────── */

test("labels render naturally in Arabic, Hebrew and English", () => {
  const written = resolveSale({ enabled: true, type: "percentage", percentOff: 20, ...RUNNING, label: L("عرض لفترة محدودة", "מבצע לזמן מוגבל", "Limited-time offer") }, 140, NOW)!;
  assert.equal(saleLabelIn(written, "ar"), "عرض لفترة محدودة");
  assert.equal(saleLabelIn(written, "he"), "מבצע לזמן מוגבל");
  assert.equal(saleLabelIn(written, "en"), "Limited-time offer");

  const auto = resolveSale({ enabled: true, type: "percentage", percentOff: 20, ...RUNNING, autoPercentLabel: true }, 140, NOW)!;
  assert.equal(saleLabelIn(auto, "ar"), "خصم 20%");
  assert.equal(saleLabelIn(auto, "he"), "20% הנחה");
  assert.equal(saleLabelIn(auto, "en"), "20% off");

  const fallback = resolveSale({ enabled: true, type: "fixed_amount", amountOffIls: 15, ...RUNNING }, 140, NOW)!;
  assert.equal(saleLabelIn(fallback, "ar"), "تخفيض");
  assert.equal(saleLabelIn(fallback, "he"), "מבצע");
  assert.equal(saleLabelIn(fallback, "en"), "Sale");

  for (const locale of ["ar", "he", "en"] as const) {
    for (const s of [written, auto, fallback]) assert.doesNotMatch(saleLabelIn(s, locale), /undefined|\[object|NaN/);
  }
});

test("the automatic label states the true percentage for a fixed-amount sale", () => {
  const sale = resolveSale({ enabled: true, type: "fixed_amount", amountOffIls: 35, ...RUNNING, autoPercentLabel: true }, 140, NOW)!;
  assert.equal(sale.percentOff, 25);
  assert.equal(saleLabelIn(sale, "en"), "25% off");
  assert.equal(percentLabel(25).he, "25% הנחה");
});

/* ── validation ───────────────────────────────────────────────────────── */

test("invalid configurations are rejected, not silently applied", () => {
  const base = { enabled: true, ...RUNNING } as const;
  const cases: [SaleConfig, RegExp][] = [
    [{ ...base, type: "percentage", percentOff: -5 }, /greater than 0/],
    [{ ...base, type: "percentage", percentOff: 0 }, /greater than 0/],
    [{ ...base, type: "percentage", percentOff: 120 }, /more than 100/],
    [{ ...base, type: "fixed_amount", amountOffIls: -1 }, /greater than ₪0/],
    [{ ...base, type: "fixed_amount", amountOffIls: 200 }, /cannot be more than/],
    [{ ...base, type: "fixed_price", salePriceIls: 140 }, /must be below/],
    [{ ...base, type: "fixed_price", salePriceIls: 200 }, /must be below/],
    [{ ...base, type: "fixed_price", salePriceIls: -10 }, /cannot be negative/],
    [{ ...base, type: "percentage", percentOff: 20, startsAt: "not-a-date" }, /not a valid date/],
    [{ enabled: true, type: "percentage", percentOff: 20, startsAt: at(DAY), endsAt: at(0) }, /must end after it starts/],
  ];
  for (const [config, pattern] of cases) {
    const errors = validateSale(config, 140);
    assert.ok(errors.length > 0, `expected an error for ${JSON.stringify(config)}`);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${errors.join(" | ")}`);
    assert.equal(saleStatus(config, 140, NOW), "invalid");
    assert.equal(resolveSale(config, 140, NOW), undefined, "an invalid sale is treated exactly like no sale");
    assert.equal(priceLine({ basePriceIls: 140, sale: resolveSale(config, 140, NOW), quantity: 1 }).unitPriceIls, 140);
  }
});

test("a disabled or absent sale produces no errors and no discount", () => {
  assert.deepEqual(validateSale(undefined, 140), []);
  assert.deepEqual(validateSale({ enabled: false, type: "percentage", percentOff: 999 }, 140), [], "a switched-off sale is not validated");
  assert.equal(saleStatus(undefined, 140, NOW), "disabled");
  assert.equal(resolveSale(undefined, 140, NOW), undefined);
});

test("a 100% sale is allowed and floors at zero rather than going negative", () => {
  const sale = resolveSale({ enabled: true, type: "percentage", percentOff: 100, ...RUNNING }, 140, NOW);
  assert.equal(sale?.discountIls, 140);
  assert.equal(priceLine({ basePriceIls: 140, badgePriceIls: 10, sale, quantity: 1 }).unitPriceIls, 10, "the badge is still charged");
});

test("the default timezone is the store's, and schedules are stored in UTC", () => {
  assert.equal(DEFAULT_TIMEZONE, "Asia/Jerusalem");
  const sale: SaleConfig = { enabled: true, type: "percentage", percentOff: 20, startsAt: at(0), endsAt: at(DAY) };
  // Parsed as absolute instants: no local-time ambiguity anywhere.
  assert.ok(sale.startsAt!.endsWith("Z") && sale.endsAt!.endsWith("Z"));
  assert.equal(saleStatus(sale, 140, Date.parse(sale.startsAt!)), "active");
  assert.equal(saleStatus(sale, 140, Date.parse(sale.endsAt!)), "expired");
});

/* ── product-card resolution ──────────────────────────────────────────── */

test("a product card resolves the sale against the base price it displays", () => {
  const product = makeProduct({ sale: { enabled: true, type: "percentage", percentOff: 20, ...RUNNING } });
  const sale = resolveProductSale(product, NOW);
  assert.equal(sale?.discountIls, 28, "20% of the ₪140 the card shows");
  assert.equal(product.basePriceIls - sale!.discountIls, 112, "and the card's sale figure is reachable");

  // A product whose first version carries an adjustment must not have that
  // adjustment silently folded into the card's discount.
  const withAdjustment = makeProduct({
    versions: [{ version: "player", adjustmentIls: 20 }],
    sale: { enabled: true, type: "percentage", percentOff: 20, ...RUNNING },
  });
  assert.equal(resolveProductSale(withAdjustment, NOW)?.discountIls, 28, "still 20% of the base price the card shows");
  assert.equal(productDiscountable(withAdjustment, "player"), 160, "the product page still discounts base + version");
});
