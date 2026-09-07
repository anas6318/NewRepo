/**
 * Cart promotions — the contract the storefront resolver and the place-order
 * edge function both implement.
 *
 * Every number here comes from configuration. Nothing in the application may
 * assume a campaign exists, and grouping never depends on cart order.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activePromotion,
  DEFAULT_PROMOTION_LABEL,
  isEligibleProduct,
  isPromotionApplied,
  merchandiseUnitValue,
  promotionLabelIn,
  promotionSnapshot,
  promotionStatus,
  PROMOTION_DEFAULTS,
  resolvePromotion,
  validatePromotion,
  type PromotionLine,
} from "../../src/lib/promotions.ts";
import type { PromotionConfig } from "../../src/services/types.ts";

const L = (ar: string, he: string, en: string) => ({ ar, he, en });

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const RUNNING = { startsAt: at(-2 * DAY), endsAt: at(5 * DAY) };

function campaign(overrides: Partial<PromotionConfig> = {}): PromotionConfig {
  return {
    id: "second-item",
    type: "second_item_percentage",
    enabled: true,
    discountPercent: 15,
    minimumQuantity: 2,
    repeatPerPair: true,
    stackWithProductSales: false,
    label: DEFAULT_PROMOTION_LABEL,
    sortOrder: 10,
    ...RUNNING,
    ...overrides,
  };
}

let seq = 0;
function line(merchandiseUnitIls: number, overrides: Partial<PromotionLine> = {}): PromotionLine {
  seq += 1;
  const id = overrides.productId ?? `p${seq}`;
  return {
    lineKey: overrides.lineKey ?? `k${seq}`,
    productId: id,
    slug: overrides.slug ?? id,
    title: L(id, id, id),
    quantity: 1,
    merchandiseUnitIls,
    hasProductSale: false,
    ...overrides,
  };
}

const run = (lines: PromotionLine[], c: PromotionConfig = campaign()) => resolvePromotion([c], lines, NOW);

/* ── 1–4. group sizes ─────────────────────────────────────────────────── */

test("one eligible item earns no discount", () => {
  const r = run([line(140)]);
  assert.equal(r?.eligibleUnits, 1);
  assert.equal(r?.discountedUnits, 0);
  assert.equal(r?.discountIls, 0);
  assert.equal(isPromotionApplied(r), false);
  assert.equal(r?.unitsToNextDiscount, 1, "one more unit unlocks it");
});

test("two eligible items discount the cheaper one by 15%", () => {
  // Example A from the brief: ₪140 + ₪120 → ₪242.
  const r = run([line(140), line(120)]);
  assert.equal(r?.discountedUnits, 1);
  assert.equal(r?.discountIls, 18, "15% of ₪120, the cheaper item");
  assert.equal(r?.originalMerchandiseIls, 260);
  assert.equal(r?.finalMerchandiseIls, 242);
  assert.equal(r?.allocations[0]?.unitMerchandiseIls, 120);
});

test("three eligible items still create only one discounted item", () => {
  const r = run([line(140), line(130), line(120)]);
  assert.equal(r?.discountedUnits, 1);
  assert.equal(r?.allocations[0]?.unitMerchandiseIls, 130, "cheaper of the top pair");
  assert.equal(r?.discountIls, 19.5);
  assert.equal(r?.unitsToNextDiscount, 1);
});

test("four eligible items create two discounted items", () => {
  // Example B: 140/130/120/100 → pairs (140,130) and (120,100).
  const r = run([line(140), line(130), line(120), line(100)]);
  assert.equal(r?.discountedUnits, 2);
  assert.deepEqual(
    r?.allocations.map((a) => a.unitMerchandiseIls).sort((a, b) => b - a),
    [130, 100],
  );
  assert.equal(r?.discountIls, round2(130 * 0.15 + 100 * 0.15));
  assert.equal(r?.unitsToNextDiscount, 2, "a whole new pair is needed");
});

test("five and six eligible items follow the same rule", () => {
  const five = run([line(140), line(130), line(120), line(110), line(100)]);
  assert.equal(five?.discountedUnits, 2);
  const six = run([line(140), line(130), line(120), line(110), line(100), line(90)]);
  assert.equal(six?.discountedUnits, 3);
});

/* ── 5. quantity counts as units ──────────────────────────────────────── */

test("quantity 2 of one product qualifies as two items", () => {
  const r = run([line(120, { quantity: 2 })]);
  assert.equal(r?.eligibleUnits, 2, "units, not lines");
  assert.equal(r?.discountedUnits, 1);
  assert.equal(r?.discountIls, 18);
  assert.equal(r?.allocations[0]?.lineKey, "k" + seq, "the discount is attributed to that line");
});

