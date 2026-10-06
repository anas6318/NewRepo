/**
 * Client ↔ server pricing parity.
 *
 * The storefront prices a cart with src/lib (badges, sales, pricing,
 * promotions, delivery); place-order prices the order with the pure core in
 * supabase/functions/_shared/order-pricing.ts. Both run here over the same
 * product rows and the same clock, and every number a customer sees must
 * match: unit, line, sale discount, badge, promotion discount, subtotal,
 * delivery and total.
 *
 * Intentional server-only differences (not compared here, covered by the
 * core/tamper suites): the server REFUSES what the client merely hides —
 * invalid sizes/versions/badges, over-length input, bad locale — and adds the
 * supplier-hold statuses. The client `priceLine` throws on a negative base or
 * badge price where the server returns invalid_badge / pricing_error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAndPriceOrder, type PricedOrder } from "../../supabase/functions/_shared/order-pricing.ts";
import { normalizeBadgeOption, resolveBadgeSelection } from "../../src/lib/badges.ts";
import { evaluateFreeDelivery, resolveDeliveryFee } from "../../src/lib/delivery.ts";
import { cartSubtotal, priceLine } from "../../src/lib/pricing.ts";
import { merchandiseUnitValue, resolvePromotion, type PromotionLine } from "../../src/lib/promotions.ts";
import { discountableAmount, resolveSale } from "../../src/lib/sales.ts";
import { sizeOptionsFor } from "../../src/services/sizing.ts";
import type { BadgeOption, Product, ProductBadgeSetting, PromotionConfig } from "../../src/services/types.ts";
import { GOLDEN_CASES, GOLDEN_NOW, PATCHES, PRODUCTS, SETTINGS, ZONES, body, db, line, promo, type OrderFixture, type Row } from "./fixtures/order-pricing-cases.ts";
import { pricingInput } from "./fixtures/order-pricing-input.ts";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface ClientLine {
  unitPriceIls: number;
  lineTotalIls: number;
  regularUnitPriceIls: number;
  saleDiscountIls: number;
  badgeAdjustmentIls: number;
}
interface ClientTotals {
  lines: ClientLine[];
  subtotalIls: number;
  promotionDiscountIls: number;
  discountedUnits: number;
  deliveryIls: number;
  totalIls: number;
}

/** The storefront's calculation, composed from src/lib exactly as the cart
 * (src/services/store.tsx) and the demo order service do it. */
