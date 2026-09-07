/**
 * Pure pricing logic — no I/O, no framework imports. Deliberately kept
 * dependency-free so it can be unit tested directly (see
 * tests/unit/pricing.test.ts) and reasoned about without any database or
 * React context.
 *
 * Calculation order, applied identically on the client and the server:
 *   1. regular base price
 *   2. + version adjustment                 ─┐ the discountable portion
 *   3. − sale discount                       ┘
 *   4. + option adjustments (long sleeve, …) ─┐ never discounted unless the
 *   5. + badge adjustment                     ┘ owner enables add-on eligibility
 *   6. × quantity
 *
 * Delivery is never touched by a product sale.
 */
import type { PriceSnapshot, ResolvedSale } from "../services/types.ts";
import { discountableAmount, saleLabelIn, type Locale } from "./sales.ts";

export interface PricedOptions {
  /** The product's real regular price. A sale never overwrites this. */
  basePriceIls: number;
  /** Adjustment for the selected version. Discounted along with the base. */
  versionAdjustmentIls?: number;
  /** Other paid option adjustments (long sleeve, …). May be negative, but
   * the resulting unit price must stay ≥ 0. Outside the sale by default. */
  adjustmentsIls?: number[];
  /** Resolved adjustment for the selected badge/patch, 0 when none is
   * selected. Always supplied by the badge resolver (product override or
   * global catalog price) — never a constant and never a client-sent value. */
  badgePriceIls?: number;
  /** Sale resolved against this exact configuration, at a trusted clock. */
  sale?: ResolvedSale;
  quantity: number;
}

export interface PriceBreakdown {
  /** Unit price before any sale — what the storefront strikes through. */
  regularUnitPriceIls: number;
  saleDiscountIls: number;
  /** Unit price actually charged. */
  unitPriceIls: number;
  quantity: number;
  lineTotalIls: number;
}

export class PricingError extends Error {}

/** Computes a single line's price. Name/number customization is free per
 * spec §9 and therefore never appears here. */
export function priceLine({
  basePriceIls,
  versionAdjustmentIls = 0,
  adjustmentsIls = [],
  badgePriceIls = 0,
  sale,
  quantity,
}: PricedOptions): PriceBreakdown {
  if (basePriceIls < 0) throw new PricingError("basePriceIls must not be negative");
  if (!Number.isFinite(badgePriceIls) || badgePriceIls < 0) throw new PricingError("badgePriceIls must not be negative");
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new PricingError("quantity must be a positive integer");
  }

  const options = adjustmentsIls.reduce((sum, a) => sum + a, 0);
  const regularUnitPriceIls = round2(basePriceIls + versionAdjustmentIls + options + badgePriceIls);
  if (regularUnitPriceIls < 0) throw new PricingError("adjusted unit price must not be negative");

  // The sale can only ever reduce the portion it was resolved against, and
  // only while it is genuinely active.
  const discountable = discountableAmount(
    { basePriceIls, versionAdjustmentIls, optionAdjustmentsIls: adjustmentsIls, badgePriceIls },
    sale?.includeAddOns === true,
  );
  const saleDiscountIls = sale && sale.status === "active" ? clamp(round2(sale.discountIls), 0, discountable) : 0;

  const unitPriceIls = round2(regularUnitPriceIls - saleDiscountIls);
  if (unitPriceIls < 0) throw new PricingError("final unit price must not be negative");

  return {
    regularUnitPriceIls,
    saleDiscountIls,
    unitPriceIls,
    quantity,
    lineTotalIls: round2(unitPriceIls * quantity),
  };
}

/** Freezes the whole calculation into the order item. Editing or ending the
 * sale afterwards can never reach back into this. */
export function priceSnapshot(
  opts: PricedOptions,
  breakdown: PriceBreakdown,
  locale: Locale,
  priceValidUntil?: string,
): PriceSnapshot {
  const { sale } = opts;
  const discounting = !!sale && sale.status === "active" && breakdown.saleDiscountIls > 0;
  return {
    regularBasePriceIls: opts.basePriceIls,
    versionAdjustmentIls: opts.versionAdjustmentIls ?? 0,
    optionAdjustmentsIls: round2((opts.adjustmentsIls ?? []).reduce((sum, a) => sum + a, 0)),
    badgeAdjustmentIls: opts.badgePriceIls ?? 0,
    regularUnitPriceIls: breakdown.regularUnitPriceIls,
    ...(discounting ? { saleType: sale.type, saleValue: sale.value } : {}),
    saleDiscountIls: breakdown.saleDiscountIls,
    finalUnitPriceIls: breakdown.unitPriceIls,
    ...(discounting ? { saleLabel: saleLabelIn(sale, locale) } : {}),
    ...(discounting && sale.startsAt ? { saleStartsAt: sale.startsAt } : {}),
    ...(discounting && sale.endsAt ? { saleEndsAt: sale.endsAt } : {}),
    ...(priceValidUntil ? { priceValidUntil } : {}),
  };
}

export interface CartLineForTotal {
  lineTotalIls: number;
}

export function cartSubtotal(lines: CartLineForTotal[]): number {
  return round2(lines.reduce((sum, line) => sum + line.lineTotalIls, 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