test("quantity 4 of one product earns two discounts", () => {
  const r = run([line(100, { quantity: 4 })]);
  assert.equal(r?.eligibleUnits, 4);
  assert.equal(r?.discountedUnits, 2);
  assert.equal(r?.discountIls, 30);
  assert.equal(Object.values(r!.discountByLineKey)[0], 30, "both discounts land on the one line");
});

/* ── 6–7. eligibility and exclusions ──────────────────────────────────── */

test("ineligible products do not count at all", () => {
  const c = campaign({ eligibleProductIds: ["yes-1", "yes-2"] });
  const r = run([line(140, { productId: "yes-1" }), line(120, { productId: "no-1" })], c);
  assert.equal(r?.eligibleUnits, 1, "the ineligible unit is not counted");
  assert.equal(r?.discountedUnits, 0);
  assert.equal(r?.discountIls, 0);
});

test("category eligibility widens the campaign", () => {
  const c = campaign({ eligibleCategorySlugs: ["retro"] });
  const r = run([line(140, { categorySlug: "retro" }), line(120, { categorySlug: "retro" }), line(90, { categorySlug: "kids" })], c);
  assert.equal(r?.eligibleUnits, 2);
  assert.equal(r?.discountIls, 18);
});

test("excluded products never count, even when otherwise eligible", () => {
  const c = campaign({ eligibleProductIds: ["a", "b"], excludedProductIds: ["b"] });
  const r = run([line(140, { productId: "a" }), line(120, { productId: "b" })], c);
  assert.equal(r?.eligibleUnits, 1);
  assert.equal(r?.discountIls, 0);
  assert.equal(isEligibleProduct(c, { productId: "b", slug: "b" }), false);
  assert.equal(isEligibleProduct(c, { productId: "a", slug: "a" }), true);
});

test("with no lists configured every product participates", () => {
  const c = campaign();
  assert.equal(isEligibleProduct(c, { productId: "anything", slug: "anything" }), true);
});

/* ── 8–10. only merchandise participates ──────────────────────────────── */

test("badge charges are outside the promotion", () => {
  // ₪140 shirt + ₪10 badge → the unit's merchandise value is ₪140.
  const value = merchandiseUnitValue({ finalUnitPriceIls: 150, badgeAdjustmentIls: 10 }, 150);
  assert.equal(value, 140);
  const r = run([line(140), line(value)]);
  assert.equal(r?.discountIls, 21, "15% of ₪140, never of ₪150");
});

test("personalization is free here and so cannot be discounted", () => {
  // Name/number adds nothing to the unit price, so the merchandise value of
  // a personalized unit equals that of a plain one.
  const plain = merchandiseUnitValue({ finalUnitPriceIls: 140, badgeAdjustmentIls: 0 }, 140);
  const personalized = merchandiseUnitValue({ finalUnitPriceIls: 140, badgeAdjustmentIls: 0 }, 140);
  assert.equal(plain, personalized);
});

test("delivery is never part of a line and so never enters the calculation", () => {
  const r = run([line(140), line(120)]);
  // The result describes merchandise only; there is no delivery input at all.
  assert.equal(r?.originalMerchandiseIls, 260);
  assert.equal("deliveryIls" in (r ?? {}), false);
});

/* ── 11–12. stacking with product sales ───────────────────────────────── */

test("stacking defaults to off, and a sale item is not also promoted", () => {
  assert.equal(PROMOTION_DEFAULTS.stackWithProductSales, false);
  // Cheaper unit is already on sale → the discount moves to the other unit
  // of the same pair rather than double-discounting or vanishing.
  const r = run([line(140), line(120, { hasProductSale: true })]);
  assert.equal(r?.discountedUnits, 1);
  assert.equal(r?.allocations[0]?.unitMerchandiseIls, 140, "moved to the un-discounted unit");
  assert.equal(r?.discountIls, 21);
});

test("a pair where every unit is already on sale earns nothing", () => {
  const r = run([line(140, { hasProductSale: true }), line(120, { hasProductSale: true })]);
  assert.equal(r?.eligibleUnits, 2, "they still count toward the quantity");
  assert.equal(r?.discountedUnits, 0, "but no discount is fabricated");
  assert.equal(r?.discountIls, 0);
});

test("with stacking enabled the cheaper unit is discounted even when on sale", () => {
  const c = campaign({ stackWithProductSales: true });
  const r = run([line(140), line(120, { hasProductSale: true })], c);
  assert.equal(r?.allocations[0]?.unitMerchandiseIls, 120);
  assert.equal(r?.discountIls, 18, "15% of the already-reduced ₪120");
});

