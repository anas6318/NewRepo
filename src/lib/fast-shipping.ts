/**
 * Fast Shipping eligibility — "up to 3 business days".
 *
 * THE PROMISE IS ONLY TRUE FOR STOCK THAT PHYSICALLY EXISTS LOCALLY.
 * Everything CROWNED sells today is made to order and ships from the
 * supplier, so nothing is eligible and nothing may claim to be.
 *
 * WHAT THIS MODULE IS. A single, honest predicate. It returns true only when
 * a product carries a real, positive local-stock count for the exact version
 * and size the customer has selected. There is no fallback to "published",
 * no fallback to `availability.status === "available"` (that records a
 * SUPPLIER CONFIRMATION, not inventory), and no default-true path anywhere.
 *
 * WHAT THIS MODULE IS NOT. It is not inventory. Reading it tells you what a
 * product row claims; it does not reserve anything, cannot prevent two people
 * buying the last shirt, and is not consulted by `place-order`. Until the
 * backend work in docs/fast-shipping-requirements.md is done, no caller
 * should render a Fast Shipping claim in front of a customer — and none does.
 *
 * `localStock` is deliberately optional and absent from every product today,
 * so `isFastShippingEligible` returns false for the entire catalog.
 */
import type { JerseyVersion, Product } from "../services/types.ts";

/** Business days promised when a selection is genuinely in local stock. */
export const FAST_SHIPPING_MAX_DAYS = 3;

/**
 * Key for one stocked variant. Matches the shape `sizeAvailability` already
 * uses, so the two read alike: "<version>:<size>", or ":<size>" when a
 * product does not vary by version.
 */
export function stockKey(version: JerseyVersion | undefined, size: string): string {
  return `${version ?? ""}:${size}`;
}

/** A product that MAY carry local stock counts. Additive and optional. */
export interface StockedProduct {
  /** Units physically held locally, keyed by {@link stockKey}. */
  localStock?: Record<string, number>;
}

/**
 * True only when this exact version+size has a positive local-stock count.
 *
 * Every other case — no `localStock`, no entry for the key, zero, a negative
 * number, a non-finite value, a missing size — is false. That asymmetry is
 * the point: the failure mode of a wrong `true` is a broken promise to a
 * customer, and the failure mode of a wrong `false` is a missed badge.
 */
export function isFastShippingEligible(
  product: Pick<Product, "slug"> & StockedProduct,
  version: JerseyVersion | undefined,
  size: string | undefined,
): boolean {
  if (!size) return false;
  const stock = product.localStock;
  if (!stock || typeof stock !== "object") return false;
  const units = stock[stockKey(version, size)];
  return typeof units === "number" && Number.isFinite(units) && units > 0;
}

/** Any variant of this product in local stock — for a future collection. */
export function hasAnyLocalStock(product: StockedProduct): boolean {
  const stock = product.localStock;
  if (!stock || typeof stock !== "object") return false;
  return Object.values(stock).some((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
}

/**
 * Products that may truthfully appear in a Fast Shipping collection.
 * Returns an empty list for the current catalog, which is correct.
 */
export function fastShippingProducts<T extends StockedProduct>(products: readonly T[]): T[] {
  return products.filter(hasAnyLocalStock);
}
