/**
 * Pure pricing logic — no I/O, no framework imports. Deliberately kept
 * dependency-free so it can be unit tested directly (see tests/unit/pricing.test.ts)
 * and reasoned about without any database or React context.
 */

export interface PricedOptions {
  /** Base unit price for the selected product (already reflects any
   * product-specific override — see docs/database-schema.md pricing notes). */
  basePriceIls: number;
  /** Option adjustments relative to base (version, sleeve, …). May be
   * negative, but the resulting unit price must stay ≥ 0. */
  adjustmentsIls?: number[];
  /** Additional price for a selected patch/badge, 0 if none selected. */
  patchPriceIls?: number;
  quantity: number;
}

export interface PriceBreakdown {
  unitPriceIls: number;
  quantity: number;
  lineTotalIls: number;
}

export class PricingError extends Error {}

/** Computes a single line's price. Name/number customization is free per
 * spec §9 and therefore never appears here. */
export function priceLine({ basePriceIls, adjustmentsIls = [], patchPriceIls = 0, quantity }: PricedOptions): PriceBreakdown {
  if (basePriceIls < 0) throw new PricingError("basePriceIls must not be negative");
  if (patchPriceIls < 0) throw new PricingError("patchPriceIls must not be negative");
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new PricingError("quantity must be a positive integer");
  }

  const adjusted = adjustmentsIls.reduce((sum, a) => sum + a, basePriceIls);
  if (adjusted < 0) throw new PricingError("adjusted unit price must not be negative");

  const unitPriceIls = round2(adjusted + patchPriceIls);
  const lineTotalIls = round2(unitPriceIls * quantity);

  return { unitPriceIls, quantity, lineTotalIls };
}

export interface CartLineForTotal {
  lineTotalIls: number;
}

export function cartSubtotal(lines: CartLineForTotal[]): number {
  return round2(lines.reduce((sum, line) => sum + line.lineTotalIls, 0));
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