/* ── 13–15. schedule ──────────────────────────────────────────────────── */

test("a future campaign does not apply", () => {
  const c = campaign({ startsAt: at(DAY), endsAt: at(5 * DAY) });
  assert.equal(promotionStatus(c, NOW), "scheduled");
  assert.equal(resolvePromotion([c], [line(140), line(120)], NOW), undefined);
});

test("an expired campaign does not apply", () => {
  const c = campaign({ startsAt: at(-10 * DAY), endsAt: at(-DAY) });
  assert.equal(promotionStatus(c, NOW), "expired");
  assert.equal(resolvePromotion([c], [line(140), line(120)], NOW), undefined);
});

test("an active campaign applies, and boundaries are start-inclusive/end-exclusive", () => {
  const c = campaign({ startsAt: at(0), endsAt: at(DAY) });
  assert.equal(promotionStatus(c, NOW - 1), "scheduled");
  assert.equal(promotionStatus(c, NOW), "running", "exactly at the start");
  assert.equal(promotionStatus(c, NOW + DAY - 1), "running");
  assert.equal(promotionStatus(c, NOW + DAY), "expired", "exactly at the end");
});

test("a disabled campaign is invisible, and it ships disabled", () => {
  assert.equal(PROMOTION_DEFAULTS.enabled, false);
  assert.equal(promotionStatus(campaign({ enabled: false }), NOW), "disabled");
  assert.equal(resolvePromotion([campaign({ enabled: false })], [line(140), line(120)], NOW), undefined);
  assert.equal(resolvePromotion(undefined, [line(140), line(120)], NOW), undefined);
  assert.equal(resolvePromotion([], [line(140), line(120)], NOW), undefined);
});

test("an invalid campaign is treated exactly like no campaign", () => {
  for (const bad of [
    campaign({ discountPercent: 0 }),
    campaign({ discountPercent: 120 }),
    campaign({ discountPercent: -5 }),
    campaign({ minimumQuantity: 1 }),
    campaign({ minimumQuantity: 2.5 }),
    campaign({ label: L("", "", "English only") }),
    campaign({ startsAt: "nonsense" }),
    campaign({ startsAt: at(DAY), endsAt: at(0) }),
  ]) {
    assert.ok(validatePromotion(bad).length > 0, `expected errors for ${JSON.stringify(bad.id)}`);
    assert.equal(promotionStatus(bad, NOW), "invalid");
    assert.equal(resolvePromotion([bad], [line(140), line(120)], NOW), undefined);
  }
  assert.deepEqual(validatePromotion(campaign()), []);
  assert.deepEqual(validatePromotion(campaign({ enabled: false, discountPercent: 999 })), [], "a switched-off campaign is not validated");
});

/* ── 16–17. determinism and server parity ─────────────────────────────── */

test("the result never depends on the order items were added to the cart", () => {
  const values = [140, 100, 130, 120];
  const base = values.map((v, i) => line(v, { productId: `fixed-${i}`, slug: `fixed-${i}`, lineKey: `fixed-${i}` }));
  const forward = resolvePromotion([campaign()], base, NOW);
  const reversed = resolvePromotion([campaign()], [...base].reverse(), NOW);
  const shuffled = resolvePromotion([campaign()], [base[2]!, base[0]!, base[3]!, base[1]!], NOW);

  assert.equal(forward?.discountIls, reversed?.discountIls);
  assert.equal(forward?.discountIls, shuffled?.discountIls);
  assert.deepEqual(forward?.allocations, reversed?.allocations);
  assert.deepEqual(forward?.allocations, shuffled?.allocations);
});

test("equal prices still resolve deterministically", () => {
  const a = line(120, { productId: "aaa", slug: "aaa", lineKey: "aaa" });
  const b = line(120, { productId: "bbb", slug: "bbb", lineKey: "bbb" });
  const one = resolvePromotion([campaign()], [a, b], NOW);
  const two = resolvePromotion([campaign()], [b, a], NOW);
  assert.deepEqual(one?.allocations, two?.allocations);
  assert.equal(one?.discountIls, 18);
});

test("a browser-submitted discount cannot influence the result", () => {
  // There is no parameter through which any of this could be read: the
  // resolver takes configuration and merchandise values only.
  const forged = { promotionApplied: true, discountIls: 999, discountPercent: 90, discountedItemId: "p1" };
  const r = run([line(140)]);
  assert.equal(r?.discountIls, 0, "a single item earns nothing regardless of what was claimed");
  assert.notEqual(r?.discountIls, forged.discountIls);

  const pair = run([line(140), line(120)]);
  assert.equal(pair?.discountIls, 18, "the configured 15%, not the submitted 90%");
});

