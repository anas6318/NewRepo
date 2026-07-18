/**
 * Delivery-fee + free-delivery logic. Pure functions, no I/O — see
 * tests/unit/delivery.test.ts. This is the single source of truth the cart,
 * checkout, and admin preview all call into; never re-implement this
 * threshold inline in a component (spec §11: "make qualifying products
 * configurable from the admin dashboard", "based on item quantity, not cart
 * value").
 */

export interface QualifyingCartLine {
  /** Whether this product counts toward the free-delivery item count
   * (admin-configurable per product via order_items.counts_for_free_delivery /
   * products.qualifies_for_free_delivery). */
  countsForFreeDelivery: boolean;
  quantity: number;
}

export interface FreeDeliveryResult {
  qualifyingItemCount: number;
  isFreeDeliveryUnlocked: boolean;
  /** Items still needed to unlock free delivery; 0 once unlocked. */
  itemsRemaining: number;
}

export function evaluateFreeDelivery(
  lines: QualifyingCartLine[],
  minQualifyingItems: number,
): FreeDeliveryResult {
  if (!Number.isInteger(minQualifyingItems) || minQualifyingItems < 1) {
    throw new RangeError("minQualifyingItems must be a positive integer");
  }

  const qualifyingItemCount = lines
    .filter((line) => line.countsForFreeDelivery)
    .reduce((sum, line) => sum + line.quantity, 0);

  const isFreeDeliveryUnlocked = qualifyingItemCount >= minQualifyingItems;
  const itemsRemaining = isFreeDeliveryUnlocked ? 0 : minQualifyingItems - qualifyingItemCount;

  return { qualifyingItemCount, isFreeDeliveryUnlocked, itemsRemaining };
}

export interface ShippingZoneLike {
  priceIls: number;
  isActive: boolean;
}

/** Resolves the delivery fee for an order: 0 if free delivery is unlocked,
 * otherwise the matched zone's price. Throws rather than silently charging
 * ₪0 if no zone matched and free delivery isn't unlocked — callers must
 * handle "no zone" as a checkout validation error, never a silent free ride. */
export function resolveDeliveryFee(
  zone: ShippingZoneLike | null,
  freeDelivery: FreeDeliveryResult,
): number {
  if (freeDelivery.isFreeDeliveryUnlocked) return 0;
  if (!zone || !zone.isActive) {
    throw new Error("No active shipping zone matched — cannot compute delivery fee");
  }
  if (zone.priceIls < 0) throw new RangeError("Zone price must not be negative");
  return zone.priceIls;
}

export type FreeDeliveryMessageKey = "unlocked" | "progressOne" | "progressMany";

/** Chooses which of the three honest progress-message variants applies
 * (spec §11) — the actual localized string comes from the i18n dictionary,
 * this just picks the key + interpolation value. */
export function freeDeliveryMessage(freeDelivery: FreeDeliveryResult): {
  key: FreeDeliveryMessageKey;
  count?: number;
} {
  if (freeDelivery.isFreeDeliveryUnlocked) return { key: "unlocked" };
  if (freeDelivery.itemsRemaining === 1) return { key: "progressOne" };
  return { key: "progressMany", count: freeDelivery.itemsRemaining };
}