function clientPrice(b: Row, fixture: OrderFixture, nowMs: number): ClientTotals {
  // Storefront badge catalog: rows with the active column true (listBadges).
  const catalog: BadgeOption[] = fixture.patches
    .filter((r) => r.active === true)
    .map((r, i) => normalizeBadgeOption(r.data as unknown as BadgeOption, i * 10));
  const promotions = [...fixture.promotions].map((r) => r.data as unknown as PromotionConfig);
  const products = new Map(fixture.products.map((p) => [p.id as string, p.data as unknown as Product]));
  const lines: ClientLine[] = [];
  const promotionLines: PromotionLine[] = [];
  const delivery: { countsForFreeDelivery: boolean; quantity: number }[] = [];
  for (const [i, l] of (b.lines as Row[]).entries()) {
    const product = products.get(l.productId as string)!;
    const versionAdjustmentIls = product.versions.find((v) => v.version === l.version)?.adjustmentIls ?? 0;
    const adjustmentsIls = product.sleeves.length > 1 && l.sleeve === "long" ? [product.longSleeveAdjustmentIls] : [];
    const selection = resolveBadgeSelection(product, catalog, (l.badgeId ?? l.patchId) as string | undefined);
    if (!selection.ok) throw new Error(`client refused badge: ${selection.error}`);
    const badgePriceIls = selection.badge?.priceIls ?? 0;
    const discountable = discountableAmount(
      { basePriceIls: product.basePriceIls, versionAdjustmentIls, optionAdjustmentsIls: adjustmentsIls, badgePriceIls },
      product.sale?.includeAddOns === true,
    );
    const sale = resolveSale(product.sale, discountable, nowMs);
    const priced = priceLine({ basePriceIls: product.basePriceIls, versionAdjustmentIls, adjustmentsIls, badgePriceIls, sale, quantity: l.quantity as number });
    lines.push({
      unitPriceIls: priced.unitPriceIls,
      lineTotalIls: priced.lineTotalIls,
      regularUnitPriceIls: priced.regularUnitPriceIls,
      saleDiscountIls: priced.saleDiscountIls,
      badgeAdjustmentIls: badgePriceIls,
    });
    promotionLines.push({
      lineKey: `line-${i}`,
      productId: l.productId as string,
      slug: product.slug,
      title: product.name,
      ...(product.categorySlug ? { categorySlug: product.categorySlug } : {}),
      quantity: priced.quantity,
      merchandiseUnitIls: merchandiseUnitValue({ finalUnitPriceIls: priced.unitPriceIls, badgeAdjustmentIls: badgePriceIls }, priced.unitPriceIls),
      hasProductSale: priced.saleDiscountIls > 0,
    });
    delivery.push({ countsForFreeDelivery: product.qualifiesForFreeDelivery, quantity: priced.quantity });
  }
  const subtotalIls = cartSubtotal(lines);
  const promotion = resolvePromotion(promotions, promotionLines, nowMs);
  const promotionDiscountIls = promotion?.discountIls ?? 0;
  const zone = fixture.zones.find((z) => z.id === b.zoneId)!;
  const fd = evaluateFreeDelivery(delivery, (fixture.settings as { freeDeliveryMinItems: number }).freeDeliveryMinItems);
  const deliveryIls = resolveDeliveryFee({ priceIls: (zone.data as { priceIls: number }).priceIls, isActive: zone.active as boolean }, fd);
  return {
    lines,
    subtotalIls,
    promotionDiscountIls,
    discountedUnits: promotion?.discountedUnits ?? 0,
    deliveryIls,
    totalIls: round2(round2(subtotalIls - promotionDiscountIls) + deliveryIls),
  };
}

function serverTotals(r: PricedOrder): ClientTotals {
  return {
    lines: r.items.map((it) => {
      const p = it.price as Row;
      return {
        unitPriceIls: it.unitPriceIls as number,
        lineTotalIls: it.lineTotalIls as number,
        regularUnitPriceIls: p.regularUnitPriceIls as number,
        saleDiscountIls: p.saleDiscountIls as number,
        badgeAdjustmentIls: p.badgeAdjustmentIls as number,
      };
    }),
    subtotalIls: r.subtotalIls,
    promotionDiscountIls: r.promotionDiscountIls,
    discountedUnits: ((r.promotion?.discountedUnits as number | undefined) ?? 0),
    deliveryIls: r.deliveryIls,
    totalIls: r.totalIls,
  };
}

function assertParity(name: string, b: Row, fixture: OrderFixture, nowIso = GOLDEN_NOW) {
  const server = validateAndPriceOrder(pricingInput(b, fixture, nowIso));
  if (!server.ok) assert.fail(`${name}: server refused (${server.error})`);
  const client = clientPrice(b, fixture, Date.parse(nowIso));
  assert.deepEqual(serverTotals(server), client, name);
}

test("parity: every priced golden case matches the storefront calculation", () => {
  let compared = 0;
  for (const gc of GOLDEN_CASES) {
    const server = validateAndPriceOrder(pricingInput(gc.body, gc.db, gc.nowIso));
    if (!server.ok) continue; // refusals are server-only by design
    assertParity(gc.name, gc.body as Row, gc.db, gc.nowIso);
    compared++;
  }
  assert.ok(compared >= 25, `compared ${compared} priced cases`);
});

test("parity: CROWNED reference prices (Retro 169→149, Fan 149, Player 179, personalization free)", () => {
  const cases: [string, Row, number][] = [
    ["retro sale", line("retro-2"), 149],
    ["fan", line("season-1", { version: "fan", sleeve: "short" }), 149],
    ["player", line("season-1", { version: "player", sleeve: "short" }), 179],
    ["fan 4XL", line("season-1", { version: "fan", sleeve: "short", size: "4XL" }), 149],
    ["retro personalized", line("retro-2", { personalization: { name: "DANA", number: "10" } }), 149],
  ];
  for (const [name, l, unit] of cases) {
    const r = validateAndPriceOrder(pricingInput(body([l])));
    assert.ok(r.ok, name);
    if (r.ok) assert.equal(r.items[0]!.unitPriceIls, unit, name);
    assertParity(name, body([l]), db());
  }
});

