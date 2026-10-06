/**
 * C8: the demo catalog reflects the intended CROWNED business rules —
 * Retro regular ₪169 with an active retro-only ₪149 sale, current-season
 * Fan ₪149 / Player ₪179, Fan 4XL opt-in, personalization free. Demo seed
 * data only (src/services/demo/seed-data.ts) — never the production
 * catalog or src/lib/sizing.ts defaults.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoCategories, demoProducts } from "../../src/services/demo/seed-data.ts";
import { resolveSale, discountableAmount } from "../../src/lib/sales.ts";
import { SIZE_RULES } from "../../src/services/sizing.ts";

function bySlug(slug: string) {
  const p = demoProducts.find((x) => x.slug === slug);
  assert.ok(p, `demo product "${slug}" exists`);
  return p!;
}

test("retro regular price is ₪169 across category default and every retro product", () => {
  const retroCat = demoCategories.find((c) => c.slug === "retro")!;
  assert.equal(retroCat.basePriceIls, 169);
  for (const slug of ["crimson-2005", "royal-1998", "emerald-2007", "amber-2001", "obsidian-2004"]) {
    assert.equal(bySlug(slug).basePriceIls, 169, `${slug} regular price`);
  }
});

test("retro sizes stay S–2XL (LEGACY_ADULT_SIZES), unchanged by the fixture alignment", () => {
  assert.deepEqual(SIZE_RULES.retro.allowed, ["S", "M", "L", "XL", "2XL"]);
});

test("exactly one retro product carries an ACTIVE, retro-only sale fixed at ₪149", () => {
  const now = Date.now();
  const activeRetroSales = demoProducts
    .filter((p) => p.categorySlug === "retro" && p.sale)
    .map((p) => ({ slug: p.slug, resolved: resolveSale(p.sale, discountableAmount({ basePriceIls: p.basePriceIls }, false), now) }))
    .filter((r) => r.resolved?.status === "active");
  assert.equal(activeRetroSales.length, 1, "exactly one retro product is on an active sale");
  const { slug, resolved } = activeRetroSales[0]!;
  assert.equal(slug, "royal-1998");
  const product = bySlug("royal-1998");
  const discount = discountableAmount({ basePriceIls: product.basePriceIls }, false);
  assert.equal(discount - resolved!.discountIls, 149, "the final sale price is ₪149");

  // No non-retro product is on an active sale claiming the same figure in a
  // way that would contradict "retro only" — the pre-existing
  // midnight-longsleeve fixed_price/149 sale is a different, unrelated
  // long-sleeve product kept for its own e2e coverage (documented deviation).
  const nonRetroActive = demoProducts
    .filter((p) => p.categorySlug !== "retro" && p.sale)
    .map((p) => resolveSale(p.sale, discountableAmount({ basePriceIls: p.basePriceIls }, p.sale?.includeAddOns === true), now))
    .filter((r) => r?.status === "active");
  assert.ok(nonRetroActive.length >= 1, "midnight-longsleeve's own sale is untouched");
});

test("scheduled and expired retro sale fixtures are preserved (emerald-2007, amber-2001)", () => {
  const now = Date.now();
  const emerald = bySlug("emerald-2007");
  const emeraldSale = resolveSale(emerald.sale, discountableAmount({ basePriceIls: emerald.basePriceIls }, false), now);
  assert.equal(emeraldSale?.status, "scheduled", "announced but not yet discounting");
  assert.equal(emeraldSale?.discountIls, 0, "no discount applied before it starts");
  assert.equal(emerald.sale?.startsAt !== undefined && Date.parse(emerald.sale.startsAt) > now, true, "scheduled in the future");

  const amber = bySlug("amber-2001");
  assert.ok(amber.sale?.endsAt && Date.parse(amber.sale.endsAt) < now, "amber-2001's sale has already ended");
});

test("current-season Fan is ₪149 and Player is ₪179 (base + ₪30 version adjustment)", () => {
  const cat = demoCategories.find((c) => c.slug === "current-season")!;
  assert.equal(cat.basePriceIls, 149);
  for (const slug of ["onyx-home", "ivory-away"]) {
    const p = bySlug(slug);
    assert.equal(p.basePriceIls, 149, `${slug} fan base price`);
    const player = p.versions.find((v) => v.version === "player");
    assert.ok(player, `${slug} has a player version`);
    assert.equal(p.basePriceIls + player!.adjustmentIls, 179, `${slug} player total price`);
  }
});

test("national-teams products follow the same Fan/Player pricing", () => {
  const azure = bySlug("azure-national");
  assert.equal(azure.basePriceIls, 149);
  const player = azure.versions.find((v) => v.version === "player");
  assert.equal(azure.basePriceIls + player!.adjustmentIls, 179);
  assert.equal(bySlug("scarlet-national").basePriceIls, 149);
});

test("the standalone Player and Fan version products land on the same figures", () => {
  assert.equal(bySlug("graphite-player").basePriceIls, 179, "player-version category, no adjustment");
  assert.equal(bySlug("classic-white-fan").basePriceIls, 149, "fan-version category");
});

test("a Fan product opts 4XL in (spec business rules), without touching sizing.ts defaults", () => {
  const fan = bySlug("classic-white-fan");
  assert.ok(fan.sizes?.includes("4XL"), "4XL is opted in on this product");
  // sizing.ts's own default (no product override) still stops at 3XL —
  // confirms this is a per-product opt-in, not a changed global default.
  assert.deepEqual(SIZE_RULES.fan.default, ["S", "M", "L", "XL", "2XL", "3XL"]);
  assert.deepEqual(SIZE_RULES.fan.optIn, ["4XL"]);
});

test("player sizes stay S–2XL (unchanged production-facing rule)", () => {
  assert.deepEqual(SIZE_RULES.player.allowed, ["S", "M", "L", "XL", "2XL"]);
});

test("personalization is still free everywhere — no price field reads it", () => {
  // Structural guarantee already covered by pricing.test.ts; this asserts
  // the demo fixtures never attach a price to personalization.
  for (const p of demoProducts) {
    assert.equal((p as unknown as { personalizationPriceIls?: number }).personalizationPriceIls, undefined, `${p.slug} has no personalization price field`);
  }
});