/* ── 18. snapshot immutability ────────────────────────────────────────── */

test("an order snapshot does not change after the campaign is edited", () => {
  const r = run([line(140), line(120)])!;
  const snapshot = promotionSnapshot(r, "en");
  const frozen = structuredClone(snapshot);

  assert.equal(snapshot.promotionId, "second-item");
  assert.equal(snapshot.type, "second_item_percentage");
  assert.equal(snapshot.discountPercent, 15);
  assert.equal(snapshot.minimumQuantity, 2);
  assert.equal(snapshot.repeatPerPair, true);
  assert.equal(snapshot.stackWithProductSales, false);
  assert.equal(snapshot.eligibleUnits, 2);
  assert.equal(snapshot.discountedUnits, 1);
  assert.equal(snapshot.originalMerchandiseIls, 260);
  assert.equal(snapshot.discountIls, 18);
  assert.equal(snapshot.finalMerchandiseIls, 242);
  assert.equal(snapshot.labelText, "Buy 2, get 15% off the second item");
  assert.equal(snapshot.startsAt, RUNNING.startsAt);
  assert.equal(snapshot.items.length, 1);

  // The owner now deepens the campaign, then switches it off entirely.
  const deeper = resolvePromotion([campaign({ discountPercent: 50 })], [line(140), line(120)], NOW);
  assert.equal(deeper?.discountIls, 60, "new carts use the new percentage");
  assert.equal(resolvePromotion([campaign({ enabled: false })], [line(140), line(120)], NOW), undefined);

  assert.deepEqual(snapshot, frozen, "the stored snapshot never moved");
});

/* ── 19. independence from supplier availability ──────────────────────── */

test("promotion eligibility says nothing about supplier availability", () => {
  const c = campaign();
  // The resolver has no availability input and returns no availability field.
  const r = run([line(140), line(120)], c);
  assert.ok(isPromotionApplied(r));
  assert.equal("availability" in (r ?? {}), false);
  assert.equal("availability" in (r?.allocations[0] ?? {}), false);
  assert.equal(
    Object.keys(c).some((k) => /availab|confirm|stock/i.test(k)),
    false,
    "no availability concept exists in the campaign shape",
  );
});

/* ── 20. labels ───────────────────────────────────────────────────────── */

test("labels render naturally in Arabic, Hebrew and English", () => {
  const c = campaign();
  assert.equal(promotionLabelIn(c, "ar"), "اشترِ قطعتين واحصل على خصم 15% على القطعة الثانية");
  assert.equal(promotionLabelIn(c, "he"), "קנו 2 וקבלו 15% הנחה על הפריט השני");
  assert.equal(promotionLabelIn(c, "en"), "Buy 2, get 15% off the second item");
  for (const locale of ["ar", "he", "en"] as const) {
    assert.doesNotMatch(promotionLabelIn(c, locale), /undefined|\[object|NaN/);
    assert.equal(promotionSnapshot(run([line(140), line(120)])!, locale).labelText, promotionLabelIn(c, locale));
  }
});

/* ── repeat-per-pair toggle ───────────────────────────────────────────── */

test("with repeat off only one discount is ever earned", () => {
  const c = campaign({ repeatPerPair: false });
  const r = run([line(140), line(130), line(120), line(100)], c);
  assert.equal(r?.discountedUnits, 1);
  assert.equal(r?.discountIls, 19.5);
  assert.equal(r?.unitsToNextDiscount, 0, "no further discount is promised");
});

test("a larger minimum quantity groups accordingly", () => {
  const c = campaign({ minimumQuantity: 3, discountPercent: 20, label: L("ثلاثة", "שלושה", "Buy 3") });
  const r = run([line(140), line(130), line(120), line(110), line(100), line(90)], c);
  assert.equal(r?.discountedUnits, 2, "two complete groups of three");
  assert.deepEqual(r?.allocations.map((a) => a.unitMerchandiseIls), [120, 90]);
});

/* ── campaign selection ───────────────────────────────────────────────── */

test("the running campaign is chosen deterministically by sort order", () => {
  const later = campaign({ id: "b", sortOrder: 20 });
  const earlier = campaign({ id: "a", sortOrder: 10 });
  assert.equal(activePromotion([later, earlier], NOW)?.id, "a");
  assert.equal(activePromotion([later, campaign({ id: "a", sortOrder: 10, enabled: false })], NOW)?.id, "b");
  assert.equal(activePromotion([], NOW), undefined);
});

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