/* ── seeded random carts ── */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SELLABLE = PRODUCTS.filter((p) => ["available", "made_to_order"].includes(p.status as string) && !["neg-1", "unavail-1", "disc-1", "drift-badge"].includes(p.id as string));

function randomLine(rand: () => number): Row {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const row = pick(SELLABLE);
  const d = row.data as unknown as Product;
  const version = d.versions.length ? pick(d.versions).version : undefined;
  const size = pick(sizeOptionsFor(d, version).map((o) => o.size));
  const sleeve = d.sleeves.length > 1 ? pick(["short", "long"]) : undefined;
  const settings: ProductBadgeSetting[] = d.badges ?? (d.patchIds ?? []).map((badgeId) => ({ badgeId, enabled: true }));
  const enabledBadges = settings
    .filter((s) => s.enabled && PATCHES.some((p) => p.id === s.badgeId && p.active === true && (p.data as Row).active !== false && ((s.priceOverrideIls ?? (p.data as Row).priceIls) as number) >= 0))
    .map((s) => s.badgeId);
  const badgeId = d.allowNoBadge === false || (enabledBadges.length && rand() < 0.5) ? pick(enabledBadges) : undefined;
  return {
    productId: row.id,
    size,
    quantity: 1 + Math.floor(rand() * 10),
    ...(version ? { version } : {}),
    ...(sleeve ? { sleeve } : {}),
    ...(badgeId ? { badgeId } : {}),
    ...(d.personalizable && rand() < 0.3 ? { personalization: { name: "KANE", number: "9" } } : {}),
  };
}

function randomPromotions(rand: () => number): Row[] {
  if (rand() < 0.2) return [];
  const n = 1 + Math.floor(rand() * 3);
  return Array.from({ length: n }, (_, i) =>
    promo(`p${i}${Math.floor(rand() * 9)}`, Math.floor(rand() * 3) * 10, {
      discountPercent: [5, 10, 15, 33.3, 50, 100][Math.floor(rand() * 6)],
      minimumQuantity: 2 + Math.floor(rand() * 3),
      repeatPerPair: rand() < 0.5,
      stackWithProductSales: rand() < 0.5,
      enabled: rand() < 0.9,
      ...(rand() < 0.3 ? { eligibleCategorySlugs: ["retro"] } : {}),
      ...(rand() < 0.2 ? { excludedProductIds: ["made-1"] } : {}),
      ...(rand() < 0.15 ? { startsAt: "2026-07-01T00:00:00.000Z" } : {}),
    }),
  );
}

test("parity: 400 seeded random carts, promotions and clocks", () => {
  const rand = rng(20260928);
  let withPromotion = 0;
  let withSale = 0;
  const clocks = [GOLDEN_NOW, "2026-05-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z", "2026-06-30T23:59:59.999Z"];
  for (let i = 0; i < 400; i++) {
    const lines = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => randomLine(rand));
    const fixture = db({ promotions: randomPromotions(rand), zones: ZONES, settings: { ...SETTINGS, freeDeliveryMinItems: 1 + Math.floor(rand() * 8) } });
    const zoneId = rand() < 0.5 ? "north" : "center";
    const nowIso = clocks[Math.floor(rand() * clocks.length)]!;
    assertParity(`random cart #${i}`, body(lines, { zoneId }), fixture, nowIso);
    const r = validateAndPriceOrder(pricingInput(body(lines, { zoneId }), fixture, nowIso));
    if (r.ok && r.promotionDiscountIls > 0) withPromotion++;
    if (r.ok && r.items.some((it) => ((it.price as Row).saleDiscountIls as number) > 0)) withSale++;
  }
  // The fuzz must actually exercise promotions and sales, not just regular prices.
  assert.ok(withPromotion >= 50, `only ${withPromotion} carts earned a promotion`);
  assert.ok(withSale >= 100, `only ${withSale} carts had a product sale`);
});
